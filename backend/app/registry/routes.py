import re
import time
from typing import Any

import asyncpg
from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from .. import logs
from ..cache import get_cache
from ..config import settings
from ..db import get_pool, rows

router = APIRouter(prefix="/api/v1", tags=["registry"])
log = logs.get("registry")

TTL = 300

MODEL_COLUMNS = """
    mv.id, mv.name, mv.version, mv.framework, mv.architecture, mv.stage::text AS stage,
    mv.code_repo, mv.code_commit, mv.parent_id, mv.created_at, mv.notes,
    p.slug AS project, p.name AS project_name, p.primary_metric, p.metric_higher_is_better,
    r.handle AS author, r.name AS author_name,
    d.slug AS dataset, dv.version AS dataset_version, dv.id AS dataset_version_id
"""
MODEL_JOINS = """
    FROM model_versions mv
    JOIN projects p ON p.id = mv.project_id
    JOIN researchers r ON r.id = mv.created_by
    JOIN dataset_versions dv ON dv.id = mv.dataset_version_id
    JOIN datasets d ON d.id = dv.dataset_id
"""
# Primary metric from the version's own test evaluation.
PRIMARY_METRIC = """
    (SELECT (e.metrics ->> p.primary_metric)::float FROM evaluations e
      WHERE e.model_version_id = mv.id AND e.dataset_version_id = mv.dataset_version_id AND e.split = 'test'
      LIMIT 1) AS metric_value
"""


async def cached(response: Response, key: str, loader):
    value, hit = await get_cache().get_or_load(key, TTL, loader)
    response.headers["X-Cache"] = "HIT" if hit else "MISS"
    return value


@router.get("/stats")
async def stats(response: Response):
    async def load():
        pool = get_pool()
        r = await pool.fetchrow(
            """SELECT
                 (SELECT count(*) FROM researchers) AS researchers,
                 (SELECT count(*) FROM projects) AS projects,
                 (SELECT count(*) FROM model_versions) AS model_versions,
                 (SELECT count(*) FROM model_versions WHERE stage = 'production') AS in_production,
                 (SELECT count(*) FROM dataset_versions) AS dataset_versions,
                 (SELECT count(*) FROM runs) AS runs,
                 (SELECT count(*) FROM evaluations) AS evaluations"""
        )
        by_month = await pool.fetch(
            """SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, count(*) AS n
               FROM model_versions GROUP BY 1 ORDER BY 1"""
        )
        return {**dict(r), "versions_by_month": rows(by_month)}
    return await cached(response, "stats", load)


@router.get("/researchers")
async def researchers(response: Response):
    async def load():
        return rows(await get_pool().fetch(
            """SELECT r.handle, r.name, r.role, r.focus, r.joined_at,
                      (SELECT count(*) FROM model_versions mv WHERE mv.created_by = r.id) AS model_versions,
                      (SELECT max(at) FROM events e WHERE e.actor_id = r.id) AS last_active,
                      (SELECT json_agg(json_build_object('slug', p.slug, 'name', p.name)) FROM projects p WHERE p.owner_id = r.id) AS projects
               FROM researchers r ORDER BY r.name"""))
    return await cached(response, "researchers", load)


@router.get("/projects")
async def projects(response: Response):
    async def load():
        return rows(await get_pool().fetch(
            """SELECT p.slug, p.name, p.description, p.task, p.primary_metric, p.metric_higher_is_better, p.created_at,
                      r.handle AS owner, r.name AS owner_name,
                      count(mv.id) AS model_versions,
                      max(mv.created_at) AS last_version_at,
                      (SELECT mv2.version FROM model_versions mv2 WHERE mv2.project_id = p.id AND mv2.stage = 'production'
                        ORDER BY mv2.created_at DESC LIMIT 1) AS production_version
               FROM projects p
               JOIN researchers r ON r.id = p.owner_id
               LEFT JOIN model_versions mv ON mv.project_id = p.id
               GROUP BY p.id, r.id ORDER BY max(mv.created_at) DESC NULLS LAST"""))
    return await cached(response, "projects", load)


@router.get("/projects/{slug}")
async def project(slug: str, response: Response):
    async def load():
        pool = get_pool()
        p = await pool.fetchrow(
            """SELECT p.*, r.handle AS owner, r.name AS owner_name FROM projects p
               JOIN researchers r ON r.id = p.owner_id WHERE p.slug = $1""", slug)
        if not p:
            return None
        p = dict(p)
        p.pop("search", None)
        models = await pool.fetch(f"SELECT {MODEL_COLUMNS}, {PRIMARY_METRIC} {MODEL_JOINS} WHERE p.slug = $1 ORDER BY mv.created_at", slug)
        datasets = await pool.fetch(
            """SELECT d.slug, d.name, dv.version, dv.n_samples, dv.created_at, dv.notes
               FROM datasets d JOIN dataset_versions dv ON dv.dataset_id = d.id
               WHERE d.project_id = $1 ORDER BY dv.version""", p["id"])
        return {**p, "models": rows(models), "dataset_versions": rows(datasets)}
    data = await cached(response, f"project:{slug}", load)
    if data is None:
        raise HTTPException(404, f"project '{slug}' not found")
    return data


@router.get("/models")
async def models(
    response: Response,
    project: str | None = None,
    stage: str | None = None,
    author: str | None = None,
):
    async def load():
        where, args = [], []
        for col, val in (("p.slug", project), ("mv.stage::text", stage), ("r.handle", author)):
            if val:
                args.append(val)
                where.append(f"{col} = ${len(args)}")
        sql = f"SELECT {MODEL_COLUMNS}, {PRIMARY_METRIC} {MODEL_JOINS}"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY mv.created_at DESC"
        return rows(await get_pool().fetch(sql, *args))
    return await cached(response, f"models:{project}:{stage}:{author}", load)


@router.get("/models/{model_id}")
async def model(model_id: int, response: Response):
    async def load():
        pool = get_pool()
        mv = await pool.fetchrow(
            f"""SELECT {MODEL_COLUMNS}, mv.hyperparams, mv.artifact_uri, mv.artifact_bytes,
                       dv.uri AS dataset_uri, dv.checksum AS dataset_checksum, dv.n_samples AS dataset_samples,
                       dv.splits AS dataset_splits, dv.notes AS dataset_notes, dv.created_at AS dataset_created_at
                {MODEL_JOINS} WHERE mv.id = $1""", model_id)
        if not mv:
            return None
        lineage = await pool.fetch(
            f"""SELECT l.depth, {MODEL_COLUMNS}, {PRIMARY_METRIC}
                FROM model_lineage($1) l JOIN model_versions mv ON mv.id = l.id
                JOIN projects p ON p.id = mv.project_id
                JOIN researchers r ON r.id = mv.created_by
                JOIN dataset_versions dv ON dv.id = mv.dataset_version_id
                JOIN datasets d ON d.id = dv.dataset_id
                ORDER BY l.depth DESC""", model_id)
        children = await pool.fetch("SELECT id, version, stage::text AS stage FROM model_versions WHERE parent_id = $1 ORDER BY created_at", model_id)
        runs = await pool.fetch("SELECT * FROM runs WHERE model_version_id = $1 ORDER BY started_at", model_id)
        evals = await pool.fetch(
            """SELECT e.id, e.split, e.metrics, e.created_at, d.slug AS dataset, dv.version AS dataset_version,
                      (dv.id = $2) AS own_dataset
               FROM evaluations e JOIN dataset_versions dv ON dv.id = e.dataset_version_id
               JOIN datasets d ON d.id = dv.dataset_id
               WHERE e.model_version_id = $1 ORDER BY dv.version, e.split DESC""", model_id, mv["dataset_version_id"])
        return {**dict(mv), "lineage": rows(lineage), "children": rows(children), "runs": rows(runs), "evaluations": rows(evals)}
    data = await cached(response, f"model:{model_id}", load)
    if data is None:
        raise HTTPException(404, f"model version {model_id} not found")
    return data


@router.get("/compare")
async def compare(a: int, b: int, response: Response):
    async def load():
        pool = get_pool()
        out = []
        for mid in (a, b):
            r = await pool.fetchrow(
                f"""SELECT {MODEL_COLUMNS}, mv.hyperparams, dv.checksum AS dataset_checksum,
                           (SELECT e.metrics FROM evaluations e WHERE e.model_version_id = mv.id
                              AND e.dataset_version_id = mv.dataset_version_id AND e.split = 'test' LIMIT 1) AS test_metrics
                    {MODEL_JOINS} WHERE mv.id = $1""", mid)
            if not r:
                return None
            out.append(dict(r))
        ha, hb = out[0]["hyperparams"], out[1]["hyperparams"]
        diff = [
            {"key": k, "a": ha.get(k), "b": hb.get(k), "changed": ha.get(k) != hb.get(k)}
            for k in sorted(set(ha) | set(hb))
        ]
        return {"a": out[0], "b": out[1], "hyperparams": diff}
    data = await cached(response, f"compare:{a}:{b}", load)
    if data is None:
        raise HTTPException(404, "model version not found")
    return data


@router.get("/datasets")
async def datasets(response: Response):
    async def load():
        return rows(await get_pool().fetch(
            """SELECT d.slug, d.name, d.description, d.modality, p.slug AS project, p.name AS project_name,
                      json_agg(json_build_object(
                          'id', dv.id, 'version', dv.version, 'n_samples', dv.n_samples, 'size_bytes', dv.size_bytes,
                          'checksum', dv.checksum, 'uri', dv.uri, 'notes', dv.notes, 'created_at', dv.created_at,
                          'splits', dv.splits,
                          'used_by', (SELECT json_agg(json_build_object('id', mv.id, 'version', mv.version, 'stage', mv.stage) ORDER BY mv.created_at)
                                        FROM model_versions mv WHERE mv.dataset_version_id = dv.id)
                      ) ORDER BY dv.version DESC) AS versions
               FROM datasets d JOIN projects p ON p.id = d.project_id
               JOIN dataset_versions dv ON dv.dataset_id = d.id
               GROUP BY d.id, p.id ORDER BY max(dv.created_at) DESC"""))
    return await cached(response, "datasets", load)


@router.get("/activity")
async def activity(response: Response, limit: int = Query(40, le=200)):
    async def load():
        return rows(await get_pool().fetch(
            """SELECT e.id, e.at, e.kind, e.subject_type, e.subject_id, e.summary, r.handle AS actor, r.name AS actor_name
               FROM events e JOIN researchers r ON r.id = e.actor_id ORDER BY e.at DESC LIMIT $1""", limit))
    return await cached(response, f"activity:{limit}", load)


@router.get("/search")
async def search(q: str, response: Response):
    q = q.strip()[:80]
    if not q:
        return []

    async def load():
        pool = get_pool()
        like = f"%{q}%"
        # full text for words, prefix ILIKE for versions, commits, and handles
        out = []
        for r in await pool.fetch(
            f"""SELECT {MODEL_COLUMNS},
                       ts_rank(mv.search, websearch_to_tsquery('english', $1)) AS rank
                {MODEL_JOINS}
                WHERE mv.search @@ websearch_to_tsquery('english', $1)
                   OR mv.version ILIKE $2 OR mv.code_commit LIKE $3 OR p.slug ILIKE $2 OR r.handle ILIKE $2
                ORDER BY rank DESC, mv.created_at DESC LIMIT 12""", q, like, q.lower() + "%"):
            out.append({"type": "model_version", "id": r["id"], "title": f"{r['project']} {r['version']}",
                        "subtitle": f"{r['architecture']} · {r['stage']} · {r['author_name']}"})
        for r in await pool.fetch(
            """SELECT slug, name, task FROM projects
               WHERE search @@ websearch_to_tsquery('english', $1) OR slug ILIKE $2 LIMIT 5""", q, like):
            out.append({"type": "project", "id": r["slug"], "title": r["name"], "subtitle": r["task"]})
        for r in await pool.fetch(
            """SELECT slug, name, modality FROM datasets
               WHERE search @@ websearch_to_tsquery('english', $1) OR slug ILIKE $2 LIMIT 5""", q, like):
            out.append({"type": "dataset", "id": r["slug"], "title": r["name"], "subtitle": f"{r['slug']} · {r['modality']}"})
        for r in await pool.fetch(
            "SELECT handle, name, focus FROM researchers WHERE name ILIKE $1 OR handle ILIKE $1 OR focus ILIKE $1 LIMIT 5", like):
            out.append({"type": "researcher", "id": r["handle"], "title": r["name"], "subtitle": r["focus"]})
        return out
    return await cached(response, f"search:{q.lower()}", load)


# --- writes (token-protected; the public UI is read-only) ---

SEMVER = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$")


class NewModelVersion(BaseModel):
    project: str
    version: str = Field(pattern=SEMVER.pattern)
    architecture: str
    framework: str
    hyperparams: dict[str, Any]
    dataset: str
    dataset_version: int
    code_commit: str = Field(pattern=r"^[0-9a-f]{40}$")
    parent_version: str | None = None
    artifact_uri: str
    artifact_bytes: int
    notes: str = ""
    author: str


class StageChange(BaseModel):
    stage: str = Field(pattern=r"^(development|staging|production|archived)$")
    author: str


def _require_token(token: str | None) -> None:
    if not settings.write_token or token != settings.write_token:
        raise HTTPException(401, "a valid X-Registry-Token is required for writes")


@router.post("/models", status_code=201)
async def register_model(body: NewModelVersion, x_registry_token: str | None = Header(None)):
    _require_token(x_registry_token)
    pool = get_pool()
    async with pool.acquire() as conn, conn.transaction():
        p = await conn.fetchrow("SELECT id, slug FROM projects WHERE slug = $1", body.project)
        dv = await conn.fetchval(
            "SELECT dv.id FROM dataset_versions dv JOIN datasets d ON d.id = dv.dataset_id WHERE d.slug = $1 AND dv.version = $2",
            body.dataset, body.dataset_version)
        author = await conn.fetchval("SELECT id FROM researchers WHERE handle = $1", body.author)
        if not (p and dv and author):
            raise HTTPException(422, "unknown project, dataset version, or author")
        parent = None
        if body.parent_version:
            parent = await conn.fetchval("SELECT id FROM model_versions WHERE project_id = $1 AND version = $2", p["id"], body.parent_version)
            if not parent:
                raise HTTPException(422, f"parent version {body.parent_version} not found")
        try:
            mid = await conn.fetchval(
                """INSERT INTO model_versions (project_id, name, version, framework, architecture, hyperparams,
                       dataset_version_id, code_repo, code_commit, parent_id, artifact_uri, artifact_bytes, notes, created_by, created_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now()) RETURNING id""",
                p["id"], p["slug"], body.version, body.framework, body.architecture, body.hyperparams, dv,
                f"git.abe-lab.internal/ml/{p['slug']}", body.code_commit, parent, body.artifact_uri,
                body.artifact_bytes, body.notes, author)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, f"{body.project} {body.version} already exists; versions are immutable")
        await conn.execute(
            "INSERT INTO events (at, actor_id, kind, subject_type, subject_id, summary) VALUES (now(), $1, 'model_version.registered', 'model_version', $2, $3)",
            author, mid, f"Registered {p['slug']} {body.version} ({body.architecture})")
    await get_cache().invalidate()
    log.info("model_version_registered", model_version_id=mid, project=body.project, version=body.version)
    return {"id": mid}


@router.patch("/models/{model_id}/stage")
async def change_stage(model_id: int, body: StageChange, x_registry_token: str | None = Header(None)):
    _require_token(x_registry_token)
    pool = get_pool()
    async with pool.acquire() as conn, conn.transaction():
        author = await conn.fetchval("SELECT id FROM researchers WHERE handle = $1", body.author)
        row = await conn.fetchrow(
            "UPDATE model_versions SET stage = $2::model_stage WHERE id = $1 RETURNING name, version", model_id, body.stage)
        if not row or not author:
            raise HTTPException(404, "model version or author not found")
        await conn.execute(
            "INSERT INTO events (at, actor_id, kind, subject_type, subject_id, summary) VALUES (now(), $1, $2, 'model_version', $3, $4)",
            author, f"model_version.stage.{body.stage}", model_id, f"Moved {row['name']} {row['version']} to {body.stage}")
    await get_cache().invalidate()
    log.info("model_version_stage_changed", model_version_id=model_id, stage=body.stage)
    return {"id": model_id, "stage": body.stage}
