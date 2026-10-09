import asyncio
import json
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Response, WebSocket, WebSocketDisconnect

from .. import logs
from ..db import get_pool, rows
from . import images
from .hub import CHANNELS, hub
from .simulator import LOCAL, NODE_BY_ID, NODES, daylight

router = APIRouter(prefix="/api/field", tags=["field"])
log = logs.get("field")
UTC = timezone.utc

METRICS = ["soil_moisture", "soil_temp", "air_temp", "humidity", "ph", "ec", "light", "rain_mm"]


async def node_health(conn) -> dict[str, dict]:
    stats = await conn.fetch(
        """SELECT node_id,
                  count(*) FILTER (WHERE ts > now() - interval '60 minutes') AS n_hour,
                  max(ts) AS last_seen,
                  min(battery_v) FILTER (WHERE ts > now() - interval '24 hours') AS battery_min,
                  (avg(rssi) FILTER (WHERE ts > now() - interval '60 minutes'))::float AS rssi_avg,
                  (stddev_samp(ph) FILTER (WHERE ts > now() - interval '60 minutes'))::float AS ph_std,
                  (avg(ph) FILTER (WHERE ts > now() - interval '60 minutes'))::float AS ph_avg
           FROM readings WHERE ts > now() - interval '24 hours' GROUP BY node_id""")
    out = {}
    now = datetime.now(UTC)
    clip = lambda x: max(0.0, min(1.0, x))
    for s in stats:
        issues = []
        completeness = clip((s["n_hour"] or 0) / 120)
        battery = clip(((s["battery_min"] or 0) - 3.55) / 0.2)
        rssi = clip(((s["rssi_avg"] or -100) + 92) / 22)
        ph_std = s["ph_std"] or 0
        sensor = clip(1 - (ph_std - 0.03) / 0.15)
        if completeness < 0.97:
            issues.append(f"{100 * (1 - completeness):.0f}% of readings missing in the last hour")
        if battery < 0.8:
            issues.append(f"Battery dips to {s['battery_min']:.2f} V overnight")
        if rssi < 0.4:
            issues.append(f"Weak link ({s['rssi_avg']:.0f} dBm)")
        if sensor < 0.8:
            issues.append(f"pH reading unstable (σ {ph_std:.2f}); probe drift suspected")
        score = 100 * (0.35 * completeness + 0.2 * battery + 0.2 * rssi + 0.25 * sensor)
        stale = (now - s["last_seen"]).total_seconds() > 180
        if stale:
            score *= 0.3
            issues.insert(0, "No readings in the last 3 minutes")
        out[s["node_id"]] = {
            "node_id": s["node_id"], "score": round(score), "issues": issues, "last_seen": s["last_seen"],
            "completeness": round(completeness, 3), "battery_min": s["battery_min"], "rssi_avg": s["rssi_avg"],
            "ph_std": round(ph_std, 3), "online": not stale,
        }
    return out


@router.get("/overview")
async def overview():
    pool = get_pool()
    async with pool.acquire() as conn:
        nodes = rows(await conn.fetch("SELECT * FROM field_nodes ORDER BY id"))
        latest = {r["node_id"]: dict(r) for r in await conn.fetch(
            "SELECT DISTINCT ON (node_id) * FROM readings ORDER BY node_id, ts DESC")}
        preds = {r["node_id"]: dict(r) for r in await conn.fetch(
            "SELECT DISTINCT ON (node_id) * FROM predictions ORDER BY node_id, ts DESC")}
        health = await node_health(conn)
    for n in nodes:
        n["latest"] = latest.get(n["id"])
        n["prediction"] = preds.get(n["id"])
        n["health"] = health.get(n["id"])
    now = datetime.now(UTC)
    return {"nodes": nodes, "server_time": now, "daylight": daylight(now) > 0.08,
            "local_tz": now.astimezone(LOCAL).strftime("%Z")}


@router.get("/nodes/{node_id}/series")
async def series(node_id: str, hours: int = Query(24, ge=1, le=336)):
    if node_id not in NODE_BY_ID:
        raise HTTPException(404, "unknown node")
    bucket = max(30, hours * 3600 // 288)
    rs = await get_pool().fetch(
        f"""SELECT to_timestamp(floor(extract(epoch FROM ts) / $3) * $3) AS t,
                   {", ".join(f"avg({m})::real AS {m}" for m in METRICS if m != "rain_mm")},
                   sum(rain_mm)::real AS rain_mm
            FROM readings WHERE node_id = $1 AND ts > now() - make_interval(hours => $2)
            GROUP BY 1 ORDER BY 1""", node_id, hours, bucket)
    return {"node_id": node_id, "bucket_s": bucket, "t": [r["t"] for r in rs],
            **{m: [round(r[m], 3) if r[m] is not None else None for r in rs] for m in METRICS}}


@router.get("/heatmap")
async def heatmap(days: int = Query(7, ge=1, le=14), metric: str = "soil_moisture"):
    if metric not in METRICS:
        raise HTTPException(422, "unknown metric")
    agg = "sum" if metric == "rain_mm" else "avg"
    rs = await get_pool().fetch(
        f"""SELECT node_id, date_trunc('hour', ts) AS hour, {agg}({metric})::real AS v
            FROM readings WHERE ts > date_trunc('hour', now()) - make_interval(days => $1)
            GROUP BY 1, 2 ORDER BY 1, 2""", days)
    return {"metric": metric, "cells": [{"node_id": r["node_id"], "hour": r["hour"], "v": round(r["v"], 3)} for r in rs]}


@router.get("/timeline")
async def timeline(hours: int = Query(48, ge=1, le=336)):
    rs = await get_pool().fetch(
        """SELECT node_id, ts, label, p_wet FROM predictions WHERE ts > now() - make_interval(hours => $1)
           ORDER BY node_id, ts""", hours)
    out: dict[str, list] = {n.id: [] for n in NODES}
    for r in rs:
        out[r["node_id"]].append([r["ts"], r["label"], round(r["p_wet"], 3)])
    return {"hours": hours, "nodes": out}


@router.get("/predictions")
async def predictions(node: str | None = None, limit: int = Query(24, le=200), before: int | None = None):
    args, where = [limit], []
    if node:
        args.append(node)
        where.append(f"p.node_id = ${len(args)}")
    if before:
        args.append(before)
        where.append(f"p.id < ${len(args)}")
    sql = """SELECT p.id, p.node_id, p.ts, p.label, p.p_wet, p.soil_moisture, p.latency_ms, p.ground_truth,
                    mv.version AS model_version, mv.id AS model_version_id
             FROM predictions p JOIN model_versions mv ON mv.id = p.model_version_id"""
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY p.ts DESC, p.id DESC LIMIT $1"
    return rows(await get_pool().fetch(sql, *args))


@router.get("/model")
async def model():
    pool = get_pool()
    mv = await pool.fetchrow(
        """SELECT mv.id, mv.version, mv.architecture, mv.code_commit, mv.created_at, mv.hyperparams,
                  (SELECT e.metrics FROM evaluations e WHERE e.model_version_id = mv.id
                     AND e.dataset_version_id = mv.dataset_version_id AND e.split = 'test' LIMIT 1) AS offline_metrics,
                  d.slug AS dataset, dv.version AS dataset_version
           FROM model_versions mv JOIN dataset_versions dv ON dv.id = mv.dataset_version_id
           JOIN datasets d ON d.id = dv.dataset_id
           WHERE mv.name = 'wetdry' AND mv.stage = 'production' ORDER BY mv.created_at DESC LIMIT 1""")
    cm = await pool.fetchrow(
        """SELECT count(*) FILTER (WHERE label = 1 AND ground_truth = 1) AS tp,
                  count(*) FILTER (WHERE label = 1 AND ground_truth = 0) AS fp,
                  count(*) FILTER (WHERE label = 0 AND ground_truth = 1) AS fn,
                  count(*) FILTER (WHERE label = 0 AND ground_truth = 0) AS tn,
                  count(*) AS frames,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS latency_p50,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS latency_p95
           FROM predictions WHERE ts > now() - interval '14 days'""")
    tp, fp, fn, tn = cm["tp"], cm["fp"], cm["fn"], cm["tn"]
    labeled = tp + fp + fn + tn
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else None
    return {
        "model": dict(mv) if mv else None,
        "live": {"frames": cm["frames"], "labeled": labeled, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
                 "accuracy": (tp + tn) / labeled if labeled else None, "precision": precision, "recall": recall, "f1": f1,
                 "latency_p50": cm["latency_p50"], "latency_p95": cm["latency_p95"]},
    }


_image_cache: OrderedDict[int, bytes] = OrderedDict()


@router.get("/captures/{pred_id}.jpg")
async def capture(pred_id: int):
    data = _image_cache.get(pred_id)
    if data is None:
        r = await get_pool().fetchrow(
            """SELECT p.*,
                      (SELECT light FROM readings r WHERE r.node_id = p.node_id AND r.ts <= p.ts ORDER BY r.ts DESC LIMIT 1) AS light
               FROM predictions p WHERE p.id = $1""", pred_id)
        if not r:
            raise HTTPException(404, "capture not found")
        data = await asyncio.to_thread(
            images.render, r["image_seed"], r["p_wet"], r["label"], r["node_id"],
            r["ts"].astimezone(LOCAL), r["light"] or 20_000)
        _image_cache[pred_id] = data
        if len(_image_cache) > 400:
            _image_cache.popitem(last=False)
    else:
        _image_cache.move_to_end(pred_id)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


async def health_loop():
    """Publishes node health to subscribers every 30 s."""
    while True:
        await asyncio.sleep(30)
        if not hub.clients:
            continue
        try:
            async with get_pool().acquire() as conn:
                for h in (await node_health(conn)).values():
                    await hub.publish("health", h)
        except Exception:
            log.exception("health_publish_failed")


@router.websocket("/ws")
async def ws(socket: WebSocket):
    await socket.accept()
    client = hub.add()

    async def reader():
        # {"subscribe": ["reading", "prediction"]} narrows the channels for this client
        while True:
            msg = json.loads(await socket.receive_text())
            if "subscribe" in msg:
                client.channels = set(msg["subscribe"]) & CHANNELS
            elif msg.get("type") == "ping":
                await socket.send_text(json.dumps({"channel": "pong", "data": {}}))

    async def writer():
        while True:
            await socket.send_text(await client.queue.get())

    tasks = [asyncio.create_task(reader()), asyncio.create_task(writer())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
    except WebSocketDisconnect:
        pass
    finally:
        for t in tasks:
            t.cancel()
        hub.remove(client)
