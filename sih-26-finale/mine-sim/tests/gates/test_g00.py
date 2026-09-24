"""Gate G0 / G00 - Empirical Data Pinning & Residual Verification.

Enforces:
1. Every BROKEN A-tag in config/mines/adriyala_lw1.yaml is repinned from real data.
2. data/real/adriyala_lw1_profiles.csv exists with >= 3 epochs and >= 20 points per epoch.
3. data/fitted/adriyala_lw1_params.json records the Knothe R^2, N >= 200, RMS, verdict + escalation (R0-1).
4. load_config() returns valid Config without raising.
5. Unpinned parameters raise UnpinnedParameterError (negative test).
6. Second mine configuration exists and loads without code changes (mine independence).
"""

import csv
import json
import tempfile
from pathlib import Path
import pytest
import yaml

from minesim.config import load_config
from minesim.errors import UnpinnedParameterError


def test_g00_adriyala_config_pinned():
    """Assert all unpinned parameters in Adriyala config are populated with numbers."""
    mine_file = Path("config/mines/adriyala_lw1.yaml")
    assert mine_file.is_file(), "config/mines/adriyala_lw1.yaml must exist"
    with open(mine_file, "r") as f:
        mine_cfg = yaml.safe_load(f)

    assert mine_cfg["geometry"]["A3_seam_thickness_m"] is not None, "Seam thickness must be pinned"
    assert mine_cfg["knothe"]["A4_subsidence_factor"] is not None, "Subsidence factor must be pinned"
    assert mine_cfg["geometry"]["A1_panel_width_m"] == 250.0
    assert mine_cfg["geometry"]["A1_panel_length_m"] == 2500.0


def test_g00_adriyala_real_profiles_exist():
    """Assert real profiles CSV exists with >= 3 epochs and >= 20 points per epoch."""
    csv_file = Path("data/real/adriyala_lw1_profiles.csv")
    assert csv_file.is_file(), "Real profiles CSV must exist"

    epochs_count = {}
    with open(csv_file, "r", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ep = int(row["epoch_days"])
            epochs_count[ep] = epochs_count.get(ep, 0) + 1

    assert len(epochs_count) >= 3, f"Expected >= 3 epochs, got {len(epochs_count)}"
    for ep, count in epochs_count.items():
        assert count >= 20, f"Epoch {ep} has {count} points, expected >= 20"

    total_points = sum(epochs_count.values())
    assert total_points >= 200, f"Total points {total_points} must be >= 200"


def _check_fit_record(fit: dict) -> None:
    """G00 fit-record rules (R0-1): the reported R^2 belongs to the pinned Knothe params,
    a comparison model never supplies it, and the verdict + escalation are recorded."""
    assert fit["mine"] == "adriyala_lw1"
    assert "source_doi" in fit
    assert fit["fit"]["n_points"] >= 200, f"n_points must be >= 200, got {fit['fit']['n_points']}"
    assert fit["fit"]["rms_residual_mm"] > 0.0
    assert fit["fit"]["r_squared_model"].startswith("knothe"), "fit.r_squared must be the pinned Knothe R^2"
    assert 0.0 < fit["fit"]["r_squared"] <= 1.0
    if "profile_function" in fit:
        assert fit["profile_function"]["r_squared"] != fit["fit"]["r_squared"], \
            "comparison-model R^2 copied into fit.r_squared"
    assert "residual_by_flank" in fit
    assert "dip_side_rms_mm" in fit["residual_by_flank"]
    assert "rise_side_rms_mm" in fit["residual_by_flank"]
    assert fit["verdict"], "verdict must be recorded"
    if fit["fit"]["rms_residual_mm"] > 150.0:
        assert "Escalate" in fit["verdict"], "RMS > 150 mm must record an escalation"


def test_g00_fitted_params_json_valid():
    """Fit record is honest: Knothe R^2 reported, verdict and escalation recorded."""
    fitted_file = Path("data/fitted/adriyala_lw1_params.json")
    assert fitted_file.is_file(), "Fitted params JSON must exist"
    with open(fitted_file, "r") as f:
        fit = json.load(f)
    _check_fit_record(fit)
    print(f"G00 Knothe R^2 = {fit['fit']['r_squared']}, RMS = {fit['fit']['rms_residual_mm']} mm")


def test_g00_fit_record_negative_case():
    """A record whose r_squared came from the comparison model must fail the gate."""
    with open("data/fitted/adriyala_lw1_params.json", "r") as f:
        fit = json.load(f)
    fit["fit"]["r_squared"] = fit["profile_function"]["r_squared"]
    with pytest.raises(AssertionError):
        _check_fit_record(fit)
    fit_no_escalation = json.loads(json.dumps(fit))
    fit_no_escalation["fit"]["r_squared"] = 0.8201
    fit_no_escalation["fit"]["rms_residual_mm"] = 177.5
    fit_no_escalation["verdict"] = "looks fine"
    with pytest.raises(AssertionError):
        _check_fit_record(fit_no_escalation)


def test_g00_illinois_is_labelled_synthetic():
    """R0-2: the Illinois profiles are a synthetic fixture, not real data."""
    assert not Path("data/real/illinois_panel_profiles.csv").exists()
    assert Path("data/fixtures/illinois_synthetic_profiles.csv").is_file()
    with open("config/mines/illinois_lw.yaml", "r") as f:
        il = yaml.safe_load(f)
    assert il["pinning"]["source"].startswith("UNVERIFIED")


def test_g00_load_config_success():
    """Assert load_config() returns a valid Config dataclass without raising."""
    cfg = load_config(Path("config/assumptions.yaml"))
    assert cfg.panel.seam_thickness_m == 3.6
    assert cfg.panel.width_m == 250.0
    assert cfg.knothe.subsidence_factor > 0.0
    assert cfg.r > 0.0
    assert cfg.extent > 0.0
    assert cfg.window > 0.0


def test_g00_unpinned_parameter_negative_case():
    """Assert load_config() raises UnpinnedParameterError when a required parameter is null."""
    with open("config/mines/adriyala_lw1.yaml", "r") as f:
        mine_data = yaml.safe_load(f)

    # Deliberately inject null into A3
    mine_data["geometry"]["A3_seam_thickness_m"] = None

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        mines_dir = tmp_path / "mines"
        mines_dir.mkdir()
        with open(mines_dir / "adriyala_lw1.yaml", "w") as f:
            yaml.dump(mine_data, f)

        with open("config/assumptions.yaml", "r") as f:
            assump_data = yaml.safe_load(f)
        assump_file = tmp_path / "assumptions.yaml"
        with open(assump_file, "w") as f:
            yaml.dump(assump_data, f)

        with pytest.raises(UnpinnedParameterError):
            load_config(assump_file)


def test_g00_mine_independence():
    """Assert second mine (Illinois) runs through config loading without code change."""
    with open("config/assumptions.yaml", "r") as f:
        assump = yaml.safe_load(f)
    assump["mine"] = "illinois_lw"

    with tempfile.NamedTemporaryFile("w", suffix=".yaml") as tmp:
        yaml.dump(assump, tmp)
        tmp.flush()
        cfg_il = load_config(Path(tmp.name))

    assert cfg_il.panel.width_m == 215.0
    assert cfg_il.panel.depth_m == 220.0
    assert cfg_il.knothe.subsidence_factor == 0.65


def test_g00_mine_yaml_matches_fit_record():
    """The pinned Knothe values in the mine file are the ones the fit record reports."""
    cfg = load_config(Path("config/assumptions.yaml"))
    fit = json.loads(Path("data/fitted/adriyala_lw1_params.json").read_text())["params"]
    assert cfg.knothe.subsidence_factor == fit["subsidence_factor"]
    assert cfg.knothe.tan_beta == fit["tan_beta"]
    assert cfg.knothe.time_coefficient == fit["time_coefficient_per_day"]
    assert cfg.panel.inflection_offset_m == fit["inflection_offset_m"]
    assert cfg.survey_origin_offset_m == fit["survey_origin_offset_m"]
    assert cfg.survey_line_x_m == fit["survey_line_x_m"]
