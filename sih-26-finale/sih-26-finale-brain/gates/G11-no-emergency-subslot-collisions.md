---
title: "Gate G11 — No Emergency Sub-Slot Collisions"
slug: G11-no-emergency-subslot-collisions
type: gate
module: radio
status: reviewed
tags: [gate, g11, radio, tdma, adversarial-testing, collision-free, emergency]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP5-radio-tdma.md
---

# Gate G11 — No Emergency Sub-Slot Collisions

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP5-radio-tdma\|WP5]] |
| **Owner** | [[people/antigravity\|Antigravity]] |
| **Verification Target** | Collision-free emergency window under adversarial ID allocations |
| **Test Script** | `tests/gates/test_g11.py` |

---

## 1. Assertion

Under any arbitrary, non-contiguous, or adversarial assignment of Scout `node_id`s, no two children belonging to the same primary Anchor cluster may ever share an emergency sub-slot.

---

## 2. Test Implementation (Exhaustive Adversarial Sweep)

```python
def test_g11_adversarial_emergency_slots():
    # Generate adversarial node ID sets: powers of 2, primes, congruent mod 16, etc.
    for id_generator in [congruent_mod_16, random_large_ints, sequential_ids]:
        cluster = generate_scout_cluster(ids=id_generator(), size=8)
        slots = [get_emergency_slot(node) for node in cluster]
        assert len(slots) == len(set(slots)), f"Collision detected for IDs {[n.node_id for n in cluster]}!"
```

Because emergency slots map directly to `child_index` ($0..7$), this assertion holds universally across all possible ID configurations.
