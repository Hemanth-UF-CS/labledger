"""Structured JSON logging.

Every line is one JSON object with a fixed set of keys, so someone debugging the
platform can filter by field (request_id, route, status) instead of guessing phrasing.
"""
import json
import logging
import sys
import time
from collections import deque
from contextvars import ContextVar

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

# Recent lines kept in memory for the System page.
recent: deque[dict] = deque(maxlen=200)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.getMessage(),
        }
        rid = request_id_var.get()
        if rid:
            entry["request_id"] = rid
        fields = getattr(record, "fields", None)
        if fields:
            entry.update(fields)
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        recent.append(entry)
        return json.dumps(entry, default=str)


def setup(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # uvicorn's access log duplicates our request log
    logging.getLogger("uvicorn.access").disabled = True


def get(name: str) -> "BoundLogger":
    return BoundLogger(logging.getLogger(name))


class BoundLogger:
    def __init__(self, logger: logging.Logger):
        self._logger = logger

    def _log(self, level: int, event: str, **fields) -> None:
        self._logger.log(level, event, extra={"fields": fields})

    def info(self, event: str, **fields) -> None:
        self._log(logging.INFO, event, **fields)

    def warning(self, event: str, **fields) -> None:
        self._log(logging.WARNING, event, **fields)

    def error(self, event: str, **fields) -> None:
        self._log(logging.ERROR, event, **fields)

    def exception(self, event: str, **fields) -> None:
        self._logger.exception(event, extra={"fields": fields})
