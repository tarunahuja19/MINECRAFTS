"""The moving bowl reaches the 3D views as bowl_px (static, /config and the WS
init) times bowl_py (per live tick)."""

import numpy as np
from starlette.testclient import TestClient

from sandbox import surface
from sandbox.server import app, get_session

X, Y = surface.grid()


def test_config_carries_bowl_px():
    with TestClient(app) as client:
        px = client.get("/config").json()["bowl_px"]
    assert len(px) == 121
    assert px == surface.bowl_px_wire()


def test_ws_init_and_tick_carry_bowl_profiles():
    session = get_session()
    session.stop()
    session.pillar_failures.clear()
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            init = ws.receive_json()
            assert len(init["bowl_px"]) == 121
            ws.send_json({"action": "start"})
            tick = ws.receive_json()
            assert len(tick["bowl_py"]) == 121
            assert isinstance(tick["face_y_m"], float)
            # Rebuilt bowl equals the downsampled truth at the tick's own day.
            s = surface.channels(X, Y, tick["t_days"])["s"][::2, ::2]
            rebuilt = np.outer(tick["bowl_py"], init["bowl_px"])
            np.testing.assert_allclose(rebuilt, s, atol=5e-4)
            ws.send_json({"action": "stop"})


def test_wire_profiles_follow_the_face():
    px = surface.bowl_px_wire()
    assert len(px) == 121 and max(px) > 0
    assert not any(surface.bowl_py_wire(0.0))
    assert max(surface.bowl_py_wire(200.0)) > max(surface.bowl_py_wire(40.0))
