---
title: "Changelog: Real-Terrain 3D Renderer and Node Planner v2 by Claude Code"
slug: 2026-09-15-claude-code-real-terrain-renderer-node-planner
type: changelog
module: integration
status: draft
tags: [changelog, audit-trail, renderer, terrain, dem, placement, node-planner]
created: 2026-09-15
updated: 2026-09-15
author: claude-code
last_agent_edit: claude-code
source_file: project-updates/2026-09-15.md
---

# Changelog: Real-Terrain 3D Renderer and Node Planner v2 by Claude Code

## Agent: Claude Code
## Date: 2026-09-15
## Source: Adarsh — the simulation works on the mine data but the terrain and design are "very very bad"; study the old `sih26/simulation` terrain/3D style and the old node-placement algorithm, rebuild Window 1 on our data, then plan the nodes over the terrain. Adarsh explicitly asked Claude to build it.

### Files updated (vault)
- `work-packages/WP8-consequence-renderer.md` — dated update line: Window 1 rebuilt on real terrain, T4 fix prompt superseded pending Adarsh's review. → [[work-packages/WP8-consequence-renderer]]

### Outside the vault
- **Real terrain:** `mine-sim/scripts/fetch_dem.py` (new) + `mine-sim/data/real/adriyala_lw1_dem.npz` (AWS Terrain Tiles, SRTM-derived, georeferenced per sample). The old sandbox DEM tile was **misplaced by ~2.2 km** (it assumed the site at the tile centre; the site is at pixel 46, 4) and is not used.
- **Node planner v2:** `mine-sim/src/minesim/placement.py` (new) + `tests/unit/test_placement.py` (9 tests). Strain natural breaks → tiers; weighted Poisson-disc (not a grid); no node on DEM slope > 20°; anchors = ceil(scouts / (cap − 1)) by capacitated k-means; gateway on never-moving ground with terrain Fresnel line of sight. `sizing.py` (v1, used by the sensor run) unchanged.
- **Config:** `config/mines/adriyala_lw1.yaml` new `site:` block (lat/lon OPEN — VERIFY); `config/assumptions.yaml` new `placement:` block.
- **Renderer:** `renderer/index.html`, `js/ramps.js`, `js/terrain.js`, `js/network.js`, `js/app.js` rewritten/new; `export_scene.py` adds `terrain`, `geometry`, `plan`, per-frame `plan_dz_mm` (existing keys unchanged); 2 new exporter tests. `run-all.sh` plans the network before exporting.

### Decisions needed (not ratified)
- Replace the Antigravity T4 fix prompt with this renderer?
- Promote placement v2 into the sensor run (`size_network`) — changes `nodes.csv` from 25 to ~270 nodes in the survey sector.
- Real panel lat/lon and advance bearing (currently the old sandbox's approximate site, east-going).

### Verification
mine-sim **138 passed** (129 + 9); renderer tests 8 passed; vault 0 broken / 0 orphans / 0 frontmatter. Planner on Adriyala: 237 scouts (34 1A / 164 1B / 39 1C), 34 anchors, 1 gateway, ₹5.71 lakh; min scout spacing 20.0 m, max 8 children, 191 steep moving cells excluded, 220/237 scout and 28/34 backbone links terrain-clear. Anchor #2 live ΔZ from the world grid (−1,080 mm) equals its planned peak S from physics (1,080 mm) — terrain, plan and grid aligned.
