import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useApi } from "@shared/api";
import { fmtBytes, fmtDate, fmtInt } from "@shared/format";
import type { Dataset } from "../types";
import { Async, Copy, PageHead } from "../ui";

export default function Datasets() {
  const state = useApi<Dataset[]>("/api/v1/datasets");
  const { hash } = useLocation();
  useEffect(() => {
    if (hash && state.data) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash, state.data]);

  return (
    <>
      <PageHead
        title="Datasets"
        sub="Each version is immutable and content-addressed. A model version points at exactly one of them."
      />
      <Async state={state} skeleton={520}>
        {(datasets) => (
          <div className="stack">
            {datasets.map((d) => (
              <div className="card" key={d.slug} id={d.slug} style={{ scrollMarginTop: 70, outline: hash === `#${d.slug}` ? "2px solid var(--accent)" : undefined }}>
                <div className="card-head" style={{ alignItems: "flex-start" }}>
                  <div>
                    <h2>{d.name}</h2>
                    <div className="small secondary" style={{ marginTop: 3, maxWidth: 760 }}>{d.description}</div>
                  </div>
                  <div className="small muted" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div className="mono">{d.slug}</div>
                    <div>{d.modality} · <Link to={`/projects/${d.project}`}>{d.project}</Link></div>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr><th>Version</th><th className="num">Samples</th><th className="num">Size</th><th>Checksum</th><th>Notes</th><th>Used by</th><th>Published</th></tr>
                    </thead>
                    <tbody>
                      {d.versions.map((v) => (
                        <tr key={v.id}>
                          <td className="mono">v{v.version}</td>
                          <td className="num">{fmtInt(v.n_samples)}</td>
                          <td className="num" style={{ whiteSpace: "nowrap" }}>{fmtBytes(v.size_bytes)}</td>
                          <td className="mono secondary" style={{ whiteSpace: "nowrap" }}>{v.checksum.slice(0, 12)} <Copy text={v.checksum} /></td>
                          <td className="secondary" style={{ minWidth: 220 }}>{v.notes}</td>
                          <td style={{ minWidth: 140 }}>
                            {(v.used_by ?? []).map((m, i) => (
                              <span key={m.id}>{i > 0 && ", "}<Link to={`/models/${m.id}`} className="mono">{m.version}</Link></span>
                            ))}
                            {!v.used_by && <span className="muted">—</span>}
                          </td>
                          <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(v.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Async>
    </>
  );
}
