"""Pytest configuration and shared fixtures for minesim."""

import sys
from pathlib import Path
import pytest

# Ensure src is in python path
src_dir = Path(__file__).resolve().parent.parent / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

mine_sim_dir = Path(__file__).resolve().parent.parent
if str(mine_sim_dir) not in sys.path:
    sys.path.insert(0, str(mine_sim_dir))


# --------------------------------------------------------------------------- F4: v1 layout for v1 tests
import contextlib
import dataclasses


@contextlib.contextmanager
def _v1_layout(module):
    """Every config loaded inside gets layout.source = v1 (the travelling cross). Assertions are untouched."""
    import minesim.config
    import tests.helpers
    real = minesim.config.load_config

    def load_v1(path=Path("config/assumptions.yaml")):
        cfg = real(path)
        return dataclasses.replace(cfg, layout=dataclasses.replace(cfg.layout, source="v1"))

    with pytest.MonkeyPatch.context() as mp:
        for mod in (minesim.config, tests.helpers, module):
            if getattr(mod, "load_config", None) is real:
                mp.setattr(mod, "load_config", load_v1)
        yield


@pytest.fixture(scope="module")
def layout_v1(request):
    """Module-wide: tests written for the v1 node counts / travelling cross (F4)."""
    with _v1_layout(request.module):
        yield


@pytest.fixture
def layout_v1_test(request):
    """One test only: written for the v1 node counts / travelling cross (F4)."""
    with _v1_layout(request.module):
        yield
