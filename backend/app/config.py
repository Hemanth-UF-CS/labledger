import os
from dataclasses import dataclass, field


def _list(name: str) -> list[str]:
    raw = os.getenv(name, "")
    return [s.strip() for s in raw.split(",") if s.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgresql://localhost/labledger")
    redis_url: str | None = os.getenv("REDIS_URL") or None
    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS"))
    write_token: str | None = os.getenv("WRITE_TOKEN") or None
    simulator_enabled: bool = os.getenv("FIELD_SIMULATOR", "1") == "1"
    static_dir: str = os.getenv("STATIC_DIR", "")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")


settings = Settings()
