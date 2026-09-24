"""LoRa packet definition and airtime - WP5."""

from dataclasses import dataclass
import math

from minesim.config import RadioConfig

KHZ = 1000.0
LOW_DATA_RATE_SYMBOL_S = 0.016   # Semtech: low data rate optimisation is mandatory above 16 ms/symbol
PREAMBLE_SYNC_SYMBOLS = 4.25     # Semtech: sync word + SFD added to the programmed preamble
HEADER_SYMBOLS_FIXED = 8         # Semtech: payload symbol count starts at 8
PAYLOAD_BITS_OFFSET = 28         # Semtech formula constant
CRC_BITS = 16
HEADER_BITS = 20
CR_BASE = 4


@dataclass(frozen=True)
class Packet:
    node_id: int
    epoch: int                 # monotonic, survives reboot
    seq: int                   # diagnostic ONLY. Never a dedup key (G7)
    payload: bytes             # 23 B scout uplink
    sf: int
    channel: int


def airtime_ms(payload_bytes: int, sf: int, radio: RadioConfig) -> float:
    """LoRa time-on-air in ms from the Semtech SX127x formula (asserted against contract §6)."""
    bandwidth_hz = radio.bandwidth_khz * KHZ
    symbol_s = (2 ** sf) / bandwidth_hz
    low_dr = 1 if symbol_s > LOW_DATA_RATE_SYMBOL_S else 0
    implicit = 0 if radio.explicit_header else 1
    crc = 1 if radio.crc else 0
    cr = int(radio.coding_rate.split("/")[1]) - CR_BASE
    numerator = 8 * payload_bytes - 4 * sf + PAYLOAD_BITS_OFFSET + CRC_BITS * crc - HEADER_BITS * implicit
    payload_symbols = HEADER_SYMBOLS_FIXED + max(
        math.ceil(numerator / (4 * (sf - 2 * low_dr))) * (cr + CR_BASE), 0
    )
    preamble_s = (radio.preamble_symbols + PREAMBLE_SYNC_SYMBOLS) * symbol_s
    return (preamble_s + payload_symbols * symbol_s) * 1000.0
