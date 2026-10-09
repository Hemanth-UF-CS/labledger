export interface Reading {
  node_id: string;
  ts: string;
  soil_moisture: number;
  soil_temp: number;
  air_temp: number;
  humidity: number;
  ph: number;
  ec: number;
  light: number;
  rain_mm: number;
  battery_v: number;
  rssi: number;
}

export interface Prediction {
  id: number;
  node_id: string;
  ts: string;
  label: 0 | 1;
  p_wet: number;
  soil_moisture: number;
  latency_ms: number;
  ground_truth: 0 | 1 | null;
  model_version?: string;
  model_version_id: number;
}

export interface Health {
  node_id: string;
  score: number;
  issues: string[];
  last_seen: string;
  completeness: number;
  battery_min: number;
  rssi_avg: number;
  ph_std: number;
  online: boolean;
}

export interface FieldNode {
  id: string;
  name: string;
  plot: string;
  crop: string;
  irrigation: string;
  lat: number;
  lon: number;
  hardware: string;
  firmware: string;
  installed_at: string;
  latest: Reading | null;
  prediction: Prediction | null;
  health: Health | null;
}

export interface Overview {
  nodes: FieldNode[];
  server_time: string;
  daylight: boolean;
  local_tz: string;
}

export type MetricKey = "soil_moisture" | "soil_temp" | "air_temp" | "humidity" | "ph" | "ec" | "light" | "rain_mm";

export interface Series extends Record<MetricKey, (number | null)[]> {
  node_id: string;
  bucket_s: number;
  t: string[];
}

export interface ModelInfo {
  model: {
    id: number;
    version: string;
    architecture: string;
    code_commit: string;
    created_at: string;
    offline_metrics: Record<string, number>;
    dataset: string;
    dataset_version: number;
  } | null;
  live: {
    frames: number;
    labeled: number;
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    accuracy: number | null;
    precision: number | null;
    recall: number | null;
    f1: number | null;
    latency_p50: number;
    latency_p95: number;
  };
}
