const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const timeSec = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export const fmtDate = (s: string | Date) => dateFmt.format(new Date(s));
export const fmtDateShort = (s: string | Date) => dateShort.format(new Date(s));
export const fmtTime = (s: string | Date) => timeFmt.format(new Date(s));
export const fmtTimeSec = (s: string | Date) => timeSec.format(new Date(s));
export const fmtDateTime = (s: string | Date) => `${fmtDateShort(s)}, ${fmtTime(s)}`;

export function fmtAgo(s: string | Date, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - new Date(s).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export const fmtInt = (n: number) => n.toLocaleString("en-US");

export function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return v.toFixed(digits);
}

export const shortSha = (sha: string) => sha.slice(0, 8);

const METRIC_LABELS: Record<string, string> = {
  f1: "F1",
  macro_f1: "Macro F1",
  auroc: "AUROC",
  mape: "MAPE %",
  miou: "mIoU",
  rmse_mm_day: "RMSE mm/day",
  map50: "mAP@50",
  r2: "R²",
  rmse_vwc: "RMSE % VWC",
  precision: "Precision",
  recall: "Recall",
  accuracy: "Accuracy",
  sensitivity: "Sensitivity",
  rmse_kg_ha: "RMSE kg/ha",
  coverage_p90: "P90 coverage",
  iou_weed: "IoU weed",
  iou_crop: "IoU crop",
  mae_mm_day: "MAE mm/day",
  map50_95: "mAP@50:95",
  count_mae: "Count MAE",
  rmse_pct_n: "RMSE %N",
  mae_vwc: "MAE % VWC",
};
export const metricLabel = (k: string) => METRIC_LABELS[k] ?? k;

export function fmtMetric(key: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  if (key === "mape") return v.toFixed(1);
  if (key.startsWith("rmse") || key.startsWith("mae") || key === "count_mae") return v.toFixed(2);
  return v.toFixed(3);
}
