"""Event registry. Importing this package registers every built event in lab.events.base.EVENTS."""

from lab.events.base import EventResult, EVENTS, register, taper
from lab.events import sudden_sinking as _sudden_sinking   # noqa: F401  (registers "sudden_sinking")
from lab.events import edge_collapse as _edge_collapse     # noqa: F401  (registers "edge_collapse")
from lab.events import crack as _crack                     # noqa: F401  (registers "crack")

__all__ = ["EventResult", "EVENTS", "register", "taper"]
