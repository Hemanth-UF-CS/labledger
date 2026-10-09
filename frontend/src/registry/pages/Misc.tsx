import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useApi } from "@shared/api";
import { fmtAgo, fmtDate, fmtDateTime } from "@shared/format";
import type { Event, Researcher } from "../types";
import { Async, Avatar, PageHead } from "../ui";
import { Feed } from "./Overview";

export function People() {
  const state = useApi<Researcher[]>("/api/v1/researchers");
  const { hash } = useLocation();
  useEffect(() => {
    if (hash && state.data) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [hash, state.data]);
  return (
    <>
      <PageHead title="People" sub="Who owns what, so you can find prior work without having to ask around." />
      <div className="card">
        <Async state={state} skeleton={420}>
          {(rows) => (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Name</th><th>Role</th><th>Focus</th><th>Projects</th><th className="num">Versions</th><th>Last active</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.handle} id={r.handle} style={hash === `#${r.handle}` ? { outline: "2px solid var(--accent)", outlineOffset: -2 } : undefined}>
                      <td>
                        <span className="who"><Avatar handle={r.handle} name={r.name} />{r.name}</span>
                        <div className="mono small muted" style={{ marginLeft: 29 }}>@{r.handle}</div>
                      </td>
                      <td className="secondary">{r.role}</td>
                      <td className="secondary">{r.focus}</td>
                      <td>{(r.projects ?? []).map((p) => <div key={p.slug}><Link to={`/projects/${p.slug}`}>{p.name}</Link></div>)}</td>
                      <td className="num"><Link to={`/models?author=${r.handle}`}>{r.model_versions}</Link></td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.last_active ? fmtAgo(r.last_active) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </div>
    </>
  );
}

export function Activity() {
  const state = useApi<Event[]>("/api/v1/activity?limit=200");
  return (
    <>
      <PageHead title="Activity" sub="Registrations, stage changes, and dataset publications across the lab." />
      <Async state={state} skeleton={520}>
        {(events) => {
          const groups = new Map<string, Event[]>();
          for (const e of events) {
            const k = new Date(e.at).toLocaleDateString("en-US", { month: "long", year: "numeric" });
            groups.set(k, [...(groups.get(k) ?? []), e]);
          }
          return (
            <div className="stack">
              {[...groups.entries()].map(([month, evs]) => (
                <div className="card" key={month}>
                  <div className="card-head"><h2>{month}</h2><span className="muted small">{evs.length} events</span></div>
                  <Feed events={evs} />
                </div>
              ))}
            </div>
          );
        }}
      </Async>
    </>
  );
}

interface SystemInfo {
  version: string;
  uptime_s: number;
  schema: { version: number; name: string; applied_at: string }[];
  database: { ok: boolean; pool_size: number };
  cache: { backend: string; hits: number; misses: number; hit_ratio: number | null; ok: boolean };
  latency_ms: { p50: number | null; p95: number | null; p99: number | null; samples: number };
  logs: Record<string, unknown>[];
}

function uptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

export function System() {
  const state = useApi<SystemInfo>("/api/v1/system", { refreshMs: 5000 });
  return (
    <>
      <PageHead title="System" sub="Schema version, cache behaviour, and the API's own structured logs. Refreshes every 5 s." />
      <Async state={state} skeleton={520}>
        {(s) => (
          <>
            <div className="tiles">
              <div className="card tile"><div className="label">API</div><div className="value num">{s.version}</div><div className="hint">up {uptime(s.uptime_s)}</div></div>
              <div className="card tile"><div className="label">Latency p50 / p95</div><div className="value num">{s.latency_ms.p50 ?? "–"}<span className="muted" style={{ fontSize: 16 }}> / {s.latency_ms.p95 ?? "–"} ms</span></div><div className="hint">last {s.latency_ms.samples} API requests</div></div>
              <div className="card tile"><div className="label">Cache hit ratio</div><div className="value num">{s.cache.hit_ratio === null ? "–" : `${Math.round(s.cache.hit_ratio * 100)}%`}</div><div className="hint">{s.cache.backend} · {s.cache.hits} hits / {s.cache.misses} misses</div></div>
              <div className="card tile"><div className="label">Schema</div><div className="value num">v{s.schema[s.schema.length - 1]?.version ?? 0}</div><div className="hint">{s.schema.length} migrations applied</div></div>
            </div>
            <div className="grid-2">
              <div className="card">
                <div className="card-head"><h2>Request log</h2><span className="muted small">JSON lines, newest first</span></div>
                <div style={{ maxHeight: 520, overflow: "auto" }}>
                  {s.logs.map((l, i) => (
                    <div className="logline" key={i}>
                      <span className={`lvl-${l.level}`}>{JSON.stringify(l)}</span>
                    </div>
                  ))}
                  {s.logs.length === 0 && <div className="empty">No log lines yet.</div>}
                </div>
              </div>
              <div className="stack">
                <div className="card">
                  <div className="card-head"><h2>Migrations</h2></div>
                  <table className="data">
                    <tbody>
                      {s.schema.map((m) => (
                        <tr key={m.version}><td className="mono">{String(m.version).padStart(3, "0")}</td><td className="mono">{m.name.replace(/^\d+_/, "")}</td><td className="muted small" style={{ whiteSpace: "nowrap" }}>{fmtDate(m.applied_at)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card">
                  <div className="card-head"><h2>Dependencies</h2></div>
                  <div className="card-body">
                    <dl className="kv">
                      <dt>PostgreSQL</dt><dd>{s.database.ok ? "connected" : "down"} · pool {s.database.pool_size}</dd>
                      <dt>Cache</dt><dd>{s.cache.backend} · {s.cache.ok ? "reachable" : "unreachable (falling through to DB)"}</dd>
                      <dt>Checked</dt><dd>{fmtDateTime(new Date())}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Async>
    </>
  );
}
