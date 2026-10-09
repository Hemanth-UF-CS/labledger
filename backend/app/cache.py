"""Read-through cache in front of the common registry read paths.

Keys are namespaced by a generation counter. A write bumps the generation, which
invalidates every cached read at once without having to track individual keys.
Falls back to an in-process dict when REDIS_URL isn't set (local dev, tests).
"""
import json
import time
from typing import Any, Awaitable, Callable

import redis.asyncio as redis

from . import logs

log = logs.get("cache")
GEN_KEY = "registry:gen"


class Cache:
    def __init__(self, url: str | None):
        self._redis = redis.from_url(url, decode_responses=True) if url else None
        self._local: dict[str, tuple[float, str]] = {}
        self._local_gen = 0
        self.hits = 0
        self.misses = 0
        self.backend = "redis" if url else "memory"

    async def _gen(self) -> int:
        if self._redis:
            return int(await self._redis.get(GEN_KEY) or 0)
        return self._local_gen

    async def get_or_load(self, key: str, ttl: int, loader: Callable[[], Awaitable[Any]]) -> tuple[Any, bool]:
        try:
            full = f"registry:v{await self._gen()}:{key}"
            raw = await self._get(full)
        except Exception as exc:  # cache must never take the API down
            log.warning("cache_unavailable", error=str(exc))
            return await loader(), False
        if raw is not None:
            self.hits += 1
            return json.loads(raw), True
        self.misses += 1
        value = await loader()
        try:
            await self._set(full, json.dumps(value, default=str), ttl)
        except Exception as exc:
            log.warning("cache_set_failed", error=str(exc))
        return value, False

    async def invalidate(self) -> None:
        if self._redis:
            await self._redis.incr(GEN_KEY)
        else:
            self._local_gen += 1
            self._local.clear()

    async def _get(self, key: str) -> str | None:
        if self._redis:
            return await self._redis.get(key)
        hit = self._local.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        return None

    async def _set(self, key: str, value: str, ttl: int) -> None:
        if self._redis:
            await self._redis.set(key, value, ex=ttl)
        else:
            self._local[key] = (time.monotonic() + ttl, value)

    async def ping(self) -> bool:
        if not self._redis:
            return True
        try:
            return bool(await self._redis.ping())
        except Exception:
            return False

    def stats(self) -> dict:
        total = self.hits + self.misses
        return {
            "backend": self.backend,
            "hits": self.hits,
            "misses": self.misses,
            "hit_ratio": round(self.hits / total, 3) if total else None,
        }


cache: Cache | None = None


def init(url: str | None) -> Cache:
    global cache
    cache = Cache(url)
    return cache


def get_cache() -> Cache:
    assert cache is not None
    return cache
