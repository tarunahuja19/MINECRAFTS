"""
Session C pytest suite: Session loop, FastAPI/WebSocket server, CSV logging engine,
Gate T48 (was T34: SNR boot refusal), and Gate T51 (was T38: 2000x timing drift & CSV equality).

Run from `simulation_making/`:
    uv run pytest tests/test_session_c.py -v
"""

import json
import re
from pathlib import Path
import numpy as np
import pytest
from starlette.testclient import TestClient

from sandbox import constants, gates, layout, segments, surface
from sandbox import sensors as sensors_mod
from sandbox.sensors import SensorArray, SensorNoiseConfig
from sandbox.server import app
from sandbox.session import SessionConfig, SimulationSession

_INTERVENTIONS_TS = (
    Path(__file__).resolve().parent.parent
    / "frontend" / "src" / "interventions.ts"
)


def _ts_number(name: str) -> float:
    """Return the numeric right-hand side of an `export const <name> = ...;`."""
    src = _INTERVENTIONS_TS.read_text(encoding="utf-8")
    m = re.search(rf"export const {name}\s*=\s*([0-9.]+)\s*;", src)
    assert m is not None, f"{name} not found in {_INTERVENTIONS_TS.name}"
    return float(m.group(1))


def test_t48_boot_refusal_on_high_noise(tmp_path):
    """Gate T48 (was T34): SimulationSession refuses to boot when noise budget is
    inflated past the detectability threshold (margin < 3.0).
    """
    # Real frozen noise budget clears boot check
    valid_cfg = SessionConfig(
        out_dir=tmp_path / "valid_run",
        noise_config=SensorNoiseConfig(sigma_strain_ue=1.332),
    )
    session = SimulationSession(valid_cfg)
    assert session.snr_margin >= 3.0

    # Inflated noise drives margin below 3.0 -> raises RuntimeError
    invalid_cfg = SessionConfig(
        out_dir=tmp_path / "invalid_run",
        noise_config=SensorNoiseConfig(sigma_strain_ue=25.0),
    )
    with pytest.raises(RuntimeError, match=r"Gate T48 Boot Refusal: SNR margin .* is below required threshold 3.0"):
        SimulationSession(invalid_cfg)


def test_t51_csv_tick_consistency_and_zero_drift(tmp_path):
    """Gate T51 (was T38): A multi-tick session produces exact equality between
    tick count and nodes.csv row count (rows == ticks * 33), with zero sim-time drift.
    """
    out_dir = tmp_path / "t51_session"
    config = SessionConfig(
        out_dir=out_dir,
        default_speed=2000.0,
        tick_duration_sim_s=60.0,
    )
    session = SimulationSession(config)
    session.start()

    n_ticks = 100
    for _ in range(n_ticks):
        session.tick()

    session.stop()

    # Verify Gate T51
    assert gates.verify_session_csv_consistency_gate(
        nodes_csv_path=session.nodes_csv_path,
        expected_ticks=n_ticks,
        num_nodes=layout.N_NODES,
        tick_interval_s=60.0,
    )


def test_sensors_corruption_and_dead_node(tmp_path):
    """Verify sensor corruption formatting, units scaling, and dead node blank row rule."""
    X, Y = surface.grid()
    ch = surface.channels(X, Y, t=50.0)

    sensors = SensorArray(SensorNoiseConfig(enable_noise=True, seed=123))

    # Mark node 5 as dead
    dead_node_id = 5
    for n in sensors.nodes:
        if n.node_id == dead_node_id:
            n.alive = 0

    readings = sensors.sample_tick(
        t_sim_days=50.0,
        t_sim_seconds=50.0 * 86400,
        iso_timestamp="2026-03-14T12:00:00Z",
        truth_channels=ch,
        vibration_transient=0.0,
    )

    assert len(readings) == layout.N_NODES

    # Check alive node reading
    alive_r = next(r for r in readings if r.node_id == 1)
    assert alive_r.alive == 1
    assert alive_r.seq == 1
    assert alive_r.get("tilt_x_urad") is not None
    assert alive_r.vbat_mv is not None

    # Channels are per-TIER, not universal (MESH_UPGRADE_BRIEF.md section 1).
    # Node 1 carries whatever its own tier carries — and every channel its
    # tier lacks must read NULL, never 0. That distinction is the brief's
    # "critical read rule": a null means the hardware does not exist, which
    # is categorically different from a sensor reading zero.
    carried = sensors_mod.TIER_CHANNELS[alive_r.tier]
    for channel in sensors_mod.CHANNEL_COLUMNS:
        if channel in carried:
            assert alive_r.get(channel) is not None, (
                f"tier {alive_r.tier} carries {channel} but reported null"
            )
        else:
            assert alive_r.get(channel) is None, (
                f"tier {alive_r.tier} lacks {channel} but reported a value"
            )

    row_str = alive_r.to_csv_row()
    assert row_str.startswith(f"2026-03-14T12:00:00Z,1,{alive_r.tier},1,")
    assert len(row_str.split(",")) == len(sensors_mod.CSV_COLUMNS)

    # Check dead node reading (Rule 2: present row, blanks, alive=0)
    dead_r = next(r for r in readings if r.node_id == dead_node_id)
    assert dead_r.alive == 0
    assert dead_r.seq is None
    assert dead_r.get("strain_ue") is None
    dead_row_str = dead_r.to_csv_row()
    cells = dead_row_str.split(",")
    assert len(cells) == len(sensors_mod.CSV_COLUMNS)
    assert cells[:3] == ["2026-03-14T12:00:00Z", "5", dead_r.tier]
    assert cells[-1] == "0"
    assert all(c == "" for c in cells[3:-1])



def test_interventions_and_events_csv(tmp_path):
    """Verify ground interventions, vibration transients, and events.csv logging."""
    out_dir = tmp_path / "interventions_test"
    config = SessionConfig(out_dir=out_dir)
    session = SimulationSession(config)
    session.start()

    # 1. Apply vibration transient at t=0
    session.apply_vibration(magnitude_ppv=20.0, duration_s=120.0, kind="blast", note="production blast")
    payload1 = session.tick()

    # Ground S(x, y, t) at t=0 is 0.0 despite vibration
    assert payload1["time_scalar"] == 0.0

    # Accelerometer vibration channel reflects the transient
    n1_readings = payload1["nodes"]
    assert len(n1_readings) == layout.N_NODES

    # 2. Apply discontinuous pillar failure
    session.apply_collapse(cx=0, cy=0, magnitude_m=0.8, duration_hours=2.4)
    for _ in range(10):
        session.tick()

    session.stop()

    # Verify events.csv contains both events
    events_content = session.events_csv_path.read_text()
    assert "blast" in events_content
    assert "collapse" in events_content
    assert "production blast" in events_content


def test_wire_protocol_payload_size_and_structure(tmp_path):
    """Verify per-tick WebSocket wire protocol payload is compact (~2 KB) and structured."""
    out_dir = tmp_path / "wire_test"
    config = SessionConfig(out_dir=out_dir)
    session = SimulationSession(config)
    session.start()

    payload = session.tick()
    session.stop()

    payload_json = json.dumps(payload)
    payload_bytes = len(payload_json.encode("utf-8"))

    # Bandwidth assertion. The point of this budget is that the per-tick
    # message carries only the time scalar, the active perturbations and the
    # per-node/per-zone readings — never the mesh, which is sent once on
    # connect. The plan's "~2 KB/tick instead of ~64 KB" is that contrast.
    #
    # So the limit is expressed PER NODE rather than as one absolute number:
    # an absolute cap silently turns "we added sensors" into a test failure
    # that looks like a bandwidth regression, which is what happened when the
    # layout went from 33 to 77 nodes.
    #
    # 200 B/node + 4 KB of fixed overhead holds the real invariant. The
    # per-node figure rose from 64 B when the tiered sensor set landed
    # (MESH_UPGRADE_BRIEF.md section 1): a row now carries the vibration
    # triple and link stats alongside tilt and strain, measured at 141 B.
    # That is more channels, not leaked topology — `tier`, `hops` and the
    # mesh DAG are static and travel once in the init frame. The budget
    # still fails loudly if the mesh ever does leak in: a single 121x121
    # z0_mesh alone would be ~9x the whole current payload.
    budget = 4000 + 200 * len(payload["nodes"])
    assert payload_bytes < budget, (
        f"Payload size {payload_bytes} bytes exceeds budget {budget} "
        f"({len(payload['nodes'])} nodes)"
    )

    # Verify schema fields
    assert "t_sim" in payload
    assert "t_days" in payload
    assert "time_scalar" in payload
    assert "perturbations" in payload
    assert "nodes" in payload
    assert "segments" in payload
    assert len(payload["nodes"]) == layout.N_NODES
    assert len(payload["segments"]) == 36


def test_fastapi_endpoints():
    """Verify REST health and config endpoints on FastAPI server."""
    with TestClient(app) as client:
        # Health check
        res = client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "healthy"
        assert data["snr_margin"] >= 3.0

        # Static Config
        res_cfg = client.get("/config")
        assert res_cfg.status_code == 200
        cfg_data = res_cfg.json()
        assert cfg_data["window_size_m"] == 600.0
        assert len(cfg_data["nodes"]) == layout.N_NODES
        assert len(cfg_data["zones"]) == 36

        # Command Control
        res_ctrl = client.post("/control", json={"action": "set_speed", "multiplier": 1500})
        assert res_ctrl.status_code == 200
        assert res_ctrl.json()["speed"] == 1500.0

        # Detailed Node Telemetry Endpoint
        res_node = client.get("/nodes/14")
        assert res_node.status_code == 200
        node_data = res_node.json()
        assert node_data["id"] == 14
        assert "telemetry" in node_data
        assert "vbat_mv" in node_data["telemetry"]
        assert "temp_c" in node_data["telemetry"]

        # 404 on invalid node
        res_404 = client.get("/nodes/999")
        assert res_404.status_code == 404


def test_start_after_pause_appends_rather_than_truncates(tmp_path):
    """Regression: pressing START after PAUSE used to truncate the run's telemetry.

    `session.start()` unconditionally reopened both CSVs in mode "w". The UI's
    PAUSE -> START pair sends `pause` then `start`, so pressing START mid-run
    silently discarded everything already written while `t_sim_seconds` kept
    climbing. Measured before the fix: 3 ticks wrote 231 data rows, and the
    next START discarded all 231, leaving a file whose first row claimed
    t=+180s -- the clock and the file disagreed from then on.

    `start()` is now idempotent: it only (re)opens the CSVs in mode "w" when
    there is no live stream to resume, so resuming after PAUSE appends. This
    pins that: row count must strictly grow across PAUSE -> START, and the
    earliest rows (t=0) must still be there afterward.
    """
    out_dir = tmp_path / "pause_resume_session"
    config = SessionConfig(out_dir=out_dir)
    session = SimulationSession(config)
    session.start()

    for _ in range(3):
        session.tick()

    lines_before = session.nodes_csv_path.read_text().splitlines()
    rows_before = len(lines_before)
    assert rows_before > 1  # header + at least one data row

    # PAUSE then START, exactly as the UI's handlePause/handleStart do.
    session.is_paused = True
    session.is_paused = False
    session.start()

    for _ in range(3):
        session.tick()

    session.stop()

    lines_after = session.nodes_csv_path.read_text().splitlines()
    assert len(lines_after) > rows_before, (
        "START after PAUSE must append rows, not truncate the file"
    )
    # The early rows (including the first data row, t=0) must have survived --
    # a truncating start() would have wiped them and shifted the first row's
    # timestamp forward.
    assert lines_after[:rows_before] == lines_before


def test_default_speed_matches_frontend_fixed_multiplier():
    """Regression: the backend default speed and the frontend's fixed speed drifted apart.

    `sandbox.constants.DEFAULT_SPEED_MULTIPLIER` was 2000.0 while the frontend
    declared `FIXED_SPEED_MULTIPLIER = 10.0` as the operator-facing truth. The
    client only corrects the server by sending `set_speed` on WebSocket open,
    so any window where the session ticks before that lands -- a REST
    `/control` start, a reconnect, a restart after PAUSE -- ran at 2000x,
    writing ~2567 CSV rows/sec instead of the intended ~13. This guards the
    actual root cause: the two constants must never disagree again.
    """
    assert constants.DEFAULT_SPEED_MULTIPLIER == 10.0
    assert constants.DEFAULT_SPEED_MULTIPLIER == _ts_number("FIXED_SPEED_MULTIPLIER")
