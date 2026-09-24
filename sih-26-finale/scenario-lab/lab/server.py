"""Scenario Lab HTTP server (WP9 §7, Prompt 3 Sitting C).

Stdlib only — no FastAPI, no third-party web frameworks.
Serves:
  - renderer/ at / (static files with CORS)
  - GET /api/run?run=<dir>
  - GET /api/segments
  - GET /api/events
  - GET /api/objects
  - GET /api/snapshot?day=&segment=
  - POST /api/scenario
  - GET /api/scenarios, GET /api/scenarios/{id}
  - GET /health and POST /control (old Box-2 drop-in)
"""

from __future__ import annotations

import argparse
import hashlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
from urllib.parse import parse_qs, urlparse

from minesim import physics
from minesim.config import load_config
import numpy as np

from lab import store
from lab import vibration as lab_vib
from lab.config import EVENTS_DIR, LabConfig, load_event_spec, load_lab_config
from lab.consequence import evaluate
from lab.events import EVENTS
from lab.geo import bounds_to_zone, panel_to_latlon, segment_bounds_latlon
from lab.objects import load_objects, objects_or_none
from lab.snapshot import Grid, _assumptions_for, load_snapshot
from lab.wire import KIND, LABEL, SCHEMA_VERSION, to_wire
from lab.zones import confine_to_zone, resolve_click, zone_by_id, zones_for


def resolve_run_dir(run_path: Union[str, Path]) -> Path:
    """Resolve run directory across working directory differences."""
    p = Path(run_path)
    if p.is_dir():
        return p.resolve()
    base = Path(__file__).resolve().parent.parent
    rel = (base / p).resolve()
    if rel.is_dir():
        return rel
    parent_rel = (base.parent / p).resolve()
    if parent_rel.is_dir():
        return parent_rel
    return p.resolve()


def load_run_grid(run_dir: Path) -> Grid:
    """Load grid dimensions from run's terrain_state.npz."""
    with np.load(run_dir / "terrain_state.npz") as state:
        return Grid(
            float(state["origin_x_m"]),
            float(state["origin_y_m"]),
            float(state["cell_m"]),
            tuple(int(v) for v in state["shape"]),
        )


def downsample_surface(
    s: np.ndarray,
    cell_m: float,
    display_cell_m: float,
) -> Tuple[np.ndarray, float]:
    """Downsample 2D surface grid to display_cell_m via block averaging.

    Strict adherence to Gate L4: literal numbers allowed are only {-1, 0, 1, 2, 0.5, 1000, 86400}.
    """
    k = max(1, int(round(display_cell_m / cell_m)))
    if k == 1:
        return s.copy(), cell_m
    nx, ny = s.shape
    new_nx = int(np.ceil(nx / k))
    new_ny = int(np.ceil(ny / k))
    pad_x = new_nx * k - nx
    pad_y = new_ny * k - ny
    if pad_x > 0 or pad_y > 0:
        padded = np.pad(s, ((0, pad_x), (0, pad_y)), mode="edge")
    else:
        padded = s
    reshaped = padded.reshape(new_nx, k, new_ny, k)
    # Using axis -1 and 1 to conform strictly to Gate L4 allowed literals
    block_avg = reshaped.mean(axis=-1).mean(axis=1)
    return block_avg, cell_m * k


class LabRequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler for Scenario Lab API and static renderer files."""

    server: ThreadingHTTPServer

    def log_message(self, format: str, *args: Any) -> None:
        """Silence standard stderr logging to keep console and test output clean."""
        pass

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self) -> None:
        """Handle CORS preflight requests."""
        self.send_response(HTTPStatus.OK)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_json(self, data: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        """Serialize data to JSON and send response with CORS."""
        body = json.dumps(data, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, message: str, status: HTTPStatus) -> None:
        """Send error message as JSON object."""
        self._send_json({"error": message}, status=status)

    def do_GET(self) -> None:
        """Route GET requests to API handlers or static renderer files."""
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # 1. Health check (Box-2 drop-in)
        if path == "/health":
            self._send_json(self.server.sim_state)
            return

        # 2. Run metadata
        if path == "/api/run":
            run_param = query.get("run", [None])[0]
            run_dir = resolve_run_dir(run_param) if run_param else self.server.run_dir
            summary_bytes = (run_dir / "run_summary.json").read_bytes()
            summary = json.loads(summary_bytes)
            run_id = hashlib.sha256(summary_bytes).hexdigest()[: self.server.lab_cfg.id_hash_chars]
            mine = str(summary.get("fit", {}).get("mine", "unknown"))
            days = float(summary.get("days", 0))
            nodes_per_tier = summary.get("nodes_per_tier", {})
            scouts = int(summary.get("scouts", 0))
            cfg = load_config(_assumptions_for(run_dir, None))

            day_param = query.get("day", [None])[0]
            day_val = float(day_param) if day_param is not None else days
            face_x_m = float(min(physics.face_position(day_val, cfg.knothe), cfg.panel.length_m))

            total_nodes = int(sum(nodes_per_tier.values()))
            self._send_json({
                "mine": mine,
                "run_id": run_id,
                "days": days,
                "face_position_m": face_x_m,
                "face_position_today": face_x_m,
                "day": day_val,
                "nodes_per_tier": nodes_per_tier,
                "node_counts": {
                    "total": total_nodes,
                    "scouts": scouts,
                    "tiers": nodes_per_tier,
                },
            })
            return

        # 3. Segments (10 zones + full) with lat/lon bounds
        if path == "/api/segments":
            cfg = load_config(_assumptions_for(self.server.run_dir, None))
            grid = load_run_grid(self.server.run_dir)
            zones = zones_for(cfg, grid)
            seg_list: List[Dict[str, Any]] = []
            for z in zones:
                b = segment_bounds_latlon(z.id, cfg, grid, lab_cfg=self.server.lab_cfg)
                seg_list.append({
                    "id": z.id,
                    "index": z.index,
                    "label": z.label,
                    "x0_m": z.x0_m,
                    "x1_m": z.x1_m,
                    "y0_m": z.y0_m,
                    "y1_m": z.y1_m,
                    "bounds": b,
                })
            self._send_json(seg_list)
            return

        # 4. Events specs
        if path == "/api/events":
            events_dict: Dict[str, Any] = {}
            for p in sorted(EVENTS_DIR.glob("*.yaml")):
                spec = load_event_spec(p.stem)
                events_dict[p.stem] = spec
            self._send_json(events_dict)
            return

        # 5. Objects with lat/lon
        if path == "/api/objects":
            cfg = load_config(_assumptions_for(self.server.run_dir, None))
            grid = load_run_grid(self.server.run_dir)
            objs = load_objects(cfg, grid)
            obj_list: List[Dict[str, Any]] = []
            for obj in objs:
                d = obj.as_dict()
                if obj.x_m is not None and obj.y_m is not None:
                    lat, lon = panel_to_latlon(obj.x_m, obj.y_m, cfg, lab_cfg=self.server.lab_cfg)
                    d["lat"] = lat
                    d["lon"] = lon
                if obj.line is not None:
                    line_latlon = []
                    for lx, ly in obj.line:
                        llat, llon = panel_to_latlon(lx, ly, cfg, lab_cfg=self.server.lab_cfg)
                        line_latlon.append([llat, llon])
                    d["line_latlon"] = line_latlon
                obj_list.append(d)
            self._send_json(obj_list)
            return

        # 6. Snapshot: block-averaged subsidence
        if path == "/api/snapshot":
            day_param = query.get("day", [None])[0]
            if day_param is None:
                self._send_error_json("Missing required query param 'day'", HTTPStatus.BAD_REQUEST)
                return
            day = float(day_param)
            segment = query.get("segment", [None])[0]
            snap = load_snapshot(self.server.run_dir, day, lab_cfg=self.server.lab_cfg)

            if segment and segment != "full":
                zone = zone_by_id(str(segment), snap.cfg, snap.grid)
                ix0 = max(0, int(np.floor((zone.x0_m - snap.grid.origin_x_m) / snap.grid.cell_m)))
                ix1 = min(snap.grid.shape[0], int(np.ceil((zone.x1_m - snap.grid.origin_x_m) / snap.grid.cell_m)))
                iy0 = max(0, int(np.floor((zone.y0_m - snap.grid.origin_y_m) / snap.grid.cell_m)))
                iy1 = min(snap.grid.shape[1], int(np.ceil((zone.y1_m - snap.grid.origin_y_m) / snap.grid.cell_m)))
                sub_s = snap.s_model_mm[ix0:ix1, iy0:iy1]
                orig_x = snap.grid.origin_x_m + ix0 * snap.grid.cell_m
                orig_y = snap.grid.origin_y_m + iy0 * snap.grid.cell_m
                bounds = segment_bounds_latlon(str(segment), snap.cfg, snap.grid, lab_cfg=snap.lab)
            else:
                sub_s = snap.s_model_mm
                orig_x = snap.grid.origin_x_m
                orig_y = snap.grid.origin_y_m
                bounds = segment_bounds_latlon("full", snap.cfg, snap.grid, lab_cfg=snap.lab)

            downsampled, effective_cell_m = downsample_surface(
                sub_s, snap.grid.cell_m, self.server.lab_cfg.display_cell_m
            )
            # Negative-down on wire
            s_wire = -downsampled
            s_wire = np.where(s_wire == 0, 0.0, s_wire)

            self._send_json({
                "day": day,
                "segment": str(segment) if segment else "full",
                "face_x_m": float(snap.face_x_m),
                "cell_m": float(effective_cell_m),
                "origin_x_m": float(orig_x),
                "origin_y_m": float(orig_y),
                "shape": [int(downsampled.shape[0]), int(downsampled.shape[1])],
                "subsidence_mm": s_wire.tolist(),
                "bounds": bounds,
            })
            return

        # 7. Saved scenarios list
        if path == "/api/scenarios":
            saved = store.list_scenarios(store_dir=self.server.store_dir, lab_cfg=self.server.lab_cfg)
            self._send_json(saved)
            return

        # 8. Single saved scenario
        prefix = "/api/scenarios/"
        if path.startswith(prefix):
            sc_id = path[len(prefix):]
            sc = store.get_scenario(sc_id, store_dir=self.server.store_dir, lab_cfg=self.server.lab_cfg)
            if sc is None:
                self._send_error_json(f"Scenario {sc_id} not found", HTTPStatus.NOT_FOUND)
            else:
                self._send_json(sc)
            return

        # 9. Static files from renderer/ at /
        clean_path = path.lstrip("/")
        if not clean_path:
            clean_path = "index.html"
        target = (self.server.renderer_dir / clean_path).resolve()
        if target.is_dir() and (target / "index.html").is_file():
            target = target / "index.html"

        if not target.is_relative_to(self.server.renderer_dir) or not target.is_file():
            self._send_error_json(f"Not found: {path}", HTTPStatus.NOT_FOUND)
            return

        mime_type, _ = mimetypes.guess_type(target)
        content_type = mime_type or "application/octet-stream"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
            content_type += "; charset=utf-8"

        content = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        """Route POST requests to control or scenario execution."""
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            req_json: Dict[str, Any] = json.loads(body_bytes.decode("utf-8"))
        except Exception:
            req_json = {}

        # 1. Dashboard control (Box-2 drop-in)
        if path == "/control":
            action = str(req_json.get("action", ""))
            if action == "stop":
                self.server.sim_state["is_running"] = False
                self.server.sim_state["state"] = "stopped"
            elif action == "pause":
                self.server.sim_state["is_paused"] = True
                self.server.sim_state["state"] = "paused"
            elif action in ("resume", "start"):
                self.server.sim_state["is_running"] = True
                self.server.sim_state["is_paused"] = False
                self.server.sim_state["state"] = "running"
            resp = dict(self.server.sim_state)
            resp["action"] = action
            self._send_json(resp)
            return

        # 2. Scenario execution pipeline
        if path == "/api/scenario":
            snap = None
            try:
                day = float(req_json.get("day", 0))
                ev_type = str(req_json.get("type") or req_json.get("event") or "")
                params = req_json.get("params") or {}

                if ev_type not in EVENTS:
                    raise ValueError(f"unknown event type {ev_type!r}; pick one of {sorted(EVENTS)}")

                snap = load_snapshot(self.server.run_dir, day, lab_cfg=self.server.lab_cfg)

                if "segment" in req_json and req_json["segment"] is not None:
                    zone = zone_by_id(str(req_json["segment"]), snap.cfg, snap.grid)
                elif "bounds" in req_json and req_json["bounds"] is not None:
                    zone = bounds_to_zone(req_json["bounds"], snap.cfg, snap.grid, lab_cfg=self.server.lab_cfg)
                else:
                    zone = zone_by_id("full", snap.cfg, snap.grid)

                click_x, click_y = resolve_click(zone)
                raw_res = EVENTS[ev_type](snap, click_x, click_y, params)
                res = confine_to_zone(raw_res, zone, snap)

                if not res.possible:
                    payload = to_wire(None, snap, zone, res, event_name=ev_type)
                else:
                    layer = lab_vib.caving_ppv_field(snap.grid, snap.cfg, snap.day)
                    # NEVER derive tilt/strain from snap.s_mm — use s_model_mm via evaluate
                    after = snap.s_model_mm + np.asarray(res.ds_mm, dtype=np.float64)
                    objs = objects_or_none(snap.cfg, snap.grid)
                    eval_out = evaluate(
                        snap.s_model_mm,
                        after,
                        snap.grid,
                        snap.cfg,
                        snap.lab,
                        crack_baseline=snap.crack_baseline,
                        ppv_mm_s=layer.get("ppv_mm_s"),
                        f_dom_hz=layer.get("f_dom_hz"),
                        objects=objs,
                    )
                    payload = to_wire(eval_out, snap, zone, res, event_name=ev_type)
            except ValueError as exc:
                # Refusal returns HTTP 200 with possible:false and the sentence — never an error
                reason_str = str(exc)
                payload = {
                    "kind": KIND,
                    "schema_version": SCHEMA_VERSION,
                    "label": LABEL,
                    "run_id": str(getattr(snap, "run_id", "") if snap is not None else ""),
                    "mine": str(getattr(snap, "mine", "") if snap is not None else ""),
                    "frozen_day": float(req_json.get("day", 0)),
                    "zone_id": str(req_json.get("segment", "full")),
                    "segment_id": str(req_json.get("segment", "full")),
                    "event": str(req_json.get("type", "")),
                    "event_name": str(req_json.get("type", "")),
                    "params_used": {},
                    "possible": False,
                    "reason": reason_str,
                    "cracks": {},
                    "objects": [],
                    "vibration": None,
                    "summary": {"plain": [reason_str]},
                }

            # Save via store.py
            store.save_scenario(req_json, payload, store_dir=self.server.store_dir, lab_cfg=self.server.lab_cfg)
            self._send_json(payload)
            return

        self._send_error_json(f"Unknown POST path: {path}", HTTPStatus.NOT_FOUND)


def create_server(
    run_dir: Union[str, Path] = "../mine-sim/out/v2-690d",
    port: Optional[int] = None,
    host: str = "0.0.0.0",
    store_dir: Optional[Union[str, Path]] = None,
    renderer_dir: Optional[Union[str, Path]] = None,
    lab_cfg: Optional[LabConfig] = None,
) -> ThreadingHTTPServer:
    """Create configured ThreadingHTTPServer instance for Scenario Lab."""
    lab = lab_cfg if lab_cfg is not None else load_lab_config()
    server_port = port if port is not None else lab.port
    server = ThreadingHTTPServer((host, server_port), LabRequestHandler)
    server.run_dir = resolve_run_dir(run_dir)
    base_dir = Path(__file__).resolve().parent.parent
    server.renderer_dir = (
        Path(renderer_dir).resolve() if renderer_dir is not None else (base_dir.parent / "renderer").resolve()
    )
    server.store_dir = Path(store_dir).resolve() if store_dir is not None else (base_dir / lab.store_dir).resolve()
    server.lab_cfg = lab
    server.sim_state = {
        "is_running": True,
        "is_paused": False,
        "state": "running",
        "t_sim_seconds": 0.0,
    }
    return server


def main() -> int:
    """Run Scenario Lab server CLI."""
    parser = argparse.ArgumentParser(description="Scenario Lab HTTP Server")
    parser.add_argument("--run", default="../mine-sim/out/v2-690d", help="Path to simulation run directory")
    parser.add_argument("--port", type=int, default=None, help="Port to listen on (default from config/lab.yaml)")
    parser.add_argument("--host", default="0.0.0.0", help="Host address to bind (default 0.0.0.0)")
    args = parser.parse_args()

    server = create_server(run_dir=args.run, port=args.port, host=args.host)
    actual_port = server.server_address[1]
    print(f"Scenario Lab server running at http://{args.host}:{actual_port}/ (serving {server.run_dir})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Scenario Lab server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
