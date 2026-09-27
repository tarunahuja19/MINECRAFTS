"""Tests for ground wiring into engine, FORGE and config payloads (G2)."""

import numpy as np
from starlette.testclient import TestClient

from forge.server import app as forge_app
from sandbox import district
from sandbox.sensors import SensorNoiseConfig
from sandbox.server import app as sandbox_app
from sandbox.session import SessionConfig, SimulationSession


def test_default_ground_is_district():
    session = SimulationSession()
    assert session.config.ground == "district"
    assert session._ground is district


def test_tick_has_bowl_terms_py_and_face_positions():
    session = SimulationSession()
    payload = session.tick()
    assert payload["bowl_py"] is None
    assert isinstance(payload["face_y_m"], float)
    assert len(payload["bowl_terms_py"]) == 3
    assert all(len(p) == 121 for p in payload["bowl_terms_py"])
    assert len(payload["face_positions"]) == 3


def test_total_minus_install_equals_zero_at_t0():
    session = SimulationSession(
        SessionConfig(noise_config=SensorNoiseConfig(enable_noise=False))
    )
    ch_0 = session._ground.channels(session.X, session.Y, 0.0)
    for k in ch_0:
        diff = ch_0[k] - session._install_ch[k]
        np.testing.assert_allclose(diff, 0.0, atol=1e-12)

    # Telemetry sampled with truth_channels = since_install at t=0 has zero ground deformation
    readings = session.sensor_array.sample_tick(
        t_sim_days=0.0,
        t_sim_seconds=0.0,
        iso_timestamp="2026-01-01T00:00:00Z",
        truth_channels={k: ch_0[k] - session._install_ch[k] for k in ch_0},
        vibration_transient=0.0,
    )
    for r in readings:
        if r.alive:
            if r.get("tilt_x_urad") is not None:
                assert r.get("tilt_x_urad") == 0
            if r.get("tilt_y_urad") is not None:
                assert r.get("tilt_y_urad") == 0
            if r.get("strain_ue") is not None:
                assert r.get("strain_ue") == 0


def test_forge_frame_has_bowl_terms_py_and_active_states():
    with TestClient(forge_app) as client:
        res = client.post("/forge/frame", json={"day": 50.0, "events": []})
        assert res.status_code == 200
        data = res.json()
        assert data["bowl_py"] is None
        assert len(data["bowl_terms_py"]) == 3
        assert all(len(p) == 121 for p in data["bowl_terms_py"])
        assert len(data["face_positions"]) == 3
        assert all(st == "ACTIVE" for st in data["node_states"].values())


def test_server_config_gives_bowl_terms_px():
    with TestClient(sandbox_app) as client:
        cfg = client.get("/config").json()
        assert cfg["bowl_px"] is None
        assert len(cfg["bowl_terms_px"]) == 3
        assert all(len(p) == 121 for p in cfg["bowl_terms_px"])
