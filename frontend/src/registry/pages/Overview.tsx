import { Link, useNavigate } from "react-router-dom";
import { useApi } from "@shared/api";
import { ColumnChart } from "@shared/charts";
import { fmtAgo, fmtDate, fmtInt, fmtMetric, metricLabel } from "@shared/format";
import type { Event, ModelRow, Stats } from "../types";
import { Async, Avatar, PageHead, StageBadge, Who } from "../ui";

export function Feed({ events }: { events: Event[] }) {
  return (
    <ul className="feed">
      {events.map((e) => (
        <li key={e.id}>
          <Avatar handle={e.actor} name={e.actor_name} />
          <div style={{ minWidth: 0 }}>
            <div>
              {e.subject_type === "model_version" ? <Link to={`/models/${e.subject_id}`}>{e.summary}</Link> : e.summary}
            </div>
            <div className="small muted">
              {e.actor_name} · <span title={fmtDate(e.at)}>{fmtAgo(e.at)}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Overview() {
  const stats = useApi<Stats>("/api/v1/stats");
  const prod = useApi<ModelRow[]>("/api/v1/models?stage=production");
  const events = useApi<Event[]>("/api/v1/activity?limit=12");
  const nav = useNavigate();

  return (
    <>
      <PageHead title="Overview" sub="Every model version, the data and code that produced it, and how it scored." />
      <Async state={stats} skeleton={96}>
        {(s) => (
          <div className="tiles">
            <div className="card tile"><div className="label">Model versions</div><div className="value num">{s.model_versions}</div><div className="hint">{s.in_production} in production</div></div>
            <div className="card tile"><div className="label">Dataset versions</div><div className="value num">{s.dataset_versions}</div><div className="hint">checksummed, immutable</div></div>
            <div className="card tile"><div className="label">Training runs</div><div className="value num">{fmtInt(s.runs)}</div><div className="hint">{fmtInt(s.evaluations)} evaluations</div></div>
            <div className="card tile"><div className="label">Projects</div><div className="value num">{s.projects}</div><div className="hint">{s.researchers} researchers</div></div>
          </div>
        )}
      </Async>

      <div className="grid-2">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>In production</h2><Link to="/models?stage=production" className="small">All models</Link></div>
            <Async state={prod}>
              {(rows) => (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Project</th><th>Version</th><th className="num">Test metric</th><th>Owner</th><th>Registered</th></tr></thead>
                    <tbody>
                      {rows.map((m) => (
                        <tr key={m.id} className="clickable" tabIndex={0} onClick={() => nav(`/models/${m.id}`)} onKeyDown={(e) => e.key === "Enter" && nav(`/models/${m.id}`)}>
                          <td>{m.project_name}</td>
                          <td><span className="mono">{m.version}</span></td>
                          <td className="num">
                            <span className="muted small">{metricLabel(m.primary_metric)}</span>{" "}
                            {fmtMetric(m.primary_metric, m.metric_value)}
                          </td>
                          <td><Who handle={m.author} name={m.author_name} /></td>
                          <td className="muted">{fmtDate(m.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Async>
          </div>
          <div className="card">
            <div className="card-head"><h2>Versions registered per month</h2></div>
            <div className="card-body">
              <Async state={stats} skeleton={140}>
                {(s) => (
                  <ColumnChart
                    label="Model versions registered per month"
                    data={s.versions_by_month.map((m) => ({
                      key: m.month,
                      label: new Date(`${m.month}-15`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
                      value: m.n,
                    }))}
                  />
                )}
              </Async>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Recent activity</h2><Link to="/activity" className="small">View all</Link></div>
          <Async state={events}>{(ev) => <Feed events={ev} />}</Async>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <StageLegend />
      </div>
    </>
  );
}

function StageLegend() {
  return (
    <div className="small muted" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
      Stages:
      <StageBadge stage="development" />
      <StageBadge stage="staging" />
      <StageBadge stage="production" />
      <StageBadge stage="archived" />
      <span>Provenance fields (config, data version, commit) are locked once a version is registered.</span>
    </div>
  );
}
