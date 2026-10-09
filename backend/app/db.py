import json

import asyncpg

pool: asyncpg.Pool | None = None


async def _init_conn(conn: asyncpg.Connection) -> None:
    for typ in ("json", "jsonb"):
        await conn.set_type_codec(typ, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def connect(dsn: str) -> asyncpg.Pool:
    global pool
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=8, init=_init_conn)
    return pool


async def close() -> None:
    if pool:
        await pool.close()


def get_pool() -> asyncpg.Pool:
    assert pool is not None, "database pool not initialised"
    return pool


def rows(records) -> list[dict]:
    return [dict(r) for r in records]
