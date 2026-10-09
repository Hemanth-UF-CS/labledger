import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi } from "@shared/api";
import { useWidth, Tooltip } from "@shared/charts";
import { fmtDate, fmtMetric, metricLabel } from "@shared/format";
import { useState } from "react";
import type { ModelRow, Project, ProjectDetail as Detail } from "../types";
import { Async, PageHead, Who } from "../ui";
import { ModelTable } from "./Models";

export function Projects() {
  const state = useApi<Project[]>("/api/v1/projects");
  const nav = useNavigate();
  return (
    <>
      <PageHead title="Projects" sub="One project per research question. Each has an owner, a primary metric, and its own model lineage." />
      <div className="card">
        <Async state={state} skeleton={420}>
          {(rows) => (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Project</th><th>Task</th><th>Owner</th><th className="num">Versions</th><th>In production</th><th>Metric</th><th>Last version</th></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.slug} className="clickable" onClick={() => nav(`/projects/${p.slug}`)}>
                      <td><div>{p.name}</div><div className="mono small muted">{p.slug}</div></td>
                      <td className="secondary" style={{ maxWidth: 280 }}>{p.task}</td>
                      <td><Who handle={p.owner} name={p.owner_name} /></td>
                      <td className="num">{p.model_versions}</td>
                      <td className="mono">{p.production_version ?? <span className="muted">—</span>}</td>
                      <td className="small">{metricLabel(p.primary_metric)} <span className="muted">{p.metric_higher_is_better ? "↑" : "↓"}</span></td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(p.last_version_at)}</td>
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

const STAGE_FILL: Record<string, string> = {
  production: "var(--good)", staging: "var(--warn)", development: "var(--accent)", archived: "var(--ink-3)",
};

/** Primary metric across versions, in registration order. */
function MetricHistory({ models, metric, higher }: { models: ModelRow[]; metric: string; higher: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ x: number; y: number; content: JSX.Element } | null>(null);
  const nav = useNavigate();
  const pts = models.filter((m) => m.metric_value !== null);
  const vals = pts.map((m) => m.metric_value as number);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = { l: 46, r: 16, t: 14, b: 26 };
  const h = 190;
  const iw = width - pad.l - pad.r, ih = h - pad.t - pad.b;
  const span = hi - lo || 1;
  const y = (v: number) => pad.t + (1 - (v - (lo - span * 0.1)) / (span * 1.2)) * ih;
  const x = (i: number) => pad.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  // best-so-far step line
  let best = higher ? -Infinity : Infinity;
  const bestPath = pts.map((m, i) => {
    const v = m.metric_value as number;
    best = higher ? Math.max(best, v) : Math.min(best, v);
    return `${i === 0 ? "M" : "H"}${x(i).toFixed(1)}${i === 0 ? `,${y(best).toFixed(1)}` : ` V${y(best).toFixed(1)}`}`;
  }).join(" ");
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label={`${metricLabel(metric)} by version`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              <text x={pad.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="10.5" fill="var(--ink-3)">{fmtMetric(metric, v)}</text>
            </g>
          ))}
          <path d={bestPath} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} strokeDasharray="3 3" />
          {pts.map((m, i) => (
            <g key={m.id} style={{ cursor: "pointer" }} onClick={() => nav(`/models/${m.id}`)}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, content: (
                <><div className="t-head">{m.version} · {m.stage}</div><div className="t-row">{metricLabel(metric)}<b>{fmtMetric(metric, m.metric_value)}</b></div><div className="t-row muted">{m.architecture}</div></>
              ) })}
              onMouseLeave={() => setTip(null)}>
              <circle cx={x(i)} cy={y(m.metric_value as number)} r={12} fill="transparent" />
              <circle cx={x(i)} cy={y(m.metric_value as number)} r={5} fill={STAGE_FILL[m.stage]} stroke="var(--surface)" strokeWidth={2} />
              {(i === pts.length - 1 || i % Math.ceil(pts.length / Math.max(1, Math.floor(iw / 56))) === 0) && (
                <text x={x(i)} y={h - 8} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)" className="mono">{m.version}</text>
              )}
            </g>
          ))}
        </svg>
      )}
      <Tooltip tip={tip} />
      <div className="small muted" style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
        {Object.entries(STAGE_FILL).map(([k, c]) => (
          <span key={k} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><span className="swatch" style={{ background: c, borderRadius: "50%" }} />{k}</span>
        ))}
        <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><svg width="16" height="4"><path d="M0 2H16" stroke="var(--line-strong)" strokeDasharray="3 3" strokeWidth="1.5" /></svg>best so far</span>
      </div>
    </div>
  );
}

export function ProjectDetail() {
  const { slug } = useParams();
  const state = useApi<Detail>(`/api/v1/projects/${slug}`);
  return (
    <Async state={state} skeleton={520}>
      {(p) => (
        <>
          <PageHead
            crumbs={<><Link to="/projects">Projects</Link> / {p.slug}</>}
            title={p.name}
            sub={p.task}
            right={<div className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>Owner <Who handle={p.owner} name={p.owner_name} /></div>}
          />
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head">
                <h2>{metricLabel(p.primary_metric)} by version</h2>
                <span className="muted small">test split · {p.metric_higher_is_better ? "higher" : "lower"} is better</span>
              </div>
              <div className="card-body"><MetricHistory models={p.models} metric={p.primary_metric} higher={p.metric_higher_is_better} /></div>
            </div>
            <div className="stack">
              <div className="card"><div className="card-head"><h2>About</h2></div><div className="card-body secondary">{p.description}</div></div>
              <div className="card">
                <div className="card-head"><h2>Dataset versions</h2></div>
                <ul className="feed">
                  {p.dataset_versions.map((d) => (
                    <li key={d.version}>
                      <Link to={`/datasets#${d.slug}`} className="mono">{d.slug}@v{d.version}</Link>
                      <span className="secondary small">{d.n_samples.toLocaleString()} samples</span>
                      <span className="when">{fmtDate(d.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Model versions</h2><span className="muted small">{p.models.length}</span></div>
            <ModelTable rows={[...p.models].reverse()} showProject={false} />
          </div>
        </>
      )}
    </Async>
  );
}
