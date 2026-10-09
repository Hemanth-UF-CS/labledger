import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "@shared/api";
import { fmtDate, fmtMetric, metricLabel, shortSha } from "@shared/format";
import type { ModelRow, Project, Researcher } from "../types";
import { Async, PageHead, StageBadge, Who } from "../ui";

const STAGES = ["", "production", "staging", "development", "archived"];

export function ModelTable({ rows, showProject = true }: { rows: ModelRow[]; showProject?: boolean }) {
  const nav = useNavigate();
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {showProject && <th>Project</th>}
            <th>Version</th>
            <th>Stage</th>
            <th>Architecture</th>
            <th className="num">Test metric</th>
            <th>Data</th>
            <th>Commit</th>
            <th>Author</th>
            <th>Registered</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="clickable" onClick={() => nav(`/models/${m.id}`)}>
              {showProject && <td style={{ whiteSpace: "nowrap" }}>{m.project}</td>}
              <td><span className="mono">{m.version}</span></td>
              <td><StageBadge stage={m.stage} /></td>
              <td className="secondary">{m.architecture}</td>
              <td className="num" style={{ whiteSpace: "nowrap" }}>
                <span className="muted small">{metricLabel(m.primary_metric)}</span> {fmtMetric(m.primary_metric, m.metric_value)}
              </td>
              <td className="mono secondary" style={{ whiteSpace: "nowrap" }}>{m.dataset}@v{m.dataset_version}</td>
              <td className="mono secondary">{shortSha(m.code_commit)}</td>
              <td><Who handle={m.author} name={m.author_name} /></td>
              <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(m.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty">No model versions match these filters.</div>}
    </div>
  );
}

export default function Models() {
  const [params, setParams] = useSearchParams();
  const project = params.get("project") ?? "";
  const stage = params.get("stage") ?? "";
  const author = params.get("author") ?? "";
  const qs = new URLSearchParams();
  if (project) qs.set("project", project);
  if (stage) qs.set("stage", stage);
  if (author) qs.set("author", author);
  const models = useApi<ModelRow[]>(`/api/v1/models${qs.toString() ? `?${qs}` : ""}`);
  const projects = useApi<Project[]>("/api/v1/projects");
  const people = useApi<Researcher[]>("/api/v1/researchers");

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const projectOptions = useMemo(() => [...(projects.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [projects.data]);

  return (
    <>
      <PageHead
        title="Models"
        sub="Registered model versions across all projects. Click a row for its full provenance."
      />
      <div className="filters">
        <select value={project} onChange={(e) => set("project", e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projectOptions.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
        <div className="seg" role="group" aria-label="Stage">
          {STAGES.map((s) => (
            <button key={s || "all"} aria-pressed={stage === s} onClick={() => set("stage", s)}>{s || "All stages"}</button>
          ))}
        </div>
        <select value={author} onChange={(e) => set("author", e.target.value)} aria-label="Author">
          <option value="">Anyone</option>
          {(people.data ?? []).map((p) => <option key={p.handle} value={p.handle}>{p.name}</option>)}
        </select>
        {models.data && <span className="muted small num">{models.data.length} versions</span>}
      </div>
      <div className="card">
        <Async state={models} skeleton={420}>{(rows) => <ModelTable rows={rows} />}</Async>
      </div>
    </>
  );
}
