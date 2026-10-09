-- Field telemetry from the Raspberry Pi sensor nodes and the wet/dry classifier output.

CREATE TABLE field_nodes (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    plot          text NOT NULL,
    crop          text NOT NULL,
    irrigation    text NOT NULL,
    lat           double precision NOT NULL,
    lon           double precision NOT NULL,
    hardware      text NOT NULL,
    firmware      text NOT NULL,
    installed_at  date NOT NULL
);

CREATE TABLE readings (
    node_id        text NOT NULL REFERENCES field_nodes(id),
    ts             timestamptz NOT NULL,
    soil_moisture  real NOT NULL,   -- volumetric water content, %
    soil_temp      real NOT NULL,   -- deg C at 10 cm
    air_temp       real NOT NULL,   -- deg C
    humidity       real NOT NULL,   -- relative humidity, %
    ph             real NOT NULL,
    ec             real NOT NULL,   -- bulk electrical conductivity, dS/m
    light          real NOT NULL,   -- lux
    rain_mm        real NOT NULL,   -- mm in the sample interval
    battery_v      real NOT NULL,
    rssi           smallint NOT NULL,
    PRIMARY KEY (node_id, ts)
);
CREATE INDEX readings_ts_idx ON readings (ts DESC);

CREATE TABLE predictions (
    id                bigserial PRIMARY KEY,
    node_id           text NOT NULL REFERENCES field_nodes(id),
    ts                timestamptz NOT NULL,
    model_version_id  int NOT NULL REFERENCES model_versions(id),
    label             smallint NOT NULL CHECK (label IN (0, 1)),   -- 1 = wet
    p_wet             real NOT NULL,
    soil_moisture     real NOT NULL,
    image_seed        int NOT NULL,
    latency_ms        real NOT NULL,
    ground_truth      smallint CHECK (ground_truth IN (0, 1))       -- set only for annotated frames
);
CREATE INDEX predictions_node_ts_idx ON predictions (node_id, ts DESC);
CREATE INDEX predictions_ts_idx ON predictions (ts DESC);
