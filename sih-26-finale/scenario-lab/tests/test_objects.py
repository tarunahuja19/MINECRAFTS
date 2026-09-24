"""What is built on the ground: it loads, it lands in the right place, and it refuses to be fudged."""

import dataclasses

import numpy as np
import pytest
import yaml

from lab.objects import load_objects, objects_or_none
from lab.sampling import grid_bounds_m


def test_the_example_village_loads_and_is_labelled_illustrative(cfg, grid):
    objs = load_objects(cfg, grid)
    assert len(objs) > 0
    assert len({o.id for o in objs}) == len(objs), "object ids must be unique"
    # Invariant 7 in the small: nobody surveyed this village, and every sentence about it says so.
    assert all("illustrative" in o.layout_note for o in objs)
    kinds = {o.type for o in objs}
    assert {"house", "road", "pole"} <= kinds


def test_every_object_is_inside_the_grid(cfg, grid):
    x_min, x_max, y_min, y_max = grid_bounds_m(grid)
    for obj in load_objects(cfg, grid):
        xs, ys = obj.sample_points(grid.cell_m)
        assert xs.min() >= x_min and xs.max() <= x_max
        assert ys.min() >= y_min and ys.max() <= y_max


def _write(tmp_path, entries, defaults=None):
    path = tmp_path / "objects.yaml"
    path.write_text(yaml.safe_dump({"schema_version": 1, "layout": "test fixture, illustrative",
                                    "defaults": defaults or {}, "objects": entries}))
    return path


def test_an_object_off_the_grid_is_an_error_not_a_clamp(cfg, grid, tmp_path):
    """WP9 §6. A clamped house answers a question about ground nobody asked about — with a grade."""
    _x_min, x_max, _y_min, _y_max = grid_bounds_m(grid)
    path = _write(tmp_path, [{"id": "HX", "type": "house", "x_m": x_max + cfg.r, "y_m": 0.0,
                              "width_m": 10.0, "depth_m": 8.0}])
    with pytest.raises(ValueError) as e:
        load_objects(cfg, grid, path)
    assert "HX" in str(e.value) and "outside" in str(e.value)


def test_objects_are_declared_in_the_panel_frame_and_move_with_their_panel(cfg, grid, tmp_path):
    """Hazard H8: a village pinned to world coordinates sits over the wrong panel the moment the
    district gains one."""
    path = _write(tmp_path, [{"id": "H_A", "type": "house", "panel": 1, "x_m": 600.0, "y_m": 100.0,
                              "width_m": 10.0, "depth_m": 8.0},
                             {"id": "H_B", "type": "house", "panel": 2, "x_m": 600.0, "y_m": 100.0,
                              "width_m": 10.0, "depth_m": 8.0}])
    offset = cfg.panel.district_half_width_m
    two_panels = dataclasses.replace(cfg, panel=dataclasses.replace(cfg.panel, y_offsets_m=(0.0, offset)))
    a, b = load_objects(two_panels, grid, path)
    assert b.y_m - a.y_m == pytest.approx(offset)


def test_an_object_on_a_panel_this_mine_does_not_have_is_refused(cfg, grid, tmp_path):
    path = _write(tmp_path, [{"id": "H_Z", "type": "house", "panel": 9, "x_m": 600.0, "y_m": 100.0,
                              "width_m": 10.0, "depth_m": 8.0}])
    with pytest.raises(ValueError) as e:
        load_objects(cfg, grid, path)
    assert "panel" in str(e.value) and "H_Z" in str(e.value)


@pytest.mark.parametrize("entry, word", [
    ({"id": "X1", "type": "helipad", "x_m": 600.0, "y_m": 0.0}, "unknown type"),
    ({"id": "X2", "type": "road", "x_m": 600.0, "y_m": 0.0}, "needs"),
    ({"id": "X3", "type": "house", "x_m": 600.0, "y_m": 0.0,
      "line": [[0.0, 0.0], [10.0, 0.0]]}, "must not have"),
])
def test_a_malformed_object_is_refused_at_load_time(cfg, grid, tmp_path, entry, word):
    with pytest.raises(ValueError) as e:
        load_objects(cfg, grid, _write(tmp_path, [entry]))
    assert word in str(e.value)


def test_a_duplicate_id_is_refused(cfg, grid, tmp_path):
    entry = {"id": "H1", "type": "house", "x_m": 600.0, "y_m": 100.0, "width_m": 10.0, "depth_m": 8.0}
    with pytest.raises(ValueError) as e:
        load_objects(cfg, grid, _write(tmp_path, [entry, dict(entry)]))
    assert "twice" in str(e.value)


def test_a_house_is_sampled_over_its_whole_footprint(cfg, grid, tmp_path):
    """The NCB grade is a change of LENGTH, so the footprint is what matters, not the centre point."""
    path = _write(tmp_path, [{"id": "H_F", "type": "house", "x_m": 600.0, "y_m": 100.0,
                              "width_m": 10.0, "depth_m": 8.0}])
    obj, = load_objects(cfg, grid, path)
    xs, ys = obj.sample_points(grid.cell_m)
    assert xs.min() == pytest.approx(595.0) and xs.max() == pytest.approx(605.0)
    assert ys.min() == pytest.approx(96.0) and ys.max() == pytest.approx(104.0)


def test_a_road_is_sampled_along_its_whole_line(cfg, grid, tmp_path):
    path = _write(tmp_path, [{"id": "R_F", "type": "road", "width_m": 6.0,
                              "line": [[300.0, 0.0], [900.0, 0.0]]}])
    obj, = load_objects(cfg, grid, path)
    xs, ys = obj.sample_points(grid.cell_m)
    assert xs.min() == pytest.approx(300.0) and xs.max() == pytest.approx(900.0)
    assert np.allclose(ys, 0.0)
    # One point per cell along the line, ends included.
    assert len(xs) == pytest.approx((900.0 - 300.0) / grid.cell_m + 1, abs=1)


def test_a_mine_with_no_objects_file_is_a_legitimate_answer(cfg, grid, tmp_path):
    assert objects_or_none(cfg, grid, tmp_path / "does-not-exist.yaml") == []
