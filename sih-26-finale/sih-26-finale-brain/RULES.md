# RULES.md — SIH 26 Finale Brain Repository Governance

**Status:** Binding. Every AI agent (Claude Code, Antigravity, or other) and human contributor acting on behalf of the SIH team MUST read this file in full before making any change to this repository. If any instruction here conflicts with a convenience shortcut, this file wins.

**Purpose:** `sih-26-finale-brain` is the single authoritative source of truth for the **SIH 2025/26 Mine Subsidence Early-Warning Simulator (Part 1 Finale Build)**. It houses the complete system architecture, frozen interface contracts, four-lane work distributions, sixteen verification gates, empirical data-pinning records, and component technical specifications.

**Vault Isolation Guarantee:** This vault is completely autonomous and self-contained. Under NO circumstances should internal links depend on files outside this vault.

---

## 0. Prime Directives

1. **Deterministic Pathing:** Every entity has a fixed destination based on its type and lane. If a rule specifies where something belongs, place it there. Never improvise alternate locations.
2. **Idempotency:** Re-ingesting specification dumps or re-running synchronization must never produce duplicate notes, duplicate links, or corrupted graph nodes. Always check for existing notes before creation (§4.3).
3. **Preserve Content:** Never delete another member's or agent's content. Restructure, merge, or supersede, but original claims must survive (§6). If something is outdated or contradicted, mark it `status: superseded` with a pointer to the new note.
4. **Leave an Audit Trail:** Every modification must be logged in `/changelog/` with author/agent, date, source file, and impact. No silent edits (§7).
5. **Quarantine When Uncertain:** If you cannot confidently classify or place content, route it to `/inbox/_unsorted/` with a note explaining why, rather than forcing it into a wrong location (§5).
6. **Contracts Win Over Prose Everywhere:** `11-interface-contracts-v1.md` (ingested as `[[docs/interface-contracts]]`) is authoritative. If any work package or prose note contradicts a contract signature or schema, the contract wins.

---

## 1. Vault Directory Structure (fixed — do not deviate)

```
/RULES.md                                   ← This governance specification.
/glossary.md                                ← Canonical terms, physical constants, units, test gates.
/inbox/
    _unsorted/                              ← Quarantine zone for unclassified dumps (§5).
/changelog/
    YYYY-MM-DD-<author>-<desc>.md           ← Ingestion and update audit trail (§7).
/docs/
    start-here.md                           ← Master start guide & order of operations.
    build-order.md                          ← Build order, lanes A/B/C/D, 10-day schedule.
    interface-contracts.md                  ← Frozen signatures, dataclasses, wire layouts.
    agents-invariants.md                    ← AGENTS.md charter, eight invariants, traps.
    assumption-register.md                  ← A1–A22 traceability and status register.
    gates-registry.md                       ← Master test gates G00–G15 index.
/work-packages/
    WPC-contracts-and-skeleton.md           ← D0 scaffolding and stubs.
    WP0-data-pinning.md                     ← Field data fitting and parameter repinning.
    WP1-core-physics.md                     ← Single S(x,y,t) implementation and derivatives.
    WP2-sizing-algorithm.md                 ← Dynamic network layout, costing, relaxation.
    WP3-world-state-engine.md               ← int32 mm grid, live Z, exact replay.
    WP4-sensor-models-provenance.md         ← Sensor tiers 1A/1B/1C and provenance tagging.
    WP5-radio-tdma.md                       ← 60s LoRa TDMA superframe, airtime, failover.
    WP6-stream-and-output.md                ← nodes.csv, terrain state, WebSocket stream.
    WP7-gate-harness.md                     ← Sixteen gates and D7 integration run.
/gates/
    G00-data-pinning.md ... G15-config-driven-mine-independence.md  ← Granular gate specifications.
/notes/
    physics/                                ← Knothe models, closed-form erf, derivatives.
    mesh-and-radio/                         ← TDMA scheduling, LoRa link budget, airtimes.
    world-state/                            ← Integer mm math, live node Z, delta scrubbing.
    sensors/                                ← Sensor noise pipelines, MEMS drift, provenance.
    safety-and-governance/                  ← Invariant 2 & 3 rationale, 4-lane parallel rules.
/projects/
    subsidence-simulator/
        overview.md                         ← Project charter, milestones, handoff criteria.
        decisions.md                        ← Locked decisions and open decisions register.
        artifacts/                          ← Datasets, plots, diagrams, reference papers.
/people/
    <member-or-agent-slug>.md               ← Focus areas, lane ownership, active gates.
```

- **Slugs are `kebab-case`.** No spaces, capitals, or underscores in filenames.
- **A note belongs to exactly one canonical location.** Cross-topic relevance is expressed through Obsidian wikilinks, never by duplication.

---

## 2. Note Format (Mandatory Frontmatter)

Every markdown note in the vault MUST begin with YAML frontmatter adhering to this schema:

```yaml
---
title: <Human-Readable Title>
slug: <kebab-case-slug matching filename without extension>
type: doc | work-package | gate | concept | person | project | changelog | glossary
module: physics | sizing | world-state | sensors | radio | stream | governance | integration
status: draft | reviewed | stale | superseded
tags: [tag-one, tag-two]
created: YYYY-MM-DD
updated: YYYY-MM-DD
author: <member-or-agent-name>
last_agent_edit: <member-or-agent-name>
source_file: <path or filename from which this note originated>
supersedes: []                             # Optional: list of slugs replaced by this note
---
```

- **`status` is actively maintained.** Initial notes default to `reviewed` if direct from frozen specs.
- Headings in the body must start at `##` (the frontmatter `title` represents the `#` title).

---

## 3. Linking Rules (Obsidian-Compatible Graph)

- **Obsidian Wikilinks Only:** All internal references use `[[note-slug]]` or `[[path/note-slug|Display Label]]` syntax. Never use raw relative markdown links (`[text](../file.md)`) for internal vault notes.
- **Zero Orphan Notes:** Every note must link to at least one parent overview, related work package, or person note.
- **Zero Dangling Links:** Do not link to a note that does not exist. If linking to a future concept, create a stub note with `status: draft` and `tags: [stub]`.
- **Tag Standardization:** Every tag in frontmatter must be drawn from or added to `/glossary.md`.

---

## 4. Four-Lane Development Invariants

The simulator build divides across four parallel lanes with strict boundaries:

1. **Lane A (WP0):** Adarsh + Claude Chat — pure empirical data pinning from real mine surveys (`10.18311/jmmf/2022/32099`).
2. **Lane B (WP1, WP2, WP7):** Claude Code — core physics `S(x,y,t)`, network sizing, and gate test harness.
3. **Lane C (WP3, WP4):** Antigravity — integer-millimetre world-state engine and sensor models with provenance.
4. **Lane D (WP5, WP6):** Antigravity — LoRa TDMA radio network simulation and streaming output layer.

### Invariant Rules:
- **Stay in your package:** Never edit files owned by another package.
- **Contracts are frozen:** Any change to `[[docs/interface-contracts]]` requires team consensus.
- **No neural network in the safety path:** The classical Knothe-fit detector is the only thing that raises an alarm. No PINN exists in this build.
- **One implementation of `S(x,y,t)`:** Exactly one implementation in `src/minesim/physics.py`. All derivatives are numerical.
- **Integer millimetres for terrain:** Accumulated by integer addition to ensure bit-identical replay (G6).
- **Node count is an output, never an input:** `size_network(cfg)` accepts only `Config`.
- **Three provenance tags only:** `real`, `pinned`, or `synthetic`. No `unknown`.

---

## 5. The Unsorted Inbox (`/inbox/_unsorted/`)

Items that cannot be categorized immediately must be placed in `/inbox/_unsorted/<timestamp>-<member>-raw.md` with:
- Raw content preserved as-is.
- A paragraph explaining why classification was ambiguous.
- `needs_human_review: true` in frontmatter.

---

## 6. Merge & Conflict Rules

- **Never overwrite another author's section:** Append a new `##` section credited with author and date.
- **Contradictions:** If new empirical data contradicts existing notes, add a section `## Conflicting finding (<author>, <date>)` and set `status: draft` to trigger review.
- **Superseding:** If a new note replaces an older note, mark the older note `status: superseded` with `supersedes: [older-slug]` on the new note and a prominent callout pointer on the old note.

---

## 7. Changelog Protocol (Mandatory on Every Update)

Every modification session creates or appends to a changelog entry:
`/changelog/YYYY-MM-DD-<author>-<short-desc>.md`

```markdown
## Agent: <member-or-agent-name>
## Date: YYYY-MM-DD
## Source: <Source documents or prompt trigger>

### Files created
- path — reason

### Files updated
- path — reason

### Decisions Ratified
- decision summary
```

Latest entry: [[changelog/2026-09-13-adarsh-finale-brain-initialization|2026-09-13 Initialization Log]].

---

## 8. Absolute Prohibitions

An agent MUST NOT:
- Delete or overwrite notes without preserving content or applying the supersede workflow.
- Introduce relative markdown links (`../file.md`) instead of Obsidian wikilinks.
- Introduce hardcoded physical constants in `src/` (violates G15).
- Place neural networks or PINNs into the simulation or safety alarm path (violates G14).
- Omit frontmatter on any note.
- Skip logging in `/changelog/`.
