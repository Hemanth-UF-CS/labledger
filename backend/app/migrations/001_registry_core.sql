-- Core registry entities. Dataset versions and model versions are append-only:
-- a new version is a new row, never an edit of an old one.

CREATE TABLE researchers (
    id          serial PRIMARY KEY,
    handle      text NOT NULL UNIQUE,
    name        text NOT NULL,
    role        text NOT NULL,
    focus       text NOT NULL,
    joined_at   date NOT NULL
);

CREATE TABLE projects (
    id          serial PRIMARY KEY,
    slug        text NOT NULL UNIQUE,
    name        text NOT NULL,
    description text NOT NULL,
    task        text NOT NULL,
    primary_metric text NOT NULL,
    metric_higher_is_better boolean NOT NULL DEFAULT true,
    owner_id    int NOT NULL REFERENCES researchers(id),
    created_at  timestamptz NOT NULL
);

CREATE TABLE datasets (
    id          serial PRIMARY KEY,
    slug        text NOT NULL UNIQUE,
    name        text NOT NULL,
    description text NOT NULL,
    modality    text NOT NULL,
    project_id  int NOT NULL REFERENCES projects(id),
    created_at  timestamptz NOT NULL
);

CREATE TABLE dataset_versions (
    id          serial PRIMARY KEY,
    dataset_id  int NOT NULL REFERENCES datasets(id),
    version     int NOT NULL CHECK (version > 0),
    uri         text NOT NULL,
    n_samples   int NOT NULL,
    size_bytes  bigint NOT NULL,
    checksum    char(64) NOT NULL,
    splits      jsonb NOT NULL,
    notes       text NOT NULL DEFAULT '',
    created_by  int NOT NULL REFERENCES researchers(id),
    created_at  timestamptz NOT NULL,
    UNIQUE (dataset_id, version)
);

CREATE TYPE model_stage AS ENUM ('development', 'staging', 'production', 'archived');

CREATE TABLE model_versions (
    id                  serial PRIMARY KEY,
    project_id          int NOT NULL REFERENCES projects(id),
    name                text NOT NULL,
    version             text NOT NULL,
    framework           text NOT NULL,
    architecture        text NOT NULL,
    hyperparams         jsonb NOT NULL,
    dataset_version_id  int NOT NULL REFERENCES dataset_versions(id),
    code_repo           text NOT NULL,
    code_commit         char(40) NOT NULL,
    parent_id           int REFERENCES model_versions(id),
    stage               model_stage NOT NULL DEFAULT 'development',
    artifact_uri        text NOT NULL,
    artifact_bytes      bigint NOT NULL,
    notes               text NOT NULL DEFAULT '',
    created_by          int NOT NULL REFERENCES researchers(id),
    created_at          timestamptz NOT NULL,
    UNIQUE (project_id, name, version)
);
CREATE INDEX model_versions_project_idx ON model_versions (project_id, created_at DESC);
CREATE INDEX model_versions_dataset_idx ON model_versions (dataset_version_id);
CREATE INDEX model_versions_parent_idx  ON model_versions (parent_id);

CREATE TABLE runs (
    id                serial PRIMARY KEY,
    model_version_id  int NOT NULL REFERENCES model_versions(id),
    status            text NOT NULL CHECK (status IN ('completed', 'failed', 'killed')),
    host              text NOT NULL,
    accelerator       text NOT NULL,
    seed              int NOT NULL,
    started_at        timestamptz NOT NULL,
    finished_at       timestamptz NOT NULL,
    metrics           jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX runs_model_idx ON runs (model_version_id);

-- An evaluation is a result: a metric set for one model version on one dataset version.
CREATE TABLE evaluations (
    id                  serial PRIMARY KEY,
    model_version_id    int NOT NULL REFERENCES model_versions(id),
    dataset_version_id  int NOT NULL REFERENCES dataset_versions(id),
    split               text NOT NULL,
    metrics             jsonb NOT NULL,
    created_at          timestamptz NOT NULL
);
CREATE INDEX evaluations_model_idx ON evaluations (model_version_id);

CREATE TABLE events (
    id           bigserial PRIMARY KEY,
    at           timestamptz NOT NULL,
    actor_id     int NOT NULL REFERENCES researchers(id),
    kind         text NOT NULL,
    subject_type text NOT NULL,
    subject_id   int NOT NULL,
    summary      text NOT NULL
);
CREATE INDEX events_at_idx ON events (at DESC);
