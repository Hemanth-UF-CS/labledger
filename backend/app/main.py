import asyncio
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import cache, db, logs, migrate
from .config import settings
from .field import routes as field_routes
from .field.simulator import simulator
from .registry import routes as registry_routes
from .registry.seed import seed

logs.setup(settings.log_level)
log = logs.get("app")
STARTED = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await db.connect(settings.database_url)
    applied = await migrate.run(pool)
    async with pool.acquire() as conn:
        seeded = await seed(conn)
    cache.init(settings.redis_url)
    if seeded:
        await cache.get_cache().invalidate()
    tasks = []
    if settings.simulator_enabled:
        await simulator.start()
        tasks.append(asyncio.create_task(field_routes.health_loop()))
    log.info("startup_complete", migrations_applied=applied, cache=cache.get_cache().backend)
    yield
    await simulator.stop()
    for t in tasks:
        t.cancel()
    await db.close()


app = FastAPI(
    title="LabLedger API",
    version="1.4.2",
    description="Shared model and dataset registry for the lab, plus the FieldSense telemetry API. "
                "Reads are public; writes need an `X-Registry-Token`.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Cache", "Server-Timing"],
)

# request latencies for the System page (ms)
_latencies: deque[float] = deque(maxlen=2000)


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    token = logs.request_id_var.set(rid)
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled_error", method=request.method, path=request.url.path)
        response = JSONResponse({"detail": "internal error", "request_id": rid}, status_code=500)
    ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = rid
    response.headers["Server-Timing"] = f"app;dur={ms:.1f}"
    path = request.url.path
    if path.startswith("/api/") and not path.startswith("/api/field/captures"):
        _latencies.append(ms)
        log.info("request", method=request.method, path=path, status=response.status_code,
                 duration_ms=round(ms, 1), cache=response.headers.get("X-Cache"))
    logs.request_id_var.reset(token)
    return response


app.include_router(registry_routes.router)
app.include_router(field_routes.router)


@app.get("/healthz", include_in_schema=False)
async def healthz():
    await db.get_pool().fetchval("SELECT 1")
    return {"ok": True}


@app.get("/api/v1/system", tags=["system"])
async def system():
    pool = db.get_pool()
    migrations = db.rows(await pool.fetch("SELECT version, name, applied_at FROM schema_migrations ORDER BY version"))
    lat = sorted(_latencies)
    pct = lambda p: round(lat[min(len(lat) - 1, int(p * len(lat)))], 1) if lat else None
    return {
        "version": app.version,
        "uptime_s": int(time.time() - STARTED),
        "schema": migrations,
        "database": {"ok": True, "pool_size": pool.get_size()},
        "cache": {**cache.get_cache().stats(), "ok": await cache.get_cache().ping()},
        "latency_ms": {"p50": pct(0.5), "p95": pct(0.95), "p99": pct(0.99), "samples": len(lat)},
        "logs": [e for e in list(logs.recent)[-60:] if e.get("path") != "/api/v1/system"][::-1],
    }


# Registry UI (single-page app) served from the same origin.
static = Path(settings.static_dir) if settings.static_dir else None
if static and static.is_dir():
    app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        f = static / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(static / "index.html")
