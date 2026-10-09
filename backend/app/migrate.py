"""Forward-only SQL migrations, applied in filename order.

Each applied file is recorded with its checksum; editing a file after it has been
applied is refused, so the schema history in the repo always matches the database.
"""
import hashlib
from pathlib import Path

import asyncpg

from . import logs

log = logs.get("migrate")
MIGRATIONS_DIR = Path(__file__).parent / "migrations"
LOCK_ID = 74_210_331


async def run(pool: asyncpg.Pool) -> list[str]:
    applied_now: list[str] = []
    async with pool.acquire() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", LOCK_ID)
        try:
            await conn.execute(
                """CREATE TABLE IF NOT EXISTS schema_migrations (
                       version    int PRIMARY KEY,
                       name       text NOT NULL,
                       checksum   char(64) NOT NULL,
                       applied_at timestamptz NOT NULL DEFAULT now()
                   )"""
            )
            done = {r["version"]: r["checksum"] for r in await conn.fetch("SELECT version, checksum FROM schema_migrations")}
            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                version = int(path.name.split("_", 1)[0])
                sql = path.read_text()
                checksum = hashlib.sha256(sql.encode()).hexdigest()
                if version in done:
                    if done[version] != checksum:
                        raise RuntimeError(f"migration {path.name} was modified after being applied")
                    continue
                async with conn.transaction():
                    await conn.execute(sql)
                    await conn.execute(
                        "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
                        version, path.stem, checksum,
                    )
                log.info("migration_applied", version=version, name=path.stem)
                applied_now.append(path.stem)
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", LOCK_ID)
    return applied_now
