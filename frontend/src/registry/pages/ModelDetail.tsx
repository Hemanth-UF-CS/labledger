import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { API_URL, useApi } from "@shared/api";
import { fmtBytes, fmtDate, fmtDateTime, fmtInt, fmtMetric, metricLabel, shortSha } from "@shared/format";
import type { Compare, ModelDetail as Detail } from "../types";
import { Async, Copy, PageHead, StageBadge, Who } from "../ui";

export function fmtValue(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "[]";
  if (typeof v === "number") return Math.abs(v) > 0 && Math.abs(v) < 1e-2 ? v.toExponential(0) : String(v);
  return String(v);
}

function duration(a: string, b: string) {
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export default function ModelDetail() {
  const { id } = useParams();
  const state = useApi<Detail>(`/api/v1/models/${id}`);
  return (
    <Async state={state} skeleton={520}>
      {(m) => <Body m={m} key={m.id} />}
    </Async>
  );
}

function Body({ m }: { m: Detail }) {
  const [tab, setTab] = useState<"hp" | "evals" | "runs">("hp");
  const diff = useApi<Compare>(m.parent_id ? `/api/v1/compare?a=${m.parent_id}&b=${m.id}` : null);
  const changed = new Map((diff.data?.hyperparams ?? []).filter((h) => h.changed).map((h) => [h.key, h.a]));
  const parent = m.lineage.find((l) => l.id === m.parent_id);
  const hp = Object.entries(m.hyperparams).sort(([a], [b]) => a.localeCompare(b));
  const artifactName = m.artifact_uri.split("/").pop();
  const better = (a: number, b: number) => (m.metric_higher_is_better ? b > a : b < a);

  return (
    <>
      <PageHead
        crumbs={<><Link to="/models">Models</Link> / <Link to={`/projects/${m.project}`}>{m.project}</Link> / {m.version}</>}
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{m.project_name} <span className="mono" style={{ fontSize: 18 }}>{m.version}</span> <StageBadge stage={m.stage} /></span>}
        sub={<span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {m.architecture} · {m.framework} · registered {fmtDate(m.created_at)} by <Who handle={m.author} name={m.author_name} />
        </span>}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            {m.parent_id && <Link className="btn" to={`/compare?a=${m.parent_id}&b=${m.id}`}>Compare with {parent?.version}</Link>}
            <a className="btn" href={`${API_URL}/api/v1/models/${m.id}`} target="_blank" rel="noreferrer">JSON</a>
          </div>
        }
      />

      <div className="card prov" style={{ marginBottom: 16 }}>
        <div>
          <div className="k">Code</div>
          <div className="v mono">{shortSha(m.code_commit)} <Copy text={m.code_commit} /></div>
          <div className="s mono" title={m.code_repo}>{m.code_repo}</div>
        </div>
        <div>
          <div className="k">Data</div>
          <div className="v mono"><Link to={`/datasets#${m.dataset}`}>{m.dataset}@v{m.dataset_version}</Link></div>
          <div className="s">{fmtInt(m.dataset_samples)} samples · <span className="mono">sha256:{m.dataset_checksum.slice(0, 10)}</span> <Copy text={m.dataset_checksum} /></div>
        </div>
        <div>
          <div className="k">Config</div>
          <div className="v">{hp.length} hyperparameters</div>
          <div className="s">{m.parent_id ? (diff.data ? `${changed.size} changed from ${parent?.version}` : "comparing with parent…") : "first version"}</div>
        </div>
        <div>
          <div className="k">Artifact</div>
          <div className="v mono">{artifactName}</div>
          <div className="s">{fmtBytes(m.artifact_bytes)} · <span className="mono" title={m.artifact_uri}>{m.artifact_uri.replace(/\/[^/]+$/, "/")}</span> <Copy text={m.artifact_uri} /></div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "hp"} onClick={() => setTab("hp")}>Hyperparameters<span className="count">{hp.length}</span></button>
            <button role="tab" aria-selected={tab === "evals"} onClick={() => setTab("evals")}>Evaluations<span className="count">{m.evaluations.length}</span></button>
            <button role="tab" aria-selected={tab === "runs"} onClick={() => setTab("runs")}>Training runs<span className="count">{m.runs.length}</span></button>
          </div>
          {tab === "hp" && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Key</th><th>Value</th>{m.parent_id && <th>In {parent?.version}</th>}</tr></thead>
                <tbody>
                  {hp.map(([k, v]) => (
                    <tr key={k} className={changed.has(k) ? "changed" : ""}>
                      <td className="mono">{k}</td>
                      <td className="mono">{fmtValue(v)}</td>
                      {m.parent_id && <td className="mono muted">{changed.has(k) ? fmtValue(changed.get(k)) : ""}</td>}
                    </tr>
                  ))}
                  {[...changed.keys()].filter((k) => !(k in m.hyperparams)).map((k) => (
                    <tr key={k} className="changed">
                      <td className="mono">{k}</td><td className="mono muted">removed</td><td className="mono muted">{fmtValue(changed.get(k))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "evals" && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Dataset</th><th>Split</th>
                    {Object.keys(m.evaluations[0]?.metrics ?? {}).map((k) => <th key={k} className="num">{metricLabel(k)}</th>)}
                    <th>Evaluated</th>
                  </tr>
                </thead>
                <tbody>
                  {m.evaluations.map((e) => (
                    <tr key={e.id}>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>
                        {e.dataset}@v{e.dataset_version}
                        {!e.own_dataset && <span className="badge" style={{ marginLeft: 6 }} title="Re-evaluated on a newer dataset version">newer data</span>}
                      </td>
                      <td>{e.split}</td>
                      {Object.entries(e.metrics).map(([k, v]) => <td key={k} className="num">{fmtMetric(k, v)}</td>)}
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "runs" && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Run</th><th>Status</th><th>Host</th><th>Accelerator</th><th className="num">Seed</th><th className="num">Duration</th><th className="num">{metricLabel(m.primary_metric)}</th><th>Started</th></tr></thead>
                <tbody>
                  {m.runs.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">#{r.id}</td>
                      <td>
                        <span className="badge" style={{ color: r.status === "completed" ? "var(--good-ink)" : r.status === "failed" ? "var(--bad-ink)" : "var(--ink-3)" }}>
                          {r.status}
                        </span>
                      </td>
                      <td className="mono">{r.host}</td>
                      <td className="secondary">{r.accelerator}</td>
                      <td className="num">{r.seed}</td>
                      <td className="num">{duration(r.started_at, r.finished_at)}</td>
                      <td className="num">{fmtMetric(m.primary_metric, r.metrics[m.primary_metric])}</td>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Lineage</h2><span className="muted small">{metricLabel(m.primary_metric)} on own test split</span></div>
            <ul className="lineage">
              {m.lineage.map((l, i) => {
                const prev = m.lineage[i - 1];
                const d = prev && l.metric_value !== null && prev.metric_value !== null ? l.metric_value - prev.metric_value : null;
                return (
                  <li key={l.id} className={l.id === m.id ? "current" : ""}>
                    <span className="rail" />
                    <span>
                      <Link to={`/models/${l.id}`} className="mono" style={{ color: "var(--ink)" }}>{l.version}</Link>{" "}
                      <span className="muted small">{l.dataset}@v{l.dataset_version} · {shortSha(l.code_commit)}</span>
                    </span>
                    <span className="num small">
                      {fmtMetric(m.primary_metric, l.metric_value)}
                      {d !== null && (
                        <span className={better(0, d) ? "delta-good" : "delta-bad"} style={{ marginLeft: 6 }}>
                          {d > 0 ? "+" : "−"}{fmtMetric(m.primary_metric, Math.abs(d))}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {m.children.length > 0 && (
              <div className="card-body small" style={{ borderTop: "1px solid var(--line)", paddingTop: 10, paddingBottom: 12 }}>
                <span className="muted">Derived versions: </span>
                {m.children.map((c, i) => (
                  <span key={c.id}>{i > 0 && ", "}<Link to={`/models/${c.id}`} className="mono">{c.version}</Link> <span className="muted">({c.stage})</span></span>
                ))}
              </div>
            )}
          </div>
          {m.notes && (
            <div className="card">
              <div className="card-head"><h2>Notes</h2></div>
              <div className="card-body secondary">{m.notes}</div>
            </div>
          )}
          <div className="card">
            <div className="card-head"><h2>Training data</h2><span className="mono small muted">{m.dataset}@v{m.dataset_version}</span></div>
            <div className="card-body">
              <dl className="kv">
                <dt>Location</dt><dd className="mono small" style={{ wordBreak: "break-all" }}>{m.dataset_uri}</dd>
                <dt>Splits</dt><dd className="num">{Object.entries(m.dataset_splits).map(([k, v]) => `${k} ${fmtInt(v)}`).join(" · ")}</dd>
                <dt>Published</dt><dd>{fmtDate(m.dataset_created_at)}</dd>
                <dt>Notes</dt><dd className="secondary">{m.dataset_notes}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
