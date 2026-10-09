import { useEffect, useMemo, useState } from "react";
import { API_URL, baseUrl, getJson, useApi } from "@shared/api";
import { Heatmap, LineChart, SeqLegend, Sparkline, Tooltip, useWidth } from "@shared/charts";
import { fmtAgo, fmtDateTime, fmtInt, fmtNum, fmtTime, fmtTimeSec, shortSha } from "@shared/format";
import type { FieldNode, Health, MetricKey, ModelInfo, Overview, Prediction, Reading, Series } from "./types";
import { LiveMessage, useLive } from "./useLive";

const REGISTRY_URL = baseUrl(import.meta.env.VITE_REGISTRY_URL as string | undefined);

const SENSORS: { key: MetricKey; label: string; unit: string; digits: number; scale?: number; bars?: boolean }[] = [
  { key: "soil_moisture", label: "Soil moisture", unit: "% VWC", digits: 1 },
  { key: "soil_temp", label: "Soil temperature (10 cm)", unit: "°C", digits: 1 },
  { key: "air_temp", label: "Air temperature", unit: "°C", digits: 1 },
  { key: "humidity", label: "Relative humidity", unit: "%", digits: 0 },
  { key: "ph", label: "Soil pH", unit: "", digits: 2 },
  { key: "ec", label: "Bulk EC", unit: "dS/m", digits: 2 },
  { key: "light", label: "Light", unit: "klux", digits: 1, scale: 1000 },
  { key: "rain_mm", label: "Rain", unit: "mm", digits: 1, bars: true },
];
const RANGES = [
  { h: 6, label: "6h" },
  { h: 24, label: "24h" },
  { h: 72, label: "3d" },
  { h: 168, label: "7d" },
];

function HealthMark({ score }: { score: number }) {
  if (score >= 90)
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-label="healthy"><circle cx="8" cy="8" r="7" fill="var(--good)" /><path d="m4.8 8.2 2.1 2.1 4.3-4.6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
    );
  if (score >= 75)
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-label="warning"><path d="M8 1.5 15 14H1z" fill="var(--warn)" /><path d="M8 6v3.5M8 11.5v.5" stroke="#3b2a00" strokeWidth="1.7" strokeLinecap="round" /></svg>
    );
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-label="critical"><rect x="1" y="1" width="14" height="14" rx="3" fill="var(--bad)" /><path d="m5.5 5.5 5 5m0-5-5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
}

function WetDry({ p, label }: { p: number; label: 0 | 1 }) {
  return (
    <span className={`chip ${label ? "wet" : "dry"}`}>
      {label ? "WET" : "DRY"} <span className="p">{Math.round((label ? p : 1 - p) * 100)}%</span>
    </span>
  );
}

const capUrl = (id: number) => `${API_URL}/api/field/captures/${id}.jpg`;

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function NodeCard({ n, spark, selected, onClick, now }: { n: FieldNode; spark?: (number | null)[]; selected: boolean; onClick: () => void; now: number }) {
  const r = n.latest;
  const recent = n.prediction && now - new Date(n.prediction.ts).getTime() < 30 * 60_000;
  return (
    <button className="card node" aria-pressed={selected} onClick={onClick}>
      <div className="row">
        <span className="id">{n.id}</span>
        {recent && n.prediction ? <WetDry p={n.prediction.p_wet} label={n.prediction.label} /> : <span className="chip idle">CAMERA IDLE</span>}
      </div>
      <div className="crop">{n.plot} · {n.crop}</div>
      <div className="big num">{r ? r.soil_moisture.toFixed(1) : "–"}<small>% VWC</small></div>
      <Sparkline values={spark ?? []} threshold={13.6} />
      <div className="foot">
        {n.health ? (
          <span className="health"><HealthMark score={n.health.score} />{n.health.score}</span>
        ) : <span />}
        <span>{r ? fmtAgo(r.ts, now) : "–"}</span>
      </div>
    </button>
  );
}

function CapturePanel({ node, captures, daylight }: { node: FieldNode; captures: Prediction[] | undefined; daylight: boolean }) {
  const [pickedId, setPickedId] = useState<number | null>(null);
  useEffect(() => setPickedId(null), [node.id]);
  const shown = captures?.find((c) => c.id === pickedId) ?? captures?.[0];
  return (
    <div className="card">
      <div className="card-head">
        <h2>Camera · {node.id}</h2>
        <span className="small muted">every 5 min in daylight</span>
      </div>
      <div className="card-body">
        <div className="capture">
          {shown && <img src={capUrl(shown.id)} alt={`${node.id} soil surface at ${fmtDateTime(shown.ts)}`} />}
          {shown && <div className="overlay"><WetDry p={shown.p_wet} label={shown.label} /></div>}
        </div>
        {!daylight && pickedId === null && (
          <div className="small muted" style={{ marginTop: 8 }}>
            Camera is idle after sunset (no IR illumination). Showing the last daylight frame; sensors keep reporting.
          </div>
        )}
        {shown && (
          <div className="cap-meta">
            <div><span>Captured</span><b>{fmtTimeSec(shown.ts)}</b></div>
            <div><span>P(wet)</span><b>{shown.p_wet.toFixed(3)}</b></div>
            <div><span>VWC at capture</span><b>{shown.soil_moisture.toFixed(1)}%</b></div>
            <div><span>Inference</span><b>{shown.latency_ms.toFixed(0)} ms</b></div>
          </div>
        )}
        <div className="thumbs">
          {(captures ?? []).slice(0, 6).map((c) => (
            <button key={c.id} aria-pressed={c.id === shown?.id} onClick={() => setPickedId(c.id)} title={`${fmtTime(c.ts)} · ${c.label ? "wet" : "dry"}`}>
              <img src={capUrl(c.id)} alt="" loading="lazy" />
              <span className="tl" style={{ background: c.label ? "var(--wet)" : "var(--dry)" }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SensorPanel({ node, series, range, setRange }: { node: FieldNode; series: Series | undefined; range: number; setRange: (h: number) => void }) {
  const t = useMemo(() => series?.t.map((s) => new Date(s).getTime()) ?? [], [series]);
  const tick = (ms: number) =>
    range > 24
      ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : new Date(ms).toLocaleTimeString("en-US", { hour: "numeric" });
  return (
    <div className="card">
      <div className="card-head">
        <h2>Sensors · {node.id} <span className="muted small" style={{ fontWeight: 400 }}>{node.plot} · {node.crop} · {node.irrigation}</span></h2>
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map((r) => <button key={r.h} aria-pressed={range === r.h} onClick={() => setRange(r.h)}>{r.label}</button>)}
        </div>
      </div>
      <div className="card-body">
        {!series ? (
          <div className="skeleton" style={{ height: 520 }} />
        ) : (
          <div className="multiples">
            {SENSORS.map((s) => {
              const vals = series[s.key].map((v) => (v === null ? null : s.scale ? v / s.scale : v));
              const latest = node.latest ? (s.scale ? node.latest[s.key] / s.scale : node.latest[s.key]) : null;
              return (
                <div className="multiple" key={s.key}>
                  <h3>
                    <span>{s.label}</span>
                    <span className="now">
                      {s.bars ? fmtNum(vals.reduce<number>((a, v) => a + (v ?? 0), 0), 1) : fmtNum(latest, s.digits)}
                      <small> {s.unit}{s.bars ? ` in ${RANGES.find((r) => r.h === range)?.label}` : ""}</small>
                    </span>
                  </h3>
                  <LineChart
                    t={t}
                    series={[{ key: s.key, label: s.label, color: "var(--s1)", values: vals }]}
                    height={118}
                    bars={s.bars}
                    unit={s.unit ? ` ${s.unit}` : ""}
                    yFormat={(v) => v.toFixed(s.digits === 0 ? 0 : s.key === "ph" || s.key === "ec" ? 2 : 1)}
                    xTickFormat={tick}
                    yMin={s.key === "soil_moisture" ? 6 : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({ nodes, data, hours }: { nodes: FieldNode[]; data: Record<string, [string, number, number][]> | undefined; hours: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ x: number; y: number; content: JSX.Element } | null>(null);
  const now = useNow(60_000);
  const end = now, start = end - hours * 3600_000;
  const labelW = 44, rowH = 18;
  const iw = Math.max(10, width - labelW);
  const x = (ms: number) => labelW + ((ms - start) / (end - start)) * iw;
  const cw = Math.max(1, (300_000 / (end - start)) * iw);
  const days: number[] = [];
  const d0 = new Date(start);
  d0.setHours(0, 0, 0, 0);
  for (let d = d0.getTime() + 86400_000; d < end; d += 86400_000) days.push(d);
  const h = nodes.length * (rowH + 4) + 18;
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label="Wet/dry classification timeline">
          {nodes.map((n, ri) => (
            <g key={n.id} transform={`translate(0, ${ri * (rowH + 4)})`}>
              <text x={0} y={rowH / 2} dy="0.32em" fontSize="11.5" fill="var(--ink-2)" className="mono">{n.id}</text>
              <rect x={labelW} y={0} width={iw} height={rowH} fill="var(--surface-2)" rx={2} />
              {(data?.[n.id] ?? []).map(([ts, label, p]) => {
                const ms = new Date(ts).getTime();
                if (ms < start) return null;
                return (
                  <rect key={ts} x={x(ms)} y={0} width={cw + 0.5} height={rowH} fill={label ? "var(--wet)" : "var(--dry)"}
                    onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, content: (
                      <><div className="t-head">{n.id} · {fmtDateTime(ts)}</div><div className="t-row">{label ? "Wet" : "Dry"}<b>P(wet) {p.toFixed(2)}</b></div></>
                    ) })}
                    onMouseLeave={() => setTip(null)} />
                );
              })}
            </g>
          ))}
          {days.map((d) => (
            <g key={d}>
              <line x1={x(d)} x2={x(d)} y1={0} y2={h - 16} stroke="var(--ink-3)" strokeDasharray="2 2" />
              <text x={x(d) + 3} y={h - 4} fontSize="10.5" fill="var(--ink-3)">
                {new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </text>
            </g>
          ))}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

function ModelPanel({ info }: { info: ModelInfo | undefined }) {
  if (!info?.model) return <div className="card"><div className="card-body"><div className="skeleton" style={{ height: 300 }} /></div></div>;
  const { model: m, live } = info;
  const regLink = REGISTRY_URL ? `${REGISTRY_URL}/models/${m.id}` : undefined;
  const cell = (good: boolean) => ({
    background: good ? "color-mix(in srgb, var(--s1) 22%, transparent)" : "color-mix(in srgb, var(--s2) 18%, transparent)",
    color: "var(--ink)",
  });
  const tot = live.labeled || 1;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Wet/dry model</h2>
        {regLink ? <a href={regLink} target="_blank" rel="noreferrer" className="small">wetdry {m.version} in registry ↗</a> : <span className="mono small">{m.version}</span>}
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="small secondary">
          {m.architecture} · int8 TFLite on each node · trained on <span className="mono">{m.dataset}@v{m.dataset_version}</span> · commit <span className="mono">{shortSha(m.code_commit)}</span>
        </div>
        <div className="metric-pairs">
          <div><span>F1, field (14 d)</span><b>{fmtNum(live.f1, 3)}</b><small>vs {fmtNum(m.offline_metrics.f1, 3)} test</small></div>
          <div><span>Precision / recall</span><b>{fmtNum(live.precision, 2)}</b><small>/ {fmtNum(live.recall, 2)}</small></div>
          <div><span>Inference p50 / p95</span><b>{live.latency_p50.toFixed(0)}</b><small>/ {live.latency_p95.toFixed(0)} ms</small></div>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="cm" aria-label="Confusion matrix on annotated frames">
            <span />
            <span className="hd">pred wet</span>
            <span className="hd">pred dry</span>
            <span className="rh">actual wet</span>
            <div className="cell" style={cell(true)}>{fmtInt(live.tp)}<small>{((live.tp / tot) * 100).toFixed(1)}%</small></div>
            <div className="cell" style={cell(false)}>{fmtInt(live.fn)}<small>{((live.fn / tot) * 100).toFixed(1)}%</small></div>
            <span className="rh">actual dry</span>
            <div className="cell" style={cell(false)}>{fmtInt(live.fp)}<small>{((live.fp / tot) * 100).toFixed(1)}%</small></div>
            <div className="cell" style={cell(true)}>{fmtInt(live.tn)}<small>{((live.tn / tot) * 100).toFixed(1)}%</small></div>
          </div>
          <div className="small secondary" style={{ flex: 1, minWidth: 180 }}>
            {fmtInt(live.labeled)} of {fmtInt(live.frames)} frames from the last 14 days have an annotator label. Most errors are
            false wets: dark, shaded soil shortly after sunrise, and surfaces that have dried while the sensor at 10 cm still reads moist.
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthTable({ nodes, now }: { nodes: FieldNode[]; now: number }) {
  return (
    <div className="card">
      <div className="card-head"><h2>Node health</h2><span className="small muted">last hour · battery over 24 h</span></div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Node</th><th className="num">Score</th><th className="num">Readings</th><th className="num">Battery min</th><th className="num">Signal</th><th className="num">pH σ</th><th>Issues</th><th>Last reading</th><th>Firmware</th></tr>
          </thead>
          <tbody>
            {nodes.map((n) => {
              const h = n.health;
              return (
                <tr key={n.id}>
                  <td><span className="mono">{n.id}</span> <span className="muted small">{n.plot}</span></td>
                  <td className="num">{h ? <span className="health" style={{ justifyContent: "flex-end" }}><HealthMark score={h.score} />{h.score}</span> : "–"}</td>
                  <td className="num">{h ? `${(h.completeness * 100).toFixed(0)}%` : "–"}</td>
                  <td className="num">{h?.battery_min ? `${h.battery_min.toFixed(2)} V` : "–"}</td>
                  <td className="num">{h?.rssi_avg ? `${h.rssi_avg.toFixed(0)} dBm` : "–"}</td>
                  <td className="num">{h ? h.ph_std.toFixed(2) : "–"}</td>
                  <td className="secondary" style={{ minWidth: 220 }}>
                    {h && h.issues.length ? <ul className="issues">{h.issues.map((i) => <li key={i}>{i}</li>)}</ul> : <span className="muted">None</span>}
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{n.latest ? fmtAgo(n.latest.ts, now) : "–"}</td>
                  <td className="mono small muted" style={{ whiteSpace: "nowrap" }}>{n.firmware.replace("fieldnode ", "v")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  const ov = useApi<Overview>("/api/field/overview");
  const model = useApi<ModelInfo>("/api/field/model", { refreshMs: 5 * 60_000 });
  const heat = useApi<{ cells: { node_id: string; hour: string; v: number }[] }>("/api/field/heatmap?days=7", { refreshMs: 15 * 60_000 });
  const timeline = useApi<{ nodes: Record<string, [string, number, number][]> }>("/api/field/timeline?hours=48");
  const [nodes, setNodes] = useState<FieldNode[]>([]);
  const [selected, setSelected] = useState("N01");
  const [range, setRange] = useState(24);
  const [series, setSeries] = useState<Series>();
  const [sparks, setSparks] = useState<Record<string, (number | null)[]>>({});
  const [captures, setCaptures] = useState<Prediction[]>();
  const [tl, setTl] = useState<Record<string, [string, number, number][]>>();
  const now = useNow();

  useEffect(() => { if (ov.data) setNodes(ov.data.nodes); }, [ov.data]);
  useEffect(() => { if (timeline.data) setTl(timeline.data.nodes); }, [timeline.data]);

  useEffect(() => {
    if (!ov.data) return;
    Promise.all(ov.data.nodes.map((n) => getJson<Series>(`/api/field/nodes/${n.id}/series?hours=6`)))
      .then((all) => setSparks(Object.fromEntries(all.map((s) => [s.node_id, s.soil_moisture]))))
      .catch(() => undefined);
  }, [ov.data]);

  useEffect(() => {
    setSeries(undefined);
    const ctrl = new AbortController();
    getJson<Series>(`/api/field/nodes/${selected}/series?hours=${range}`, ctrl.signal).then(setSeries).catch(() => undefined);
    return () => ctrl.abort();
  }, [selected, range]);

  useEffect(() => {
    setCaptures(undefined);
    const ctrl = new AbortController();
    getJson<Prediction[]>(`/api/field/predictions?node=${selected}&limit=12`, ctrl.signal).then(setCaptures).catch(() => undefined);
    return () => ctrl.abort();
  }, [selected]);

  const live = useLive((m: LiveMessage) => {
    if (m.channel === "reading") {
      const r = m.data as Reading;
      setNodes((ns) => ns.map((n) => (n.id === r.node_id ? { ...n, latest: r } : n)));
      setSparks((s) => ({ ...s, [r.node_id]: [...(s[r.node_id] ?? []).slice(-400), r.soil_moisture] }));
      if (r.node_id === selected) {
        setSeries((s) => {
          if (!s) return s;
          const cutoff = Date.now() - range * 3600_000;
          const keep = s.t.map((t) => new Date(t).getTime() >= cutoff);
          const out = { ...s, t: [...s.t.filter((_, i) => keep[i]), r.ts] } as Series;
          for (const { key } of SENSORS) out[key] = [...s[key].filter((_, i) => keep[i]), r[key]];
          return out;
        });
      }
    } else if (m.channel === "prediction") {
      const p = m.data as Prediction;
      setNodes((ns) => ns.map((n) => (n.id === p.node_id ? { ...n, prediction: p } : n)));
      setTl((t) => (t ? { ...t, [p.node_id]: [...(t[p.node_id] ?? []), [p.ts, p.label, p.p_wet]] } : t));
      if (p.node_id === selected && p.id) setCaptures((c) => [p, ...(c ?? [])].slice(0, 12));
    } else if (m.channel === "health") {
      const h = m.data as Health;
      setNodes((ns) => ns.map((n) => (n.id === h.node_id ? { ...n, health: h } : n)));
    }
  });

  const node = nodes.find((n) => n.id === selected);
  const daylight = ov.data?.daylight ?? true;

  const heatCols = useMemo(() => {
    const hours = [...new Set((heat.data?.cells ?? []).map((c) => new Date(c.hour).getTime()))].sort((a, b) => a - b);
    return hours;
  }, [heat.data]);
  const heatIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of heat.data?.cells ?? []) m.set(`${c.node_id}|${new Date(c.hour).getTime()}`, c.v);
    return m;
  }, [heat.data]);

  const statusText = live.status === "live" ? `Live · ${live.rate} msgs/min` : live.status === "connecting" ? "Connecting…" : "Reconnecting…";

  return (
    <>
      <header className="fs-top">
        <div className="fs-brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#3d5a2a" />
            <path d="M6 22h20" stroke="#d8c39d" strokeWidth="3" strokeLinecap="round" />
            <path d="M16 21V10m0 0c-4 0-6-2-6-5 4 0 6 2 6 5zm0 3c3 0 5-2 5-4.5-3 0-5 1.8-5 4.5z" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>FieldSense<small>Soil sensing · research plots, North Florida</small></span>
        </div>
        <span className={`live-pill ${live.status}`}><span className="pulse" />{statusText}</span>
        <span className="small muted num">{new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}</span>
        <span className="spacer" />
        {REGISTRY_URL && <a href={REGISTRY_URL} className="small" target="_blank" rel="noreferrer">Model registry ↗</a>}
        <span className="env-tag">Demo environment · sample data</span>
      </header>

      <main className="fs-main">
        {!ov.data && (
          <div className="card card-body" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="skeleton" style={{ width: 12, height: 12, borderRadius: 6 }} />
            {ov.reconnecting ? "Connecting to the field API…" : "Loading nodes…"}
          </div>
        )}

        {nodes.length > 0 && (
          <section className="nodes" aria-label="Field nodes">
            {nodes.map((n) => (
              <NodeCard key={n.id} n={n} spark={sparks[n.id]} selected={n.id === selected} onClick={() => setSelected(n.id)} now={now} />
            ))}
          </section>
        )}

        {node && (
          <section className="split">
            <CapturePanel node={node} captures={captures} daylight={daylight} />
            <SensorPanel node={node} series={series} range={range} setRange={setRange} />
          </section>
        )}

        {nodes.length > 0 && (
          <div className="card">
            <div className="card-head">
              <h2>Surface classification · last 48 h</h2>
              <div className="strip-legend">
                <span><span className="swatch" style={{ background: "var(--wet)", display: "inline-block", marginRight: 5 }} />Wet</span>
                <span><span className="swatch" style={{ background: "var(--dry)", display: "inline-block", marginRight: 5 }} />Dry</span>
                <span><span className="swatch" style={{ background: "var(--surface-2)", display: "inline-block", marginRight: 5, border: "1px solid var(--line-strong)" }} />No capture (night)</span>
              </div>
            </div>
            <div className="card-body"><Timeline nodes={nodes} data={tl} hours={48} /></div>
          </div>
        )}

        {nodes.length > 0 && (
          <section className="split-even">
            <div className="card">
              <div className="card-head">
                <h2>Soil moisture by hour · 7 days</h2>
                <SeqLegend lo="7" hi="16" unit="% VWC" />
              </div>
              <div className="card-body">
                {heat.data ? (
                  <Heatmap
                    rows={nodes.map((n) => ({ key: n.id, label: n.id }))}
                    cols={heatCols}
                    value={(r, c) => heatIndex.get(`${r}|${c}`)}
                    lo={7}
                    hi={16}
                    height={24}
                    colLabel={(c) => fmtDateTime(new Date(c))}
                    colTick={(c, i) => (new Date(c).getHours() === 0 || i === 0 ? new Date(c).toLocaleDateString("en-US", { weekday: "short", day: "numeric" }) : null)}
                    tipFormat={(v) => `${v.toFixed(1)}% VWC`}
                  />
                ) : <div className="skeleton" style={{ height: 170 }} />}
                <p className="small muted" style={{ margin: "10px 0 0" }}>
                  Fine sand: field capacity is about 12.5% VWC. Drip plots (N01, N02, N05) show the mid-morning irrigation pulse; N04 and N06 are rainfed.
                </p>
              </div>
            </div>
            <ModelPanel info={model.data} />
          </section>
        )}

        {nodes.length > 0 && <HealthTable nodes={nodes} now={now} />}

        <footer className="small muted" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span>Nodes: Raspberry Pi 4B, Camera Module 3, capacitive VWC, DS18B20, SHT31, pH and EC probes, BH1750, tipping-bucket gauge.</span>
          <span>Readings every 30 s · classifications every 5 min · <a href={`${API_URL}/docs#/field`} target="_blank" rel="noreferrer">API</a></span>
        </footer>
      </main>
    </>
  );
}
