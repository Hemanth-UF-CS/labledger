"""Fan-out of live field events to WebSocket clients.

Each client subscribes to channels. A slow client gets its own bounded queue and
drops its oldest messages rather than holding up the publisher or other clients.
"""
import asyncio
import json
from datetime import datetime

from .. import logs

log = logs.get("field.hub")
CHANNELS = {"reading", "prediction", "health"}


def _json_default(o):
    if isinstance(o, datetime):
        return o.isoformat()
    raise TypeError(type(o))


class Client:
    def __init__(self):
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=256)
        self.channels: set[str] = set(CHANNELS)
        self.dropped = 0

    def offer(self, msg: str) -> None:
        if self.queue.full():
            self.queue.get_nowait()
            self.dropped += 1
        self.queue.put_nowait(msg)


class Hub:
    def __init__(self):
        self.clients: set[Client] = set()
        self.published = 0

    def add(self) -> Client:
        c = Client()
        self.clients.add(c)
        log.info("ws_client_connected", clients=len(self.clients))
        return c

    def remove(self, c: Client) -> None:
        self.clients.discard(c)
        log.info("ws_client_disconnected", clients=len(self.clients), dropped=c.dropped)

    async def publish(self, channel: str, data: dict) -> None:
        self.published += 1
        if not self.clients:
            return
        msg = json.dumps({"channel": channel, "data": data}, default=_json_default)
        for c in self.clients:
            if channel in c.channels:
                c.offer(msg)


hub = Hub()
