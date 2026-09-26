"""
Reproducibility: the live engine's telemetry is a pure function of
(SessionConfig.seed, SessionConfig.base_iso_time). Same inputs -> byte-identical
nodes.csv; a different seed -> different noise.

Run from `simulation/`:
    .venv/bin/python -m pytest tests/test_reproducibility.py -q
"""

import hashlib

import pytest

from sandbox.session import SessionConfig, SimulationSession

TICKS = 200
BASE_ISO = "2026-01-01T00:00:00Z"


@pytest.fixture(autouse=True)
def _no_mqtt(monkeypatch):
    monkeypatch.setenv("R4_MQTT_ENABLED", "0")


def _run(out_dir, seed: int) -> str:
    session = SimulationSession(
        SessionConfig(
            out_dir=out_dir,
            base_iso_time=BASE_ISO,
            seed=seed,
            save_packet_json=False,
        )
    )
    session.start()
    for _ in range(TICKS):
        session.tick()
    session.stop()
    return hashlib.sha256(session.nodes_csv_path.read_bytes()).hexdigest()


def test_same_seed_and_base_time_give_identical_nodes_csv(tmp_path):
    a = _run(tmp_path / "a", seed=20260926)
    b = _run(tmp_path / "b", seed=20260926)
    assert a == b


def test_session_seed_drives_sensor_noise(tmp_path):
    a = _run(tmp_path / "a", seed=1)
    b = _run(tmp_path / "b", seed=2)
    assert a != b
