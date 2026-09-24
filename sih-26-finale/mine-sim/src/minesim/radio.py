"""LoRa TDMA mesh simulation - WP5 (v1 cut).

One superframe per simulated epoch. Each Scout sends one 23 B uplink in its own TDMA slot.
Delivery = link-margin check (free-space path loss) AND a Bernoulli survival draw.
A Scout whose packet is lost retries once in the emergency window to its backup Anchor,
in the sub-slot given by its child_index (never node_id arithmetic, G10).
Dedup key is (node_id, epoch), never seq (G7).

v1 cut: no anchor death / bundle forwarding / bitmap contents; Anchor->Gateway assumed delivered.
"""

from dataclasses import dataclass
import math
import struct
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from minesim.config import Config
from minesim.packet import Packet, airtime_ms
from minesim.sensors import Reading
from minesim.sizing import Layout, Node

# Superframe schedule, contract §6 (seconds from superframe start)
UPLINK_WINDOW_OPEN_S = 2.0
UPLINK_WINDOW_CLOSE_S = 11.5
SLOT_GUARD_S = 0.030
EMERGENCY_WINDOW_OPEN_S = 15.5
EMERGENCY_WINDOW_LENGTH_S = 1.0

SCOUT_UPLINK_BYTES = 23       # contract §6
ANCHOR_BUNDLE_BYTES = 98      # contract §6: 6 x 15 B children + 8 B header
BITMAP_ACK_BYTES = 6          # contract §6
BEACON_BYTES = 12             # gives the contract's 82.4 ms gateway beacon at SF8
SPEED_OF_LIGHT_M_S = 299_792_458.0
FSPL_CONSTANT_DB = 32.44      # free-space path loss with d in km and f in MHz

# Scout uplink payload (23 B): node_id, epoch, seq, subsidence 0.1 mm, tilt x/y urad,
# strain ustrain, displacement 0.1 mm, battery mV, flags
PAYLOAD_FORMAT = ">HIHihhhhHB"
MISSING_I16 = -32768
MISSING_I32 = -(2 ** 31)
TENTHS = 10.0


@dataclass(frozen=True)
class TxRecord:
    packet: Packet
    t_s: float
    slot_index: int
    parent_used: int           # anchor node_id that actually received it
    rssi_dbm: float
    delivered: bool
    airtime_ms: float
    via_emergency: bool


def dedup_key(record: TxRecord) -> Tuple[int, int]:
    """The only dedup key: (node_id, epoch). seq resets on reboot and is never used."""
    return (record.packet.node_id, record.packet.epoch)


def deduplicate(records: Iterable[TxRecord]) -> List[TxRecord]:
    """Keep the first delivered record per (node_id, epoch)."""
    seen: Dict[Tuple[int, int], TxRecord] = {}
    for rec in records:
        if rec.delivered and dedup_key(rec) not in seen:
            seen[dedup_key(rec)] = rec
    return list(seen.values())


def emergency_subslot(node: Node) -> int:
    """Emergency sub-slot is the node's child_index (G10)."""
    return node.child_index


def _clamp_int(value: float, bits: int) -> int:
    hi = 2 ** (bits - 1) - 1
    return max(-hi, min(hi, int(round(value))))


def encode_payload(reading: Reading, seq: int) -> bytes:
    def i16(v, scale=1.0):
        return MISSING_I16 if v is None else _clamp_int(v.magnitude * scale, 16)
    payload = struct.pack(
        PAYLOAD_FORMAT,
        reading.node_id, reading.epoch, seq,
        _clamp_int(reading.subsidence.magnitude * TENTHS, 32),
        i16(reading.tilt_x), i16(reading.tilt_y), i16(reading.strain), i16(reading.displacement, TENTHS),
        max(0, min(2 ** 16 - 1, int(round(reading.battery_mv.magnitude)))),
        0,
    )
    return payload


class Superframe:
    def __init__(self, cfg: Config, layout: Layout) -> None:
        self._cfg = cfg
        self._nodes: Dict[int, Node] = {n.node_id: n for n in layout.nodes}
        self._scouts = [n for n in layout.nodes if n.tier in ("1A", "1B", "1C")]
        r = cfg.radio
        self._uplink_ms = airtime_ms(SCOUT_UPLINK_BYTES, r.scout_sf, r)
        slot_s = self._uplink_ms / 1000.0 + SLOT_GUARD_S
        # Slot order = position in the layout, spread over the local channels.
        self._slot: Dict[int, Tuple[int, int, float]] = {}
        for k, node in enumerate(self._scouts):
            slot_index = k // r.local_channels
            channel = k % r.local_channels
            self._slot[node.node_id] = (slot_index, channel, UPLINK_WINDOW_OPEN_S + slot_index * slot_s)
        self._seq: Dict[int, int] = {n.node_id: 0 for n in self._scouts}
        self._wavelength_m = SPEED_OF_LIGHT_M_S / (r.frequency_mhz * 1e6)

    def slot_of(self, node_id: int) -> Tuple[int, int, float]:
        """(slot_index, channel, start offset in s) for a Scout."""
        return self._slot[node_id]

    def reboot(self, node_id: int) -> None:
        """A rebooted node restarts its sequence counter (why seq is never a key)."""
        self._seq[node_id] = 0

    def link_rssi_dbm(self, a: Node, b: Node) -> float:
        r = self._cfg.radio
        dh = r.antenna_height_m.get(a.tier if a.tier in r.antenna_height_m else "scout", 0.0) - \
            r.antenna_height_m.get(b.tier if b.tier in r.antenna_height_m else "scout", 0.0)
        d_m = max(math.hypot(math.hypot(a.x_m - b.x_m, a.y_m - b.y_m), dh), self._wavelength_m)
        fspl = 20.0 * math.log10(d_m / 1000.0) + 20.0 * math.log10(r.frequency_mhz) + FSPL_CONSTANT_DB
        return r.tx_power_dbm - fspl

    def _attempt(self, node: Node, parent_id: int, rng: Any) -> Tuple[bool, float]:
        r = self._cfg.radio
        rssi = self.link_rssi_dbm(node, self._nodes[parent_id])
        link_ok = rssi - r.sensitivity_dbm[r.scout_sf] >= r.link_margin_db_min
        survived = rng.random() >= r.bernoulli_loss_prob
        return link_ok and survived, rssi

    def run(self, readings: Sequence[Reading], epoch: int, rng: Any) -> List[TxRecord]:
        records: List[TxRecord] = []
        for reading in readings:
            node = self._nodes[reading.node_id]
            slot_index, channel, offset_s = self._slot[node.node_id]
            self._seq[node.node_id] += 1
            packet = Packet(node.node_id, epoch, self._seq[node.node_id],
                            encode_payload(reading, self._seq[node.node_id]),
                            self._cfg.radio.scout_sf, channel)
            delivered, rssi = self._attempt(node, node.parent_id, rng)
            parent_used, via_emergency, t_s = node.parent_id, False, reading.t_s + offset_s
            if not delivered and node.backup_parent_id is not None:
                delivered, rssi = self._attempt(node, node.backup_parent_id, rng)
                parent_used, via_emergency = node.backup_parent_id, True
                slot_s = EMERGENCY_WINDOW_LENGTH_S / self._cfg.layout.max_children_per_anchor
                t_s = reading.t_s + EMERGENCY_WINDOW_OPEN_S + emergency_subslot(node) * slot_s
            records.append(TxRecord(packet, t_s, slot_index, parent_used, rssi, delivered,
                                    self._uplink_ms, via_emergency))
        return records

    def duty_cycle(self, tier: str) -> float:
        """Fraction of the superframe period spent transmitting, 0..1."""
        r = self._cfg.radio
        if tier in ("1A", "1B", "1C", "scout"):
            tx_ms = self._uplink_ms
        elif tier == "anchor":
            tx_ms = airtime_ms(BITMAP_ACK_BYTES, r.scout_sf, r) + airtime_ms(ANCHOR_BUNDLE_BYTES, r.anchor_sf, r)
        elif tier == "gateway":
            tx_ms = airtime_ms(BEACON_BYTES, r.anchor_sf, r)
        else:
            raise ValueError(f"unknown tier {tier!r}")
        return tx_ms / 1000.0 / r.superframe_period_s
