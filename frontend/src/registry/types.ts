export type Stage = "development" | "staging" | "production" | "archived";

export interface ModelRow {
  id: number;
  name: string;
  version: string;
  framework: string;
  architecture: string;
  stage: Stage;
  code_repo: string;
  code_commit: string;
  parent_id: number | null;
  created_at: string;
  notes: string;
  project: string;
  project_name: string;
  primary_metric: string;
  metric_higher_is_better: boolean;
  author: string;
  author_name: string;
  dataset: string;
  dataset_version: number;
  dataset_version_id: number;
  metric_value: number | null;
}

export interface Run {
  id: number;
  status: "completed" | "failed" | "killed";
  host: string;
  accelerator: string;
  seed: number;
  started_at: string;
  finished_at: string;
  metrics: Record<string, number>;
}

export interface Evaluation {
  id: number;
  split: string;
  metrics: Record<string, number>;
  created_at: string;
  dataset: string;
  dataset_version: number;
  own_dataset: boolean;
}

export interface ModelDetail extends ModelRow {
  hyperparams: Record<string, unknown>;
  artifact_uri: string;
  artifact_bytes: number;
  dataset_uri: string;
  dataset_checksum: string;
  dataset_samples: number;
  dataset_splits: Record<string, number>;
  dataset_notes: string;
  dataset_created_at: string;
  lineage: (ModelRow & { depth: number })[];
  children: { id: number; version: string; stage: Stage }[];
  runs: Run[];
  evaluations: Evaluation[];
}

export interface Stats {
  researchers: number;
  projects: number;
  model_versions: number;
  in_production: number;
  dataset_versions: number;
  runs: number;
  evaluations: number;
  versions_by_month: { month: string; n: number }[];
}

export interface Project {
  slug: string;
  name: string;
  description: string;
  task: string;
  primary_metric: string;
  metric_higher_is_better: boolean;
  created_at: string;
  owner: string;
  owner_name: string;
  model_versions: number;
  last_version_at: string;
  production_version: string | null;
}

export interface ProjectDetail extends Project {
  id: number;
  models: ModelRow[];
  dataset_versions: { slug: string; name: string; version: number; n_samples: number; created_at: string; notes: string }[];
}

export interface DatasetVersion {
  id: number;
  version: number;
  n_samples: number;
  size_bytes: number;
  checksum: string;
  uri: string;
  notes: string;
  created_at: string;
  splits: Record<string, number>;
  used_by: { id: number; version: string; stage: Stage }[] | null;
}

export interface Dataset {
  slug: string;
  name: string;
  description: string;
  modality: string;
  project: string;
  project_name: string;
  versions: DatasetVersion[];
}

export interface Researcher {
  handle: string;
  name: string;
  role: string;
  focus: string;
  joined_at: string;
  model_versions: number;
  last_active: string | null;
  projects: { slug: string; name: string }[] | null;
}

export interface Event {
  id: number;
  at: string;
  kind: string;
  subject_type: string;
  subject_id: number;
  summary: string;
  actor: string;
  actor_name: string;
}

export interface SearchHit {
  type: "model_version" | "project" | "dataset" | "researcher";
  id: number | string;
  title: string;
  subtitle: string;
}

export interface Compare {
  a: ModelRow & { hyperparams: Record<string, unknown>; dataset_checksum: string; test_metrics: Record<string, number> | null };
  b: ModelRow & { hyperparams: Record<string, unknown>; dataset_checksum: string; test_metrics: Record<string, number> | null };
  hyperparams: { key: string; a: unknown; b: unknown; changed: boolean }[];
}
