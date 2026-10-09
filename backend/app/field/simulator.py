"""Sample-data source for the field nodes.

Stands in for the Raspberry Pi nodes: produces one reading per node every 30 s and a
camera capture + wet/dry classification every 5 min in daylight. Weather is a
deterministic function of time (shared by all nodes); soil state is integrated per node.
After a restart, the gap since the last stored reading is backfilled, the way real
nodes upload their buffered readings after a connectivity outage.
"""
import asyncio
import hashlib
import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

from .. import logs
from ..db import get_pool
from .hub import hub

log = logs.get("field.sim")
UTC = timezone.utc
LOCAL = ZoneInfo("America/New_York")
SAMPLE_S = 30
CAPTURE_S = 300
HISTORY_DAYS = 14
FINE_WINDOW = timedelta(hours=6)   # backfill older than this at capture resolution
COARSE_S = 300
RETENTION_DAYS = 15

THETA_R, FIELD_CAPACITY = 4.5, 12.5   # fine sand, % VWC


@dataclass(frozen=True)
class Node:
    id: str
    name: str
    plot: str
    crop: str
    irrigation: str
    lat: float
    lon: float
    ph_base: float
    ec_base: float
    rssi_base: int
    battery_offset: float
    loss_rate: float
    kc: float


NODES = [
    Node("N01", "Plot A1", "A1", "Cabbage", "drip 08:30", 29.6412, -82.3617, 6.42, 0.52, -62, 0.00, 0.004, 0.70),
    Node("N02", "Plot A2", "A2", "Cabbage", "drip 08:30, 15:00", 29.6414, -82.3611, 6.21, 0.61, -66, 0.00, 0.004, 0.70),
    Node("N03", "Plot B1", "B1", "Collards", "overhead 08:00, 12:00, 16:00", 29.6405, -82.3609, 6.55, 0.47, -71, -0.13, 0.012, 0.65),
    Node("N04", "Plot B4", "B4", "Bare fallow (control)", "rainfed", 29.6398, -82.3596, 5.94, 0.33, -86, 0.00, 0.075, 0.45),
    Node("N05", "Plot C2", "C2", "Broccoli", "drip 09:00", 29.6409, -82.3627, 6.36, 0.58, -64, 0.00, 0.004, 0.70),
    Node("N06", "Plot C3", "C3", "Broccoli", "rainfed", 29.6403, -82.3631, 6.63, 0.41, -68, 0.00, 0.006, 0.60),
]
NODE_BY_ID = {n.id: n for n in NODES}

# N05's pH electrode starts drifting here; shows up as a health issue on the dashboard.
PH_DRIFT_START = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)


# ---------- deterministic weather ----------

def _h01(*parts) -> float:
    d = hashlib.blake2b("|".join(map(str, parts)).encode(), digest_size=8).digest()
    return int.from_bytes(d, "big") / 2**64


@lru_cache(maxsize=65536)
def _knot(key: str, i: int) -> float:
    return _h01(key, i) * 2 - 1


def smooth(key: str, hours: float, scale_h: float) -> float:
    """Smooth value noise in [-1, 1] with features about scale_h hours wide."""
    x = hours / scale_h
    i = math.floor(x)
    f = x - i
    f = f * f * (3 - 2 * f)
    return _knot(key, i) * (1 - f) + _knot(key, i + 1) * f


def _hours(ts: datetime) -> float:
    return ts.timestamp() / 3600.0


@lru_cache(maxsize=4096)
def _rain_event(day: str) -> tuple[float, float, float] | None:
    """(start_hour_local, duration_h, peak_mm_per_h) for an afternoon storm, or None."""
    if _h01("rain", day) > 0.27:
        return None
    start = 13.0 + _h01("rain-start", day) * 5.0
    dur = 0.4 + _h01("rain-dur", day) * 1.8
    peak = 5.0 + _h01("rain-peak", day) ** 1.6 * 32.0
    return start, dur, peak


def rain_rate(ts: datetime) -> float:
    lt = ts.astimezone(LOCAL)
    ev = _rain_event(lt.strftime("%Y-%m-%d"))
    if not ev:
        return 0.0
    start, dur, peak = ev
    h = lt.hour + lt.minute / 60 + lt.second / 3600
    if not (start <= h <= start + dur):
        return 0.0
    x = (h - start) / dur
    return peak * math.sin(math.pi * x) ** 1.5


def recent_rain(ts: datetime, minutes: int = 60) -> float:
    return sum(rain_rate(ts - timedelta(minutes=m)) for m in range(0, minutes, 5)) * 5 / 60


def daylight(ts: datetime) -> float:
    """0 at night, rising to 1 at solar noon. Approximate N. Florida sun times."""
    lt = ts.astimezone(LOCAL)
    doy = lt.timetuple().tm_yday
    half_day = 6.05 + 1.05 * math.cos(2 * math.pi * (doy - 172) / 365)   # hours
    noon = 13.45 if lt.dst() else 12.45
    h = lt.hour + lt.minute / 60 + lt.second / 3600
    x = (h - (noon - half_day)) / (2 * half_day)
    return math.sin(math.pi * x) if 0 < x < 1 else 0.0


def cloud(ts: datetime) -> float:
    c = 0.32 + 0.38 * smooth("cloud", _hours(ts), 4)
    if rain_rate(ts) > 0 or rain_rate(ts + timedelta(minutes=40)) > 0:
        c += 0.5
    return min(1.0, max(0.0, c))


def weather(ts: datetime) -> dict:
    lt = ts.astimezone(LOCAL)
    doy = lt.timetuple().tm_yday
    h = lt.hour + lt.minute / 60
    hrs = _hours(ts)
    c = cloud(ts)
    rr = rain_rate(ts)
    t_mean = 20.5 + 6.5 * math.cos(2 * math.pi * (doy - 196) / 365) + 2.0 * smooth("tmean", hrs, 60)
    shape = math.sin(2 * math.pi * (h - 9) / 24)
    air = t_mean + 6.0 * (1 - 0.5 * c) * shape + 0.8 * smooth("t", hrs, 5) - 3.0 * min(1.0, rr / 6)
    rh = 74 - 22 * shape * (1 - 0.4 * c) + 6 * smooth("rh", hrs, 6) + (22 if rr > 0 else 0)
    lux = 98_000 * daylight(ts) ** 1.25 * (1 - 0.72 * c) * (1 + 0.06 * smooth("lux", hrs * 12, 1))
    return {"air_temp": air, "humidity": max(32.0, min(99.0, rh)), "light": max(0.0, lux), "rain_rate": rr, "cloud": c}


def irrigation_rate(node: Node, ts: datetime) -> float:
    """Applied water at the sensor, mm/h."""
    lt = ts.astimezone(LOCAL)
    h = lt.hour + lt.minute / 60
    if node.irrigation == "rainfed":
        return 0.0
    if node.irrigation.startswith("overhead"):
        # skipped on days it has already rained
        if any(rain_rate(lt.replace(hour=hh, minute=0).astimezone(UTC)) > 0 for hh in range(6, int(h) + 1)):
            return 0.0
        return 12.0 if any(s <= h < s + 0.25 for s in (8, 12, 16)) else 0.0
    windows = {"N01": [(8.5, 0.75)], "N02": [(8.5, 0.75), (15.0, 0.5)], "N05": [(9.0, 0.66)]}[node.id]
    return 5.0 if any(s <= h < s + d for s, d in windows) else 0.0


def recently_irrigated(node: Node, ts: datetime, minutes: int = 50) -> bool:
    return any(irrigation_rate(node, ts - timedelta(minutes=m)) > 0 for m in range(0, minutes, 5))


# ---------- per-node soil state ----------

@dataclass
class State:
    ts: datetime
    theta: float
    soil_temp: float


def step(node: Node, st: State, ts: datetime, rng: random.Random) -> dict:
    dt = (ts - st.ts).total_seconds() / 3600
    w = weather(ts)
    water = (w["rain_rate"] + irrigation_rate(node, ts)) * dt
    theta = st.theta + water * 0.55
    if theta > FIELD_CAPACITY:
        theta -= (theta - FIELD_CAPACITY) * (1 - math.exp(-dt / 1.3))
    et = 0.0042 * w["light"] / 1000 * (1 + 0.03 * (w["air_temp"] - 20)) * node.kc
    avail = min(1.0, max(0.0, (theta - THETA_R) / (FIELD_CAPACITY - THETA_R)))
    theta = max(THETA_R + 0.4, theta - et * dt * 0.55 * avail)

    target = w["air_temp"] * 0.82 + 4.0 - 1.1 * (theta - 8) / 10 + 3.5 * w["light"] / 98_000
    soil_temp = st.soil_temp + (target - st.soil_temp) * (1 - math.exp(-dt / 3.0))

    hrs = _hours(ts)
    ph = node.ph_base + 0.06 * smooth("ph" + node.id, hrs, 18) - 0.08 * min(1.0, recent_rain(ts, 120) / 5) + rng.gauss(0, 0.015)
    if node.id == "N05" and ts > PH_DRIFT_START:
        days = (ts - PH_DRIFT_START).total_seconds() / 86400
        ph += min(0.9, 0.11 * days) + rng.gauss(0, 0.04 + 0.012 * days)
    lt = ts.astimezone(LOCAL)
    fert = 0.0
    if node.irrigation.startswith("drip") and lt.weekday() in (0, 3):
        h = lt.hour + lt.minute / 60
        if h >= 8.5:
            fert = 0.28 * math.exp(-(h - 8.5) / 10)
    ec = node.ec_base * (0.35 + theta / 16) + fert + rng.gauss(0, 0.008)

    charge = min(1.0, w["light"] / 40_000) ** 0.5
    battery = 3.79 + 0.33 * charge + node.battery_offset + 0.015 * smooth("bat" + node.id, hrs, 8) + rng.gauss(0, 0.004)
    rssi = int(round(node.rssi_base + 3 * smooth("rssi" + node.id, hrs, 2) + rng.gauss(0, 1.2)))

    st.ts, st.theta, st.soil_temp = ts, theta, soil_temp
    return {
        "node_id": node.id, "ts": ts,
        "soil_moisture": round(theta + rng.gauss(0, 0.04), 2),
        "soil_temp": round(soil_temp + rng.gauss(0, 0.05), 2),
        "air_temp": round(w["air_temp"] + rng.gauss(0, 0.08), 2),
        "humidity": round(w["humidity"] + rng.gauss(0, 0.4), 1),
        "ph": round(ph, 2),
        "ec": round(max(0.05, ec), 3),
        "light": round(w["light"] + abs(rng.gauss(0, 30)), 0),
        "rain_mm": round(w["rain_rate"] * dt, 2),
        "battery_v": round(battery, 3),
        "rssi": rssi,
    }


def classify(node: Node, reading: dict, rng: random.Random) -> dict:
    """Wet/dry output standing in for the on-node CNN-LSTM."""
    ts = reading["ts"]
    theta = reading["soil_moisture"]
    rained = recent_rain(ts) > 0.2
    irrigated = recently_irrigated(node, ts)
    # latent surface wetness: positive means the surface is visibly wet
    s = 1.8 * (theta - 13.6) + (3.5 if rained else 0) + (2.8 if irrigated else 0)
    wet_now = s > 0
    z = s + rng.gauss(0, 0.9)
    p = 1 / (1 + math.exp(-z))
    return {
        "node_id": node.id, "ts": ts, "label": int(p >= 0.5), "p_wet": round(p, 4),
        "soil_moisture": theta, "image_seed": rng.randint(1, 2**31 - 1),
        "latency_ms": round(max(120.0, rng.gauss(188, 14)), 1),
        "ground_truth": int(wet_now) if rng.random() < 0.3 else None,
    }


READING_COLS = ["node_id", "ts", "soil_moisture", "soil_temp", "air_temp", "humidity", "ph", "ec",
                "light", "rain_mm", "battery_v", "rssi"]
PRED_COLS = ["node_id", "ts", "model_version_id", "label", "p_wet", "soil_moisture", "image_seed", "latency_ms", "ground_truth"]


class Simulator:
    def __init__(self):
        self.states: dict[str, State] = {}
        self.model_version_id: int | None = None
        self._task: asyncio.Task | None = None
        self.ready = asyncio.Event()

    async def _production_model(self, conn) -> int:
        return await conn.fetchval(
            "SELECT id FROM model_versions WHERE name = 'wetdry' AND stage = 'production' ORDER BY created_at DESC LIMIT 1")

    async def ensure_nodes(self, conn) -> None:
        await conn.executemany(
            """INSERT INTO field_nodes (id, name, plot, crop, irrigation, lat, lon, hardware, firmware, installed_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING""",
            [(n.id, n.name, n.plot, n.crop, n.irrigation, n.lat, n.lon,
              "Raspberry Pi 4B · Camera Module 3 · ADS1115",
              "fieldnode 2.4.1", datetime(2025, 2, 10 + i).date() if i < 4 else datetime(2025, 11, 3).date())
             for i, n in enumerate(NODES)])

    async def load_states(self, conn) -> None:
        now = datetime.now(UTC)
        for i, n in enumerate(NODES):
            r = await conn.fetchrow("SELECT ts, soil_moisture, soil_temp FROM readings WHERE node_id = $1 ORDER BY ts DESC LIMIT 1", n.id)
            if r:
                self.states[n.id] = State(r["ts"], r["soil_moisture"], r["soil_temp"])
            else:
                # nodes report on a 30 s cycle, offset 5 s from each other
                start = (now - timedelta(days=HISTORY_DAYS)).replace(second=0, microsecond=0) + timedelta(seconds=5 * i)
                self.states[n.id] = State(start, 8.5, 22.0)

    def _simulate(self, until: datetime) -> tuple[list[dict], list[dict]]:
        readings, preds = [], []
        for n in NODES:
            st = self.states[n.id]
            ts = st.ts
            while True:
                fine = until - ts <= FINE_WINDOW
                nxt = ts + timedelta(seconds=SAMPLE_S if fine else COARSE_S)
                if fine:
                    nxt = nxt.replace(microsecond=0)
                if nxt > until:
                    break
                rng = random.Random(f"{n.id}{nxt.isoformat()}")
                r = step(n, st, nxt, rng)
                if rng.random() >= n.loss_rate:
                    readings.append(r)
                if _capture_due(ts, nxt) and daylight(nxt) > 0.08:
                    preds.append(classify(n, r, rng))
                ts = nxt
        return readings, preds

    async def backfill(self, conn, until: datetime) -> int:
        # CPU-bound; keep it off the event loop so the API stays responsive while catching up
        readings, preds = await asyncio.to_thread(self._simulate, until)
        await self._write(conn, readings, preds)
        return len(readings)

    async def _write(self, conn, readings: list[dict], preds: list[dict]) -> None:
        if readings:
            await conn.copy_records_to_table("readings", columns=READING_COLS,
                                             records=[tuple(r[c] for c in READING_COLS) for r in readings])
        if preds:
            for p in preds:
                p["model_version_id"] = self.model_version_id
            await conn.copy_records_to_table("predictions", columns=PRED_COLS,
                                             records=[tuple(p[c] for c in PRED_COLS) for p in preds])

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _run(self) -> None:
        pool = get_pool()
        try:
            async with pool.acquire() as conn:
                await self.ensure_nodes(conn)
                self.model_version_id = await self._production_model(conn)
                await self.load_states(conn)
                n = await self.backfill(conn, datetime.now(UTC) - timedelta(seconds=SAMPLE_S))
                log.info("backfill_complete", readings=n)
        except Exception:
            log.exception("backfill_failed")
        self.ready.set()

        last_prune = datetime.min.replace(tzinfo=UTC)
        while True:
            try:
                await asyncio.sleep(1)
                now = datetime.now(UTC)
                for n in NODES:
                    st = self.states[n.id]
                    due = st.ts + timedelta(seconds=SAMPLE_S)
                    if now < due:
                        continue
                    if now - due > timedelta(minutes=2):
                        async with pool.acquire() as conn:
                            await self.backfill(conn, now - timedelta(seconds=SAMPLE_S))
                        continue
                    rng = random.Random(f"{n.id}{due.isoformat()}")
                    r = step(n, st, due, rng)
                    pred = None
                    if _capture_due(due - timedelta(seconds=SAMPLE_S), due) and daylight(due) > 0.08:
                        pred = classify(n, r, rng)
                    if rng.random() < n.loss_rate:
                        continue
                    async with pool.acquire() as conn:
                        await self._write(conn, [r], [pred] if pred else [])
                        if pred:
                            pred["id"] = await conn.fetchval(
                                "SELECT id FROM predictions WHERE node_id = $1 AND ts = $2 ORDER BY id DESC LIMIT 1", n.id, due)
                    await hub.publish("reading", {k: v for k, v in r.items()})
                    if pred:
                        await hub.publish("prediction", pred)
                if now - last_prune > timedelta(hours=1):
                    async with pool.acquire() as conn:
                        cutoff = now - timedelta(days=RETENTION_DAYS)
                        await conn.execute("DELETE FROM readings WHERE ts < $1", cutoff)
                        await conn.execute("DELETE FROM predictions WHERE ts < $1", cutoff)
                    last_prune = now
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("simulator_tick_failed")
                await asyncio.sleep(5)


def _capture_due(prev: datetime, cur: datetime) -> bool:
    return int(prev.timestamp()) // CAPTURE_S != int(cur.timestamp()) // CAPTURE_S


simulator = Simulator()
