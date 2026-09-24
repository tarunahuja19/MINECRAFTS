"""Scenario Lab (WP9) — "what if" events on a frozen copy of a finished run.

Boundary (WP9 §1, contract §7.4 "there is no click-to-subside"): this package reads a finished run's
artefacts read-only, builds a frozen snapshot in memory, computes the scenario on that copy, and writes
only under scenario-lab/store/. It never imports minesim.world or minesim.stream, never writes under
mine-sim/ or handoff/, and makes no network calls. The main run and /ws/run are untouched.
"""

from lab.config import LabConfig, load_lab_config, load_event_spec
from lab.fields import Fields, derive_fields
from lab.snapshot import Grid, Snapshot, load_snapshot
from lab.events.base import EventResult, EVENTS, register, taper

__all__ = [
    "LabConfig", "load_lab_config", "load_event_spec",
    "Fields", "derive_fields",
    "Grid", "Snapshot", "load_snapshot",
    "EventResult", "EVENTS", "register", "taper",
]
