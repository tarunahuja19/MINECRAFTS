"""Unit tests for the M1 Part A config additions (sensors block, radio link keys)."""

import tempfile
from pathlib import Path

import pytest
import yaml

from minesim.config import load_config
from minesim.errors import UnpinnedParameterError

ASSUMPTIONS = Path("config/assumptions.yaml")


def _load_with(mutate):
    """Copy the real config to a temp dir, apply `mutate(assumptions_dict)`, load it."""
    data = yaml.safe_load(ASSUMPTIONS.read_text())
    mine = yaml.safe_load(Path(f"config/mines/{data['mine']}.yaml").read_text())
    mutate(data)
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "config" / "mines").mkdir(parents=True)
        (root / "config" / "mines" / f"{data['mine']}.yaml").write_text(yaml.dump(mine))
        path = root / "config" / "assumptions.yaml"
        path.write_text(yaml.dump(data))
        return load_config(path)


def test_sensors_block_loads():
    cfg = load_config(ASSUMPTIONS)
    s = cfg.sensors
    for model in (s.subsidence, s.tilt_1a, s.strain_1b, s.displacement_1b, s.strain_1c):
        assert model.resolution > 0.0
        assert model.noise_sigma >= 0.0
    assert s.battery.full_mv > s.battery.empty_mv
    assert s.temperature_period_days > 0.0
    assert s.monument_position_tolerance_m > 0.0


def test_radio_link_keys_load():
    cfg = load_config(ASSUMPTIONS)
    r = cfg.radio
    assert r.frequency_mhz > 0.0
    assert r.scout_sf in r.sensitivity_dbm and r.anchor_sf in r.sensitivity_dbm
    assert 0.0 <= r.bernoulli_loss_prob < 1.0
    assert r.link_margin_db_min >= 0.0


def test_existing_fields_unchanged():
    cfg = load_config(ASSUMPTIONS)
    assert cfg.layout.spacing_m == 50.0
    assert cfg.radio.scout_sf == 7 and cfg.radio.anchor_sf == 8
    assert cfg.sim.timestep_s == 3600.0
    assert cfg.profiles_csv.is_file()


@pytest.mark.parametrize("mutate", [
    lambda d: d["sensors"]["tier_1a"]["tilt"].__setitem__("noise_sigma", None),
    lambda d: d["sensors"]["tier_1b"].__setitem__("displacement", None),
    lambda d: d["sensors"].__setitem__("temperature_amplitude_c", None),
    lambda d: d["sensors"]["battery"].__setitem__("full_mv", None),
    lambda d: d["radio"].__setitem__("tx_power_dbm", None),
    lambda d: d["radio"]["sensitivity_dbm"].__setitem__(7, None),
    lambda d: d["radio"].__setitem__("bernoulli_loss_prob", None),
    lambda d: d.__setitem__("sensors", None),
])
def test_null_raises_unpinned(mutate):
    with pytest.raises(UnpinnedParameterError):
        _load_with(mutate)
