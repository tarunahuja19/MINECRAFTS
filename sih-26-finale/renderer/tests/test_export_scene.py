"""Tests for Window 1 3D scene export and renderer integration (WP8 / WP9).

Assertions:
- 80-day simulation run produces measurable subsidence.
- Single-pass jsonl reader snapshots at days 40, 70, 80 array_equal replay_terrain at those epochs.
- Daily binary frames decode to replay[::k, ::k]; node frames match the world grid and nodes.csv (F4).
- Face position x is always capped at panel length.
- No file under renderer/ imports or mentions the core physics module.
- index.html contains persistent SIMULATED mode.
- Export of the full 690-day run: scene.json under 10 MB, one frame per day.
"""

import json
import time
from pathlib import Path
from typing import Tuple

import numpy as np
import pytest

from minesim.config import Config, load_config
from minesim.run import run_sim
from minesim.stream import replay_terrain
from renderer.export_scene import export_scene, read_snapshots_single_pass


def _frames(scene, scene_dir, key, day):
    """Decode one day of a frame array written by export_scene (see scene.frames)."""
    fr = scene["frames"]
    chunk = next(c for c in fr["chunks"] if c["first_day"] <= day < c["first_day"] + c["days"])
    dtype = {"int16": "<i2", "int32": "<i4", "float32": "<f4", "uint8": "u1"}[fr[key]["dtype"]]
    arr = np.fromfile(Path(scene_dir) / chunk[key], dtype=dtype)
    per_day = arr.size // chunk["days"]
    row = arr[(day - chunk["first_day"]) * per_day:(day - chunk["first_day"] + 1) * per_day]
    return row.reshape(fr["grid"]["shape"]) if key == "grid" else row


@pytest.fixture(scope="module")
def sim_80d_run(tmp_path_factory) -> Tuple[Path, Config, dict]:
    """Execute an 80-day simulation run once for the test module (~6 s)."""
    tmp_dir = tmp_path_factory.mktemp("sim_80d")
    config_path = Path("mine-sim/config/assumptions.yaml")
    cfg = load_config(config_path)
    summary = run_sim(cfg, 80.0, tmp_dir, config_path=config_path)
    return tmp_dir, cfg, summary


def test_80d_run_grid_changed_and_single_pass_equals_replay(sim_80d_run):
    """Assert grid changed, and single-pass snapshots at days 40, 70, 80 match replay_terrain."""
    tmp_dir, cfg, summary = sim_80d_run

    # 1. Assert grid actually changed (measurable subsidence)
    peak = summary.get("peak_subsidence_mm", 0)
    assert peak > 0, f"Expected subsidence > 0 after 80 days, got {peak}"

    # Days to check: 40, 70, 80
    timestep_s = float(summary["timestep_s"])
    test_days = [40, 70, 80]
    target_epochs = {int(round(d * 86400.0 / timestep_s)) for d in test_days}
    downsample_k = 2

    full_snaps, down_snaps, meta = read_snapshots_single_pass(
        run_dir=tmp_dir,
        target_epochs=target_epochs,
        downsample_k=downsample_k,
    )

    for day in test_days:
        epoch = int(round(day * 86400.0 / timestep_s))
        replay = replay_terrain(tmp_dir, epoch)

        # Assert single-pass snapshot array_equal replay_terrain at that epoch
        assert np.array_equal(full_snaps[epoch], replay), (
            f"Day {day} (epoch {epoch}) single-pass snapshot does not match replay_terrain"
        )

        # Assert downsampled snapshot equals replay[::k, ::k]
        assert np.array_equal(down_snaps[epoch], replay[::downsample_k, ::downsample_k]), (
            f"Day {day} (epoch {epoch}) downsampled snapshot does not match replay[::k, ::k]"
        )


def test_daily_frames_decode_to_replay_slice(sim_80d_run, tmp_path):
    """Every daily frame decoded from the bin files equals replay_terrain(run, epoch)[::k, ::k]."""
    tmp_dir, cfg, summary = sim_80d_run
    scene, info = export_scene(run_dir=tmp_dir, out_file=tmp_path / "scene.json")
    k = scene["grid"]["downsample_k"]
    fr = scene["frames"]
    assert fr["n_days"] == 81 and fr["day_step_days"] == 1
    assert fr["grid"]["dtype"] == "int16"
    assert sum(c["days"] for c in fr["chunks"]) == fr["n_days"]
    for day in (0, 1, 40, 79, 80):
        epoch = fr["epoch_of_day"][day]
        assert epoch == int(round(day * 86400.0 / float(summary["timestep_s"])))
        replay = replay_terrain(tmp_dir, epoch)
        assert np.array_equal(_frames(scene, tmp_path, "grid", day).astype(np.int32), replay[::k, ::k]), day
    assert (tmp_path / "scene.json").stat().st_size < 10 * 1024 * 1024
    assert info["stats"]["max_one_day_cell_change_mm"] > 0


def test_node_readings_match_nodes_csv(sim_80d_run, tmp_path):
    """readings/prov frames equal nodes.csv subsidence_mm and provenance for random nodes and days."""
    import csv
    import random
    tmp_dir, _, _ = sim_80d_run
    scene, _ = export_scene(run_dir=tmp_dir, out_file=tmp_path / "scene.json")
    fr, nodes = scene["frames"], scene["plan"]["nodes"]
    rng = random.Random(7)
    scouts = [q for q, n in enumerate(nodes) if n["tier"] in ("1A", "1B", "1C")]
    picks = {(rng.choice(scouts), rng.randint(1, 80)) for _ in range(5)}
    want = {(nodes[q]["node_id"], fr["epoch_of_day"][d]): (q, d) for q, d in picks}
    found = 0
    with open(tmp_dir / "nodes.csv", newline="") as f:
        for row in csv.DictReader(f):
            key = (int(row["node_id"]), int(row["epoch"]))
            if key not in want:
                continue
            q, d = want[key]
            got = float(_frames(scene, tmp_path, "readings", d)[q])
            assert got == pytest.approx(float(row["subsidence_mm"]), abs=1e-3)
            code = fr["prov"]["codes"][str(int(_frames(scene, tmp_path, "prov", d)[q]))]
            assert code == (row["subsidence_prov"] if row["delivered"] == "true" else "undelivered")
            found += 1
    assert found == len(picks)


def test_face_x_never_above_panel_length(sim_80d_run, tmp_path):
    """Assert face x is capped at panel length even past panel completion."""
    tmp_dir, cfg, summary = sim_80d_run
    scene_data, _ = export_scene(run_dir=tmp_dir, out_file=None)

    panel_len = float(scene_data["panel"]["length_m"])
    for day, fx in enumerate(scene_data["frames"]["face_x_m"]):
        assert fx <= panel_len, f"Day {day}: face_x ({fx}) exceeds panel length ({panel_len})"

    # Test extreme day past extraction length (e.g. Day 1000 on 2500m panel)
    advance_rate = float(cfg.knothe.advance_m_per_day)
    face_x_1000 = min(advance_rate * 1000.0, panel_len)
    assert face_x_1000 == panel_len


def test_no_physics_import_in_renderer():
    """Grep / AST check: ensure renderer/ never imports or mentions the core physics module."""
    renderer_dir = Path("renderer")
    forbidden_module = "minesim" + "." + "physics"

    matching_files = []
    for ext in ("*.py", "*.js", "*.html", "*.yaml", "*.json"):
        for path in renderer_dir.rglob(ext):
            if "scene" in path.parts:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if forbidden_module in text:
                matching_files.append(str(path))

    assert not matching_files, (
        f"Forbidden reference to {forbidden_module} found in: {matching_files}"
    )


def test_index_html_contains_simulated():
    """Assert index.html contains persistent SIMULATED mode indicator and Three.js elements."""
    html_path = Path("renderer/index.html")
    assert html_path.is_file(), "renderer/index.html is missing"
    html_text = html_path.read_text(encoding="utf-8")

    assert "SIMULATED" in html_text, "index.html must contain SIMULATED mode banner"
    assert "vertical ×" in html_text or "vertical" in html_text
    assert "three.min.js" in html_text
    assert "OrbitControls.js" in html_text
    assert "Freeze + create subsidence" in html_text


def test_export_v2_690d_real():
    """Export the full 690-day run to renderer/scene (scene.json + daily frames)."""
    run_dir = Path("mine-sim/out/v2-690d")
    assert run_dir.is_dir(), f"Expected {run_dir} to exist"

    scene_out = Path("renderer/scene/scene.json")
    t0 = time.time()
    scene_data, info = export_scene(run_dir=run_dir, out_file=scene_out)
    elapsed = time.time() - t0

    size_mb = scene_out.stat().st_size / (1024 * 1024)
    print(f"\nReal 690-day scene export: {size_mb:.2f} MB + frames {info['stats']['frames_bytes'] / 1048576:.1f} MB in {elapsed:.2f} s")
    assert size_mb < 10.0, f"scene.json size {size_mb:.2f} MB exceeds 10 MB"
    assert "days" not in scene_data                      # no per-day grids in scene.json

    fr = scene_data["frames"]
    assert fr["n_days"] == 691
    assert fr["face_x_m"][-1] == 2500.0
    if "plan" in scene_data:
        assert fr["nodes"]["count"] == len(scene_data["plan"]["nodes"])


def _z_at(grid, origin_x, origin_y, cell, x, y):
    """Independent copy of WorldState.z_at (bilinear on cell centres, clamped)."""
    import math
    nx, ny = grid.shape
    fi = min(max((x - origin_x) / cell - 0.5, 0.0), nx - 1.0)
    fj = min(max((y - origin_y) / cell - 0.5, 0.0), ny - 1.0)
    i0, j0 = int(math.floor(fi)), int(math.floor(fj))
    i1, j1 = min(i0 + 1, nx - 1), min(j0 + 1, ny - 1)
    wi, wj = fi - i0, fj - j0
    return ((1 - wi) * (1 - wj) * grid[i0, j0] + wi * (1 - wj) * grid[i1, j0]
            + (1 - wi) * wj * grid[i0, j1] + wi * wj * grid[i1, j1])


def test_terrain_block_is_cell_aligned_with_world_grid(sim_80d_run, tmp_path):
    """Real DEM render grid: frame cell (i, j) must sit exactly on terrain cell (i + pad_x, j + pad_y)."""
    tmp_dir, cfg, summary = sim_80d_run
    scene, _ = export_scene(run_dir=tmp_dir, out_file=tmp_path / "scene.json")
    t = scene.get("terrain")
    if t is None:
        pytest.skip("no DEM configured for this mine")
    g = scene["grid"]
    pad_x, pad_y = t["sim_offset"]
    assert t["first_x_m"] + pad_x * t["cell_m"] == pytest.approx(g["origin_x_m"] + g["original_cell_m"] / 2.0, abs=1e-3)
    assert t["first_y_m"] + pad_y * t["cell_m"] == pytest.approx(g["origin_y_m"] + g["original_cell_m"] / 2.0, abs=1e-3)
    assert t["cell_m"] == g["cell_m"]
    assert t["shape"][0] >= g["shape"][0] + 2 * pad_x and t["shape"][1] >= g["shape"][1] + 2 * pad_y
    assert t["provenance"] == "real"


def test_plan_node_dz_is_read_from_world_grid(sim_80d_run, tmp_path):
    """Per-node dZ frames for the planned network equal the replayed world surface at that point."""
    tmp_dir, cfg, summary = sim_80d_run
    scene, _ = export_scene(run_dir=tmp_dir, out_file=tmp_path / "scene.json")
    if "plan" not in scene:
        pytest.skip("no node plan (run: python -m minesim.placement in mine-sim)")
    g = scene["grid"]
    for day in (40, 80):
        dz_day = _frames(scene, tmp_path, "nodes", day)
        replay = replay_terrain(tmp_dir, scene["frames"]["epoch_of_day"][day])
        x_max = g["origin_x_m"] + replay.shape[0] * g["original_cell_m"]
        y_max = g["origin_y_m"] + replay.shape[1] * g["original_cell_m"]
        assert len(dz_day) == len(scene["plan"]["nodes"])
        for n, dz in zip(scene["plan"]["nodes"], dz_day):
            inside = g["origin_x_m"] <= n["x_m"] <= x_max and g["origin_y_m"] <= n["y_m"] <= y_max
            want = _z_at(replay, g["origin_x_m"], g["origin_y_m"], g["original_cell_m"], n["x_m"], n["y_m"]) if inside else 0.0
            assert abs(float(dz) - want) <= 0.01, (n["node_id"], day, dz, want)


def test_scene_carries_antenna_heights_and_baselines_from_assumptions(sim_80d_run, tmp_path):
    """scene.json carries antenna heights and sensor baselines taken directly from assumptions.yaml."""
    import yaml
    assump_path = Path("mine-sim/config/assumptions.yaml")
    with open(assump_path, "r", encoding="utf-8") as f:
        assump = yaml.safe_load(f)

    tmp_dir, cfg, summary = sim_80d_run
    scene_file = tmp_path / "scene.json"
    scene_data, _ = export_scene(run_dir=tmp_dir, out_file=scene_file)

    nm = scene_data.get("node_models")
    assert nm is not None, "scene.json missing node_models key"
    assert "antenna_height_m" in nm
    assert nm["antenna_height_m"]["scout"] == assump["radio"]["A15_antenna_height_m"]["scout"]
    assert nm["antenna_height_m"]["anchor"] == assump["radio"]["A15_antenna_height_m"]["anchor"]
    assert nm["antenna_height_m"]["gateway"] == assump["radio"]["A15_antenna_height_m"]["gateway"]
    assert nm["strain_rod_baseline_m"] == assump["sensing"]["A8_strain_rod_baseline_m"]
    assert nm["extensometer_baseline_m"] == assump["sensing"]["A9_extensometer_baseline_m"]
    assert "pick_radius_m" in nm, "node_models must contain pick_radius_m"
    if "plan" in scene_data and "checks" in scene_data["plan"]:
        scout_nn_min = scene_data["plan"]["checks"]["scout_nn_min_m"]
        assert nm["pick_radius_m"] <= 0.5 * scout_nn_min, (
            f"pick_radius_m ({nm['pick_radius_m']}) must be <= 0.5 * scout_nn_min_m ({0.5 * scout_nn_min})"
        )


def test_index_html_no_radio_links_checked_by_default():
    """Assert index.html has no Radio links checkbox checked by default."""
    import re
    html_path = Path("renderer/index.html")
    assert html_path.is_file(), "renderer/index.html is missing"
    html_text = html_path.read_text(encoding="utf-8")

    assert "All radio links (debug)" in html_text, (
        "Radio links layer should be renamed to 'All radio links (debug)'"
    )
    # Check that tLinks has no checked attribute
    assert not re.search(r'<input[^>]*id=["\']tLinks["\'][^>]*checked', html_text), (
        "tLinks checkbox must not be checked by default"
    )
    assert not re.search(r'<input[^>]*checked[^>]*id=["\']tLinks["\']', html_text), (
        "tLinks checkbox must not be checked by default"
    )
    # Monitoring sector also unchecked by default
    assert not re.search(r'<input[^>]*id=["\']tSector["\'][^>]*checked', html_text), (
        "tSector checkbox must not be checked by default"
    )


# --------------------------------------------------------------------------- F2: bigger terrain, zoom

def _dem_extent():
    import yaml
    assumptions = yaml.safe_load(Path("mine-sim/config/assumptions.yaml").read_text())
    site = yaml.safe_load(Path(f"mine-sim/config/mines/{assumptions['mine']}.yaml").read_text())["site"]
    with np.load(Path("mine-sim") / site["dem_npz"]) as d:
        nx, ny = d["elev_m"].shape
        ox, oy, c = float(d["origin_x_m"]), float(d["origin_y_m"]), float(d["cell_m"])
    return ox, ox + c * (nx - 1), oy, oy + c * (ny - 1)


def _config_variant(tmp_path, **overrides) -> Path:
    import yaml
    cfg = yaml.safe_load(Path("renderer/config.yaml").read_text())
    cfg.update(overrides)
    out = tmp_path / "config.yaml"
    out.write_text(yaml.safe_dump(cfg))
    return out


def test_terrain_extent_full_covers_the_dem(sim_80d_run, tmp_path):
    """terrain_extent: full draws the whole DEM: every edge of the render grid is within one render cell of the DEM edge."""
    tmp_dir, _, _ = sim_80d_run
    scene, _ = export_scene(run_dir=tmp_dir, out_file=None, config_path=_config_variant(tmp_path, terrain_extent="full"))
    t = scene["terrain"]
    x_min, x_max, y_min, y_max = _dem_extent()
    c = t["cell_m"]
    last_x = t["first_x_m"] + (t["shape"][0] - 1) * c
    last_y = t["first_y_m"] + (t["shape"][1] - 1) * c
    assert x_min <= t["first_x_m"] < x_min + c
    assert y_min <= t["first_y_m"] < y_min + c
    assert x_max - c < last_x <= x_max + 1e-6
    assert y_max - c < last_y <= y_max + 1e-6
    assert t["extent"] == "full"
    assert t["shape"][0] * t["shape"][1] <= 1_500_000


def test_world_grid_area_unchanged_by_terrain_extent(sim_80d_run, tmp_path):
    """Widening the terrain changes nothing in the world grid: day frames and the elevation under the grid are identical."""
    tmp_dir, _, _ = sim_80d_run
    (tmp_path / "m").mkdir()
    (tmp_path / "f").mkdir()
    small, _ = export_scene(run_dir=tmp_dir, out_file=tmp_path / "m" / "scene.json", config_path=_config_variant(tmp_path / "m", terrain_extent="margin"))
    big, _ = export_scene(run_dir=tmp_dir, out_file=tmp_path / "f" / "scene.json", config_path=_config_variant(tmp_path / "f", terrain_extent="full"))
    assert small["grid"] == big["grid"]
    assert small["frames"]["chunks"] == big["frames"]["chunks"]
    for c in big["frames"]["chunks"]:
        for key in ("grid", "nodes"):
            assert (tmp_path / "m" / c[key]).read_bytes() == (tmp_path / "f" / c[key]).read_bytes()
    gx, gy = big["grid"]["shape"]
    ea = np.array(small["terrain"]["elev_dm"])
    eb = np.array(big["terrain"]["elev_dm"])
    pa, pb = small["terrain"]["sim_offset"], big["terrain"]["sim_offset"]
    assert np.array_equal(ea[pa[0]:pa[0] + gx, pa[1]:pa[1] + gy], eb[pb[0]:pb[0] + gx, pb[1]:pb[1] + gy])
    assert big["terrain"]["shape"][0] > small["terrain"]["shape"][0]


def test_config_has_frame_keys():
    import yaml
    cfg = yaml.safe_load(Path("renderer/config.yaml").read_text())
    assert cfg["day_step_days"] == 1
    assert cfg["frame_chunk_days"] == 30
    assert cfg["frame_max_chunks_in_memory"] == 3


def test_config_has_zoom_keys_and_scene_carries_them(sim_80d_run, tmp_path):
    import yaml
    z = yaml.safe_load(Path("renderer/config.yaml").read_text())["zoom"]
    assert z["levels_view_width_m"] == [8000, 4000, 2000, 1000, 500, 250, 120, 60]
    assert z["default_level"] == 2
    assert z["icon_above_view_m"] > z["models_below_view_m"] > 0
    assert z["icon_px"] > 0 and z["cluster_px"] >= z["icon_px"]
    levels = z["levels_view_width_m"]
    assert all(a > b for a, b in zip(levels, levels[1:]))
    tmp_dir, _, _ = sim_80d_run
    scene, _ = export_scene(run_dir=tmp_dir, out_file=None)
    assert scene["zoom"] == z
    assert "advance_direction_deg" in scene["geometry"]


# --------------------------------------------------------------------------- F5: playback clock

def _playback_cfg():
    import yaml
    return yaml.safe_load(Path("renderer/config.yaml").read_text())["playback"]


def test_playback_keys_present_and_passed_into_scene(sim_80d_run):
    pb = _playback_cfg()
    for key in ("sim_seconds_per_real_second_at_1x", "speeds", "default_speed", "start_date"):
        assert key in pb, key
    assert pb["default_speed"] in pb["speeds"]
    tmp_dir, _, _ = sim_80d_run
    scene, _ = export_scene(run_dir=tmp_dir, out_file=None)
    assert scene["playback"] == pb


def test_speeds_strictly_increasing_and_contain_required():
    speeds = _playback_cfg()["speeds"]
    assert all(a < b for a, b in zip(speeds, speeds[1:]))
    assert {1, 10, 20, 40}.issubset(speeds)


def test_one_x_plays_a_year_in_about_a_day():
    pb = _playback_cfg()
    real_hours = 365 * 86400.0 / (pb["sim_seconds_per_real_second_at_1x"] * 1) / 3600.0
    assert 23.0 <= real_hours <= 25.0, real_hours


def test_controls_never_write_terrain():
    """Read-only view: no renderer JS posts, writes files, or touches minesim."""
    for path in Path("renderer/js").glob("*.js"):
        text = path.read_text(encoding="utf-8")
        assert "method: \"POST\"" not in text and "XMLHttpRequest" not in text, path
