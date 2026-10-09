import { ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

type Tip = { x: number; y: number; content: ReactNode } | null;

export function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  const left = Math.min(tip.x + 14, window.innerWidth - 220);
  return (
    <div className="tooltip" style={{ left, top: tip.y + 14 }}>
      {tip.content}
    </div>
  );
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export type LineSeries = { key: string; label: string; color: string; values: (number | null)[] };

/**
 * Time-series line chart with crosshair tooltip. One y-axis only: charts that need
 * different units are separate charts.
 */
export function LineChart({
  t, series, height = 150, yFormat = (v) => v.toFixed(1), unit = "", bars = false, yMin, yMax, xTickFormat,
}: {
  t: number[];
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  unit?: string;
  bars?: boolean;
  yMin?: number;
  yMax?: number;
  xTickFormat: (ms: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const pad = { l: 40, r: 10, t: 8, b: 20 };
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;

  const { y0, y1, ticks } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (const v of s.values) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (bars) lo = 0;
    if (yMin !== undefined) lo = Math.min(lo, yMin);
    if (yMax !== undefined) hi = Math.max(hi, yMax);
    const padY = (hi - lo) * 0.08 || 1;
    const ticks = niceTicks(bars ? 0 : lo - padY, hi + padY);
    return { y0: Math.min(ticks[0], bars ? 0 : lo - padY), y1: Math.max(ticks[ticks.length - 1], hi), ticks };
  }, [series, bars, yMin, yMax]);

  const tmin = t[0] ?? 0, tmax = t[t.length - 1] ?? 1;
  const x = (ms: number) => pad.l + ((ms - tmin) / (tmax - tmin || 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const xticks = useMemo(() => {
    const n = Math.max(2, Math.floor(iw / 110));
    return Array.from({ length: n }, (_, i) => tmin + ((tmax - tmin) * (i + 0.5)) / n);
  }, [tmin, tmax, iw]);

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(t[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const ms = tmin + ((e.clientX - rect.left) / rect.width) * (tmax - tmin);
    let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] < ms) lo = mid; else hi = mid; }
    const i = Math.abs(t[lo] - ms) < Math.abs(t[hi] - ms) ? lo : hi;
    setHover(i);
    setTip({
      x: e.clientX, y: e.clientY,
      content: (
        <>
          <div className="t-head">{new Date(t[i]).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
          {series.map((s) => (
            <div className="t-row" key={s.key}>
              {series.length > 1 && <span className="swatch" style={{ background: s.color }} />}
              {s.label}
              <b>{s.values[i] === null ? "–" : `${yFormat(s.values[i] as number)}${unit}`}</b>
            </div>
          ))}
        </>
      ),
    });
  };

  const barW = t.length > 1 ? Math.max(1, (iw / t.length) * 0.7) : 4;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(", ")}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              <text x={pad.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="10.5" fill="var(--ink-3)" className="num">
                {yFormat(v)}
              </text>
            </g>
          ))}
          {xticks.map((ms) => (
            <text key={ms} x={x(ms)} y={height - 5} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">
              {xTickFormat(ms)}
            </text>
          ))}
          <line x1={pad.l} x2={pad.l + iw} y1={pad.t + ih} y2={pad.t + ih} stroke="var(--line-strong)" />
          {bars
            ? series.map((s) =>
                s.values.map((v, i) =>
                  v ? (
                    <rect key={`${s.key}${i}`} x={x(t[i]) - barW / 2} width={barW} y={y(v)} height={Math.max(1, y(0) - y(v))}
                      fill={s.color} rx={Math.min(2, barW / 2)} />
                  ) : null,
                ),
              )
            : paths.map((d, i) => (
                <path key={series[i].key} d={d} fill="none" stroke={series[i].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
          {hover !== null && t[hover] !== undefined && (
            <g>
              <line x1={x(t[hover])} x2={x(t[hover])} y1={pad.t} y2={pad.t + ih} stroke="var(--ink-3)" strokeDasharray="2 3" />
              {!bars && series.map((s) => s.values[hover] !== null && (
                <circle key={s.key} cx={x(t[hover])} cy={y(s.values[hover] as number)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent"
            onMouseMove={onMove} onMouseLeave={() => { setHover(null); setTip(null); }} />
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export function Sparkline({ values, color = "var(--accent)", height = 28, threshold }: {
  values: (number | null)[]; color?: string; height?: number; threshold?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const nums = values.filter((v): v is number => v !== null);
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (threshold !== undefined) { lo = Math.min(lo, threshold); hi = Math.max(hi, threshold); }
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => 3 + (1 - (v - lo) / span) * (height - 6);
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && nums.length > 1 && (
        <svg width={width} height={height} aria-hidden>
          {threshold !== undefined && (
            <line x1={0} x2={width} y1={y(threshold)} y2={y(threshold)} stroke="var(--line-strong)" strokeDasharray="2 3" />
          )}
          <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

/** Vertical bars for a handful of categories (e.g. registrations per month). */
export function ColumnChart({ data, height = 140, label }: {
  data: { key: string; label: string; value: number }[]; height?: number; label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const [hover, setHover] = useState<string | null>(null);
  const pad = { l: 28, r: 4, t: 8, b: 20 };
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = niceTicks(0, max, 3);
  const top = ticks[ticks.length - 1];
  const slot = iw / Math.max(1, data.length);
  const bw = Math.max(3, Math.min(22, slot - 2));
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 48)));
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              <text x={pad.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="10.5" fill="var(--ink-3)">{v}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.l + slot * i + slot / 2;
            return (
              <g key={d.key}>
                {d.value > 0 && (
                  <path
                    d={`M${cx - bw / 2},${y(0)} V${y(d.value) + 3} q0,-3 3,-3 H${cx + bw / 2 - 3} q3,0 3,3 V${y(0)} Z`}
                    fill={hover === d.key ? "var(--accent-ink)" : "var(--accent)"}
                  />
                )}
                {i % every === 0 && (
                  <text x={cx} y={height - 5} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">{d.label}</text>
                )}
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent"
                  onMouseMove={(e) => { setHover(d.key); setTip({ x: e.clientX, y: e.clientY, content: <div className="t-row">{d.label}<b>{d.value}</b></div> }); }}
                  onMouseLeave={() => { setHover(null); setTip(null); }} />
              </g>
            );
          })}
          <line x1={pad.l} x2={pad.l + iw} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

const SEQ = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"];

/** Rows x columns heatmap on a single-hue sequential ramp. */
export function Heatmap({ rows, cols, value, lo, hi, colLabel, colTick, tipFormat, height = 22 }: {
  rows: { key: string; label: string }[];
  cols: number[];
  value: (row: string, col: number) => number | undefined;
  lo: number;
  hi: number;
  colLabel: (c: number) => string;
  colTick: (c: number, i: number) => string | null;
  tipFormat: (v: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const labelW = 44;
  const cw = Math.max(1, (width - labelW) / Math.max(1, cols.length));
  const color = (v: number) => {
    const f = Math.max(0, Math.min(0.999, (v - lo) / (hi - lo || 1)));
    return `var(${SEQ[Math.floor(f * SEQ.length)]})`;
  };
  const h = rows.length * (height + 2) + 18;
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label="heatmap">
          {rows.map((r, ri) => (
            <g key={r.key} transform={`translate(0, ${ri * (height + 2)})`}>
              <text x={0} y={height / 2} dy="0.32em" fontSize="11.5" fill="var(--ink-2)" className="mono">{r.label}</text>
              {cols.map((c, ci) => {
                const v = value(r.key, c);
                return (
                  <rect key={c} x={labelW + ci * cw} y={0} width={Math.max(0.5, cw - (cw > 4 ? 1 : 0))} height={height}
                    fill={v === undefined ? "var(--surface-2)" : color(v)}
                    onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, content: (
                      <><div className="t-head">{r.label} · {colLabel(c)}</div><div className="t-row">{v === undefined ? "no data" : tipFormat(v)}</div></>
                    ) })}
                    onMouseLeave={() => setTip(null)} />
                );
              })}
            </g>
          ))}
          {cols.map((c, ci) => {
            const lab = colTick(c, ci);
            return lab ? (
              <text key={c} x={labelW + ci * cw} y={h - 4} fontSize="10.5" fill="var(--ink-3)">{lab}</text>
            ) : null;
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export function SeqLegend({ lo, hi, unit }: { lo: string; hi: string; unit: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)" }}>
      {lo}
      <span style={{ display: "inline-flex" }}>
        {SEQ.map((s) => <span key={s} style={{ width: 14, height: 8, background: `var(${s})` }} />)}
      </span>
      {hi} {unit}
    </div>
  );
}
