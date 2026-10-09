import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "@shared/api";
import { fmtMetric, metricLabel, shortSha } from "@shared/format";
import type { Compare as CompareData, ModelRow } from "../types";
import { Async, PageHead, StageBadge } from "../ui";
import { fmtValue } from "./ModelDetail";

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const a = params.get("a");
  const b = params.get("b");
  const cmp = useApi<CompareData>(a && b ? `/api/v1/compare?a=${a}&b=${b}` : null);
  const project = cmp.data?.a.project;
  const siblings = useApi<ModelRow[]>(project ? `/api/v1/models?project=${project}` : null);

  const pick = (k: "a" | "b", v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };

  if (!a || !b) {
    return (
      <>
        <PageHead title="Compare versions" />
        <div className="card empty">Open a model version and choose “Compare with …” to diff it against another version.</div>
      </>
    );
  }

  return (
    <>
      <PageHead
        crumbs={<><Link to="/models">Models</Link> / compare</>}
        title="Compare versions"
        sub="Configuration, data, and code differences, and what they did to the result."
      />
      <Async state={cmp} skeleton={420}>
        {(c) => {
          const higher = c.a.metric_higher_is_better;
          const metricKeys = Object.keys({ ...(c.a.test_metrics ?? {}), ...(c.b.test_metrics ?? {}) });
          const changed = c.hyperparams.filter((h) => h.changed);
          return (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: "22%" }} />
                        {(["a", "b"] as const).map((k) => (
                          <th key={k}>
                            <select value={c[k].id} onChange={(e) => pick(k, e.target.value)} aria-label={`Version ${k.toUpperCase()}`}>
                              {(siblings.data ?? [c[k]]).map((m) => <option key={m.id} value={m.id}>{m.project} {m.version}</option>)}
                            </select>
                          </th>
                        ))}
                        <th className="num">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="muted">Stage</td><td><StageBadge stage={c.a.stage} /></td><td><StageBadge stage={c.b.stage} /></td><td /></tr>
                      <tr><td className="muted">Architecture</td><td>{c.a.architecture}</td><td>{c.b.architecture}</td><td /></tr>
                      <tr className={c.a.dataset_version_id !== c.b.dataset_version_id ? "changed" : ""}>
                        <td className="muted">Training data</td>
                        <td className="mono">{c.a.dataset}@v{c.a.dataset_version}</td>
                        <td className="mono">{c.b.dataset}@v{c.b.dataset_version}</td>
                        <td className="num small">{c.a.dataset_version_id !== c.b.dataset_version_id ? "different data" : "same data"}</td>
                      </tr>
                      <tr className={c.a.code_commit !== c.b.code_commit ? "changed" : ""}>
                        <td className="muted">Commit</td>
                        <td className="mono">{shortSha(c.a.code_commit)}</td>
                        <td className="mono">{shortSha(c.b.code_commit)}</td>
                        <td />
                      </tr>
                      {metricKeys.map((k) => {
                        const va = c.a.test_metrics?.[k];
                        const vb = c.b.test_metrics?.[k];
                        const d = va !== undefined && vb !== undefined ? vb - va : null;
                        const lowerBetter = k.startsWith("rmse") || k.startsWith("mae") || k === "mape" || k === "count_mae";
                        const good = d !== null && (k === c.a.primary_metric ? (higher ? d > 0 : d < 0) : lowerBetter ? d < 0 : d > 0);
                        return (
                          <tr key={k}>
                            <td className="muted">{metricLabel(k)} <span className="small">(test)</span></td>
                            <td className="num" style={{ textAlign: "left" }}>{fmtMetric(k, va)}</td>
                            <td className="num" style={{ textAlign: "left" }}>{fmtMetric(k, vb)}</td>
                            <td className={`num ${d === null || Math.abs(d) < 1e-9 ? "" : good ? "delta-good" : "delta-bad"}`}>
                              {d === null ? "–" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmtMetric(k, Math.abs(d))}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card">
                <div className="card-head">
                  <h2>Hyperparameters</h2>
                  <span className="muted small">{changed.length} of {c.hyperparams.length} differ</span>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Key</th><th>{c.a.version}</th><th>{c.b.version}</th></tr></thead>
                    <tbody>
                      {[...changed, ...c.hyperparams.filter((h) => !h.changed)].map((h) => (
                        <tr key={h.key} className={h.changed ? "changed" : ""}>
                          <td className="mono">{h.key}</td>
                          <td className={`mono ${h.changed ? "" : "muted"}`}>{fmtValue(h.a)}</td>
                          <td className={`mono ${h.changed ? "" : "muted"}`}>{fmtValue(h.b)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
