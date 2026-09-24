# Step 05 — WP5 radio, v1 cut (BUILD-PLAN M2 Part A)

| | |
|---|---|
| **Built by** | Claude Code (at Adarsh's request, 14 Sep) |
| **Files** | `mine-sim/src/minesim/packet.py` (`airtime_ms`), `mine-sim/src/minesim/radio.py`, `mine-sim/tests/unit/test_radio.py`, `mine-sim/tests/gates/test_g07.py` |
| **Contract** | §6 `Packet`, `TxRecord`, `Superframe(cfg, layout)`, `.run(readings, epoch, rng)`, `.duty_cycle(tier)` unchanged. Additive: `slot_of`, `reboot`, `link_rssi_dbm`; module functions `dedup_key`, `deduplicate`, `emergency_subslot` |
| **Tests** | `21 passed` (see `test_results.txt`) |

## Behaviour

- **Airtime:** Semtech SX127x formula from `cfg.radio` (BW, CR, preamble, header, CRC, low-data-rate rule), never a lookup table.
- **One superframe per simulated epoch** (hourly rows in nodes.csv, a 60 s frame schedule inside it).
- **Slots:** Scouts in layout order, `slot_index = k // local_channels`, `channel = k % local_channels`, start = 2.0 s + slot × (61.7 ms + 30 ms guard). 33 Scouts finish by **2.80 s** (window closes 11.5 s). Uses list position, never `node_id`.
- **Payload:** 23 B `>HIHihhhhHB` = node_id, epoch, seq, subsidence (0.1 mm), tilt x/y (µrad), strain (µε), displacement (0.1 mm), battery (mV), flags; missing fields = −32768.
- **Delivery:** RSSI = tx power − free-space path loss (3D distance with antenna heights, floored at one wavelength). Delivered if margin over SF sensitivity ≥ `link_margin_db_min` **and** a Bernoulli draw survives `bernoulli_loss_prob`.
- **Retry:** a lost packet retries once to `backup_parent_id` in the emergency window at 15.5 s + `child_index` × (1.0 s / 8), `via_emergency = true`. Every Scout gets exactly one `TxRecord` per epoch, delivered or not (`parent_used` = the last parent tried).
- **Dedup:** `(node_id, epoch)`. `reboot()` resets `seq`.

## Results

| | Value | Contract |
|---|---|---|
| Scout duty | 0.103% | 0.10% |
| Anchor duty (6 B ACK SF7 + 98 B bundle SF8) | 0.556% | 0.56% |
| Gateway duty (12 B beacon SF8) | 0.137% | 0.14% |
| RSSI range at 50 m layout | −62 to −8 dBm (all links far above sensitivity) | 74–86 dB margin claim |
| Primary loss over 200 frames | ≈ `bernoulli_loss_prob` (0.02) ± 0.01 | — |

**Contract table discrepancy:** the formula reproduces 10 of 12 airtime cells within 0.1 ms, but **6 B at SF8 = 62.0 ms (table 65.9)** and **6 B at SF9 = 123.9 ms (table 118.6)**. The same formula gives 61.7 / 297.5 / 36.1 exactly, so those two cells look like arithmetic errors in the table. Neither is used by the SF7-ACK / SF8-bundle schedule. They are not asserted. Raise with the hardware pair if they quote them.

## Gates

- **G07:** AST scan of `radio.py`, `packet.py`, `stream.py` for `seq` in dict keys, sets, subscripts, comparisons or a dedup function. Negative cases detected. Runtime: after `reboot()` two packets share `seq = 1` and both survive dedup; the same record twice dedups to one.
- G08–G11: v3. `emergency_subslot` is already `child_index` only.

## v1 cut / not built

Anchor death and failover of a whole cluster, bitmap ACK contents, Anchor → Gateway bundle loss, receive-duty accounting (G9), Fresnel clearance. Co-located Anchor/Scout pairs saturate at −8 dBm because distance is floored at one wavelength; harmless for delivery.
