-- ==============================================================================
-- Mine Sensor Network — Live Backend Schema
-- Strictly aligned with SCHEMA.md
-- ==============================================================================

-- 1. nodes — node profile table
-- One row per physical node. Written once at deployment/commissioning time.
CREATE TABLE IF NOT EXISTS nodes (
    node_id VARCHAR(64) PRIMARY KEY,
    site_id VARCHAR(64) NOT NULL,
    tier VARCHAR(8) NOT NULL CHECK (tier IN ('1A', '1B', '1C', '2A', '2B', '3')),
    node_type VARCHAR(32) NOT NULL CHECK (node_type IN ('scout', 'anchor', 'gateway')),
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    z DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    -- Display projection of x/y, written by the simulation via sandbox.geo.
    -- x/y stay the physics truth; these exist so map surfaces never hand-roll
    -- their own metres->degrees conversion. Nullable: a node is valid before
    -- the simulation has projected it.
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION
);

-- Existing deployments predate lat/lon; add them in place. Mirrors
-- ALTER_NODES_GEO_SQL in simulation/sandbox/db.py, which applies the same
-- migration on connect so either side can bring a database up to date.
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_nodes_site_status ON nodes (site_id, status);

-- 2. readings — live sensor stream
-- One row per (node_id, ts), appended every 60 s per node.
-- Tier nullability rule: a channel a tier does not carry is NULL, never 0.
CREATE TABLE IF NOT EXISTS readings (
    node_id VARCHAR(64) NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL,
    -- Carried by 1A, 1B, 1C, 2A
    tilt_x_urad DOUBLE PRECISION,
    tilt_y_urad DOUBLE PRECISION,
    -- Carried by 1A, 1B, 1C
    accel_x_g DOUBLE PRECISION,
    accel_y_g DOUBLE PRECISION,
    accel_z_g DOUBLE PRECISION,
    gyro_x_dps DOUBLE PRECISION,
    gyro_y_dps DOUBLE PRECISION,
    gyro_z_dps DOUBLE PRECISION,
    vib_rms_mm_s DOUBLE PRECISION,
    vib_peak_mm_s DOUBLE PRECISION,
    vib_fdom_hz DOUBLE PRECISION,
    -- Carried by all six tiers
    die_temp_c DOUBLE PRECISION,
    -- 1B only
    fissure_mm DOUBLE PRECISION,
    strain_ue DOUBLE PRECISION,
    -- 1C only
    moisture_pct DOUBLE PRECISION,
    ext_delta_mm DOUBLE PRECISION,
    -- 2B only
    pore_pressure_kpa DOUBLE PRECISION,
    borehole_tilt_d1_urad DOUBLE PRECISION,
    borehole_tilt_d2_urad DOUBLE PRECISION,
    borehole_tilt_d3_urad DOUBLE PRECISION,
    borehole_tilt_d4_urad DOUBLE PRECISION,
    -- 3 only
    gps_dx_mm DOUBLE PRECISION,
    gps_dy_mm DOUBLE PRECISION,
    gps_dz_mm DOUBLE PRECISION,
    PRIMARY KEY (node_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_readings_node_ts ON readings (node_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings (ts DESC);

-- 3. simulation_packets — 60-second aggregated simulation packets
CREATE TABLE IF NOT EXISTS simulation_packets (
    packet_id BIGINT PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    grid_id VARCHAR(64) NOT NULL,
    start_sim_time DOUBLE PRECISION NOT NULL,
    end_sim_time DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sim_packets_session ON simulation_packets (session_id);

