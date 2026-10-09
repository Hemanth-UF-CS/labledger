# LabLedger + FieldSense

**LabLedger** is a shared registry for a research lab's models, datasets, and results. Every model
version records the exact hyperparameters, dataset version (checksummed), and code commit that
produced it, so any number can be traced back months later.

**FieldSense** is the live dashboard for the soil-sensing field nodes (Raspberry Pi + camera +
soil/air sensors). It streams readings over WebSockets and shows the CNN-LSTM wet/dry classifier's
output for each node. Its model versions come from LabLedger.

This deployment runs on sample data: a deterministic simulator stands in for the field nodes.

## Layout

```
backend/    FastAPI service (registry API + field telemetry API + WebSocket stream)
  app/migrations/   forward-only SQL migrations, checksummed on apply
  app/registry/     registry routes and seed data
  app/field/        telemetry routes, WebSocket hub, node simulator, camera frame renderer
frontend/   Vite + React + TypeScript; two apps (registry, field) sharing src/shared
render.yaml Render blueprint: API, Postgres, Redis-compatible cache, two static sites
```

## Design notes

- **Provenance is immutable.** A trigger rejects updates to a model version's hyperparameters,
  dataset version, architecture, or commit. Changing any of them means registering a new version.
- **Read-through cache.** Common registry reads go through Redis with a generation counter in the
  key; any write bumps the generation, invalidating everything without key tracking. Responses
  carry `X-Cache: HIT|MISS`. If Redis is unreachable, reads fall through to Postgres.
- **Structured logs.** One JSON object per line with a request id that is also returned as
  `X-Request-ID`, so a user's report can be matched to the exact log lines.
- **WebSocket fan-out.** Each client has a bounded queue; a slow client drops its own oldest
  messages instead of stalling the publisher.

## Running locally

```
createdb labledger
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
REDIS_URL=redis://localhost:6379/0 .venv/bin/uvicorn app.main:app --port 8000

cd frontend && npm ci
VITE_API_URL=http://127.0.0.1:8000 npm run dev:registry     # :5173
VITE_API_URL=http://127.0.0.1:8000 npm run dev:field        # :5174
```

API reference: `/docs` on the backend.
