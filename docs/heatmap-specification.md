# Heatmap Specification — Adriyala Subsidence Monitoring System

> Comprehensive catalogue of 2D and 3D heatmap layers for the Adriyala coal mine
> subsidence monitoring dashboard. Each entry specifies the data source, colour
> ramp, rendering technique, and visual encoding for both the Three.js 3D
> viewport (160x160 vertex grid, @react-three/fiber) and the Leaflet/MapLibre 2D
> map view.

---

## Table of Contents

1. [Geomechanical Heatmaps](#1-geomechanical-heatmaps)
2. [Structural Integrity Heatmaps](#2-structural-integrity-heatmaps)
3. [Seismic & Vibration Heatmaps](#3-seismic--vibration-heatmaps)
4. [Network Health Heatmaps](#4-network-health-heatmaps)
5. [Environmental & Hardware Heatmaps](#5-environmental--hardware-heatmaps)
6. [Temporal & Analytical Heatmaps](#6-temporal--analytical-heatmaps)
7. [Composite / Multi-Layer Heatmaps](#7-composite--multi-layer-heatmaps)
8. [Colour Ramp Reference](#8-colour-ramp-reference)

---

## 1. Geomechanical Heatmaps

### 1.1 Subsidence Depth (Primary)

| Property | Value |
|----------|-------|
| **Source** | `evaluatePoint(x, y, z0, t).dropDistanceM` per grid vertex |
| **Range** | 0 m → `CUMULATIVE_DEPTH_MAX_M` (50.0 m) |
| **Ramp** | `DEPTH_STOPS` — blue `#0093dc` → violet `#6c2dff` → red `#690003` (L* 58→20, descending) |

**3D View** — Already implemented in `TerrainMesh.tsx`. Vertex colours on the
160x160 mesh are blended from the hypsometric height ramp to the depth ramp
as the bowl forms. Excavation shadow (`SUBSIDENCE_SHADOW = 0.22`) ensures
perceptual monotonicity at the ramp entry. Contour rings at 5 m intervals
mark iso-depth lines.

**2D View** — Rasterised heatmap tile layer. Compute `S(x,y,t)` on a 200x100
grid (3.75 m spacing matching the monitoring rectangle 750x350 m). Render
as a `<canvas>` overlay with the same `DEPTH_STOPS` ramp, alpha-masked
below `SUBSIDENCE_EPS_M = 0.002 m`. Overlay iso-depth contour polylines
(GeoJSON) at 1, 2, 5, 10, 20, 30, 40, 50 m using Leaflet `L.polyline` with
dashed stroke.

---

### 1.2 Tilt Magnitude

| Property | Value |
|----------|-------|
| **Source** | `evaluatePoint().tiltMmPerM` or per-node `tilt_x, tilt_y` → `√(tilt_x² + tilt_y²)` |
| **Range** | 0 → 15 mm/m (DGMS concern threshold ~3 mm/m marked) |
| **Ramp** | White → Amber → Crimson (sequential, single-hue warm) |

**3D View** — Vertex colour overlay on the terrain mesh, replacing the depth
ramp when this layer is active. Tilt is the first spatial derivative of
subsidence — peaks at the inflection ring (r ≈ R_INFL = 197 m from bowl
centre). Render as a ring-shaped heat band around each perturbation bowl.
Add animated arrow glyphs at node positions pointing in the direction of
steepest descent (atan2 of tilt_y, tilt_x), length proportional to
magnitude.

**2D View** — Interpolated raster (IDW or Kriging from 31 node readings).
White-to-crimson fill with the DGMS 3 mm/m threshold shown as a bold orange
isoline. Node markers show small arrow icons indicating tilt direction and
magnitude.

---

### 1.3 Tilt Direction (Vector Field)

| Property | Value |
|----------|-------|
| **Source** | `tilt_x`, `tilt_y` per node — direction = `atan2(tilt_y, tilt_x)` |
| **Encoding** | HSL hue wheel: 0° = East (red), 90° = North (green), 180° = West (cyan), 270° = South (blue) |

**3D View** — Flat-colour disc at each node position, hue-coded by tilt
direction. Cone arrow mesh (`@react-three/drei ConeGeometry`) pointing
downslope, height scaled by tilt magnitude. Creates a vector field
visualisation over the terrain surface.

**2D View** — Circular marker icons with directional wedge, hue-coded by
angle. Streamline polylines connecting sequential tilt vectors show
ground-flow direction — useful for identifying asymmetric subsidence bowls
and fault-influenced deformation.

---

### 1.4 Curvature

| Property | Value |
|----------|-------|
| **Source** | `evaluatePoint().curvaturePerM` (second derivative of S) |
| **Range** | –0.001 (sagging/convex) → 0 → +0.001 (hogging/concave) per m |
| **Ramp** | Diverging: Teal (sagging) → White (flat) → Magenta (hogging) |

**3D View** — Diverging vertex-colour overlay. Sagging (negative curvature,
bowl centre) in teal; hogging (positive curvature, bowl rim) in magenta;
neutral terrain white. This highlights the inflection ring where curvature
changes sign — the zone of maximum tensile strain and highest crack risk.

**2D View** — Diverging choropleth raster. Zero-curvature isoline drawn as a
thin dashed black line — this is the inflection boundary. Zones inside are
labelled "Sagging" and zones outside "Hogging" in map tooltips.

---

### 1.5 Tensile Strain

| Property | Value |
|----------|-------|
| **Source** | `evaluatePoint().tensileStrainMmPerM` or per-node `strain` (gauge reading, peak 12,649 με) |
| **Range** | 0 → 13 mm/m |
| **Ramp** | Green → Yellow → Red with a **DGMS limit line at 5.3 mm/m** (hard dashed boundary) |
| **Special** | Above 5.3 mm/m: pulsing red glow overlay (danger zone) |

**3D View** — Vertex colour overlay. Below 5.3 mm/m: green-to-yellow
gradient. Above 5.3 mm/m: yellow-to-red with a semi-transparent pulsing red
emissive plane at the DGMS threshold contour to draw attention to the
regulatory exceedance boundary. Crack line segments (`CrackLine[]`) rendered
as glowing red `THREE.Line2` on the terrain surface within the danger zone.

**2D View** — Interpolated raster with a distinct visual break at 5.3 mm/m:
hatched fill pattern overlaid above the threshold (cross-hatch SVG pattern
inside the polygon). The DGMS isoline itself drawn as a thick red dashed
polyline labelled "DGMS 5.3 mm/m Tensile Limit". Node strain gauges shown
as small bar-chart icons inside markers.

---

### 1.6 Surface Displacement Rate (dS/dt)

| Property | Value |
|----------|-------|
| **Source** | Time-derivative of `S(x,y,t)`: `dS/dt = S_final · c · e^(−c·t)`, c = 0.04/day |
| **Range** | 0 → ~0.2 m/day (maximum rate at t=0 for a 5 m event) |
| **Ramp** | Cool grey → Hot pink → White-hot (sequential luminance) |

**3D View** — Vertex colour overlay showing where the ground is currently
moving fastest. Recently triggered bowls glow white-hot at the centre;
older, settled bowls cool to grey. Animated downward-drifting particle
effect (`THREE.Points` with velocity shader) at high-rate vertices to give a
visual sense of sinking motion.

**2D View** — Rasterised heatmap with animated concentric pulse rings
(CSS `@keyframes`) expanding outward from the active bowl centre at the
current subsidence velocity. Rate values shown in tooltips as "mm/day".

---

## 2. Structural Integrity Heatmaps

### 2.1 Zone State (Categorical)

| Property | Value |
|----------|-------|
| **Source** | `ZoneTelemetry[].state`: STABLE / SETTLING / TENSION / CRITICAL / FAILED |
| **Encoding** | Discrete palette from `STATE_COLORS`: Emerald `#00CC44` / Sky `#7fa0b5` / Amber `#FFA500` / Red `#FF2222` / Orange-Red `#FF4400` |

**3D View** — Voronoi tessellation projected onto the terrain mesh. Each
node's influence zone drawn as a transparent coloured polygon draped over
the surface geometry (`THREE.ShapeGeometry` extruded along the mesh normal).
Borders between zones rendered as white wireframe edges. Nodes in CRITICAL
or FAILED state pulse their zone boundary with an emissive bloom.

**2D View** — Choropleth polygons (Voronoi or Delaunay from node positions)
with the same five-colour palette. Each polygon shows the zone's `eps`
(strain) and `kappa` (curvature) in a tooltip. An animated dashed border
around CRITICAL/FAILED zones draws the operator's eye. Filter toggles let
the operator show/hide stable zones to focus on active deformation.

---

### 2.2 Crack Density

| Property | Value |
|----------|-------|
| **Source** | `CrackLine[]` — count and total length of crack segments per grid cell |
| **Range** | 0 → N cracks per 25 m² cell |
| **Ramp** | Transparent → Coral → Dark Red (opacity-mapped) |

**3D View** — Grid the monitoring rectangle into 30x14 cells (25 m spacing).
Count crack segments intersecting each cell. Render as a semi-transparent
coloured plane at slight offset above the terrain, opacity proportional to
crack density. Individual `CrackLine` segments rendered below as glowing
fracture lines.

**2D View** — Grid-cell choropleth overlaid on the base map with the same
coral-to-dark-red ramp. Click a cell to expand a popup listing individual
crack widths, lengths, and detection timestamps. Total crack length per zone
shown in a small bar chart in the panel sidebar.

---

### 2.3 Crack Width

| Property | Value |
|----------|-------|
| **Source** | `CrackLine[].width_mm` — individual crack aperture |
| **Range** | 0.1 mm → 50 mm |
| **Ramp** | Thin yellow lines → Thick red lines (width-encoded + colour-encoded) |

**3D View** — Each crack segment rendered as a `THREE.Line2` with
`lineWidth` proportional to `width_mm` (scaled ×50 for visibility).
Colour transitions from yellow (<5 mm) through orange (5–15 mm) to red
(>15 mm). Newly detected cracks (`isNew = true`) flash white for 3 seconds.

**2D View** — Polyline features styled with Leaflet `weight` proportional to
crack width and colour from the same yellow–orange–red ramp. A legend at the
bottom shows the width↔colour↔thickness mapping with example widths.

---

### 2.4 Extensometer Displacement

| Property | Value |
|----------|-------|
| **Source** | Per-node wire extensometer reading (displacement in mm) |
| **Range** | 0 mm → 500 mm |
| **Ramp** | Pale blue → Indigo → Black (sequential cool-dark) |

**3D View** — Spherical markers at node positions, radius scaled by
displacement magnitude. Colour follows the blue-to-black ramp. A thin
vertical line ('stalk') from the original ground elevation to the current
elevation shows absolute drop. Clicking a node opens a mini time-series
sparkline in the inspector panel.

**2D View** — Graduated-symbol markers (circle radius ∝ displacement).
Fill colour follows the same blue-to-black ramp. Tooltip shows displacement
in mm, rate of change, and days since last reset.

---

## 3. Seismic & Vibration Heatmaps

### 3.1 Vibration PPV (Peak Particle Velocity)

| Property | Value |
|----------|-------|
| **Source** | `vibrationPPV` from blast, or per-node `vib_peak` |
| **Range** | 0 → 50 mm/s (DGMS limit for residential structures: 10 mm/s at 8–25 Hz) |
| **Ramp** | Green → Yellow → Red with DGMS threshold ring at 10 mm/s |
| **Formula** | `PPV_blast = 1140 · (D/√Q)^(−1.6)` — distance-decaying radial field |

**3D View** — Radial gradient overlay centred on the blast/event source.
Rendered as a flat disc mesh (`THREE.CircleGeometry`, 500 m radius) draped
on the terrain, vertex-coloured by the PPV attenuation law. The DGMS
10 mm/s iso-ring shown as a bright white circle. The existing
`SeismicWaveOverlay` component already renders animated shockwave rings —
this heatmap is the static PPV field displayed after the wavefront passes.

**2D View** — Concentric iso-PPV circles (GeoJSON `L.circle`) coloured by
the same ramp. Fill transparency decreases with distance. A table legend
shows the scaled-distance relationship. Click any point to read
interpolated PPV.

---

### 3.2 Vibration RMS Intensity

| Property | Value |
|----------|-------|
| **Source** | Per-node `vib_rms` (continuous background vibration) |
| **Range** | 0 → 25 mm/s |
| **Ramp** | Deep navy → Cyan → Lime (perceptually uniform sequential) |

**3D View** — Node marker glow rings. Each node gets a `THREE.RingGeometry`
halo at ground level, radius proportional to RMS intensity, coloured by
the ramp. High-RMS nodes have larger, brighter halos, creating a
"vibration aura" effect visible from the overview camera.

**2D View** — Heat-dot overlay using a Gaussian kernel centred on each node
(similar to Leaflet.heat). Kernel bandwidth set to the node's radio range
(~200 m). Intensity = `vib_rms`. Produces a smooth interpolated vibration
energy surface.

---

### 3.3 Dominant Frequency Classification

| Property | Value |
|----------|-------|
| **Source** | Per-node `vib_fdom` (dominant vibration frequency in Hz) |
| **Encoding** | Categorical by source type |
| **Categories** | Truck 8–20 Hz (brown), Blast 40–80 Hz (orange), Conveyor 50±0.5 Hz (blue ring), Microseismic 100–250 Hz (purple) |

**3D View** — Pie-chart markers at each node position showing frequency composition.
Each node's dominant frequency band mapped to one of four wedge colours.
Nodes currently detecting blast-range frequencies pulse with an orange
strobe. Microseismic detections shown with a purple lightning-bolt icon
mesh above the node.

**2D View** — Icon markers with categorical colouring by dominant frequency
band. Filter checkboxes in the legend let the operator isolate a single
source type ("Show only microseismic"). A frequency histogram popup on
click shows the last 60 s of spectral data.

---

### 3.4 Seismic Energy Attenuation

| Property | Value |
|----------|-------|
| **Source** | Computed from PPV law: energy ∝ PPV² · distance, integrated over all recent events |
| **Range** | 0 → 100% (normalised cumulative energy budget) |
| **Ramp** | Transparent → Gold → White (luminance-mapped) |

**3D View** — Volumetric fog layer at terrain level. Opacity proportional to
cumulative seismic energy received at each grid point over the last N
superframes. Gold glow near blast sites fading to transparent at far field.
Creates a "heat shimmer" aesthetic over recently disturbed ground.

**2D View** — Contour fill with gold-to-white ramp. Iso-energy contours at
25%, 50%, 75% of maximum shown as dashed lines. Useful for identifying
cumulative vibration fatigue zones that may crack even without a direct
blast.

---

## 4. Network Health Heatmaps

### 4.1 Signal Strength (RSSI)

| Property | Value |
|----------|-------|
| **Source** | Per-node `rssi` (dBm, typically −40 to −120) |
| **Range** | −120 dBm (dead zone) → −40 dBm (strong) |
| **Ramp** | Red → Yellow → Green (traffic-light, inverted for "higher is better") |

**3D View** — Floating billboard label at each node showing RSSI value.
Node sphere colour maps to signal strength. Mesh topology lines (already
toggled by `showMeshTopology`) coloured by the weaker endpoint's RSSI:
red links indicate potential communication failures. A translucent Voronoi
coverage surface shows estimated signal reach using a free-space path-loss
model.

**2D View** — Voronoi cells around each node, filled by RSSI ramp.
Dead-zone cells (< −110 dBm) shown with diagonal hatch pattern. Topology
overlay draws parent–child links as coloured polylines. Coverage shadow
polygons show areas beyond reliable radio reach (the "blind spots" matching
`d_committed = 358 m`).

---

### 4.2 Signal-to-Noise Ratio (SNR)

| Property | Value |
|----------|-------|
| **Source** | Per-node `snr` (dB) |
| **Range** | 0 dB (noise floor) → 30 dB (excellent) |
| **Ramp** | Purple (poor) → Cyan (moderate) → White (excellent) |

**3D View** — Ring indicator around each node marker base. Ring thickness
proportional to SNR; colour follows the ramp. Nodes below 6 dB (unreliable
decoding) get a dashed ring and a warning icon.

**2D View** — Same Voronoi fill as RSSI but using the SNR ramp. Overlay
option to show both RSSI and SNR as a bivariate colour grid (RSSI on x-axis,
SNR on y-axis, 3x3 colour matrix). This identifies nodes with strong signal
but high noise (interference) vs. weak signal but clean channel.

---

### 4.3 Packet Delivery Ratio (PDR)

| Property | Value |
|----------|-------|
| **Source** | Computed: packets received / packets expected per node per rolling window |
| **Range** | 0% → 100% |
| **Ramp** | Dark red → Yellow → Bright green (traffic-light sequential) |

**3D View** — Doughnut chart at each node position showing PDR as a filled
arc (green fill, grey remainder). Nodes below 80% PDR flash a red warning
icon. Aggregate cluster PDR shown as a larger doughnut at the cluster
relay node position.

**2D View** — Graduated circle markers at each node. Fill = PDR% completion
arc. Low-PDR nodes highlighted with a red border. A cluster overlay
(convex hull) colours each cluster by its aggregate PDR.

---

### 4.4 Hop Count & Routing Topology

| Property | Value |
|----------|-------|
| **Source** | `NodeDef.hop_count` (1 = direct to gateway, 2 = one relay, etc.) |
| **Encoding** | Sequential stepped: 1-hop = light blue, 2-hop = blue, 3-hop = indigo, 4-hop = dark violet |

**3D View** — Node sphere colour by hop count. Parent–child links rendered
as curved tube meshes (`THREE.TubeGeometry` along a catenary arc), colour
matching hop tier. Backup parent links shown as thinner dashed tubes in a
lighter shade. The gateway node (tier 3) shown as a larger golden octahedron.

**2D View** — Tree-layout diagram overlay on the map. Each node connected to
its parent by a directed arrow (Leaflet `L.polyline` with arrowhead
decorator). Node icons coloured by hop count. Cluster boundaries drawn as
convex hull polygons.

---

### 4.5 Node Alive/Dead Status

| Property | Value |
|----------|-------|
| **Source** | Per-node `alive` boolean + `node_state` |
| **Encoding** | Binary + failure classification: Alive = green dot, Dead = red cross, Degraded = amber triangle |

**3D View** — Simple traffic-light sphere at each node position (already
partially implemented via `NodeMarkers.tsx` STATE_COLORS). Dead nodes fade
to grey with a "flatline" horizontal bar replacing the sphere. Failure mode
(F1–F10 classification) shown as a small text label on hover.

**2D View** — Standard icon markers. Alive nodes: green pulsing dot. Dead
nodes: static red cross with last-seen timestamp in tooltip. Degraded:
amber triangle with the specific degradation (e.g. "battery low",
"high noise"). Filter toggle to show/hide dead nodes.

---

## 5. Environmental & Hardware Heatmaps

### 5.1 Temperature Distribution

| Property | Value |
|----------|-------|
| **Source** | Per-node die temperature (°C), ambient temperature (derived) |
| **Range** | 15°C → 65°C |
| **Ramp** | Cool blue `#2166ac` → Warm white `#f7f7f7` → Hot red `#b2182b` (diverging at 35°C) |

**3D View** — Interpolated temperature field (IDW from node readings)
rendered as a semi-transparent plane hovering 2 m above the terrain.
Hot spots glow with emissive material. Useful for detecting fire risk,
equipment overheating, or solar exposure patterns.

**2D View** — IDW-interpolated raster overlay with diverging colour ramp.
Isotherms at 25°C, 35°C, 45°C, 55°C. Click-to-query returns the
interpolated temperature at any point. Time-of-day animation slider
shows thermal cycling patterns.

---

### 5.2 Battery Voltage

| Property | Value |
|----------|-------|
| **Source** | Per-node battery voltage (V), `min_battery` from packet aggregates |
| **Range** | 2.5 V (critical) → 3.7 V (full charge) |
| **Ramp** | Red (≤2.8 V) → Amber (2.8–3.2 V) → Green (≥3.2 V) — three-step categorical |

**3D View** — Vertical battery-bar billboard at each node. Bar height and
colour encode remaining voltage. Nodes below 2.8 V flash a low-battery
warning icon. A "battery health projection" surface can be toggled on:
IDW interpolation of battery % shows geographic clusters of power drain
(e.g. nodes in deep valleys with less solar exposure).

**2D View** — Traffic-light circle markers. Tooltip shows voltage, estimated
days remaining, and charge/discharge trend. A summary bar chart in the
sidebar groups nodes by battery tier.

---

### 5.3 Duty Cycle & Power Budget

| Property | Value |
|----------|-------|
| **Source** | Computed from transmission schedule: active time / total time per superframe |
| **Range** | 0% → 100% (normal ~1.5%, P2 escalation ~4%, P3 event ~12%) |
| **Ramp** | Faint grey → Vivid electric blue → White (luminance sequential) |

**3D View** — Small rotating ring around each node, spin speed proportional
to duty cycle. Colour from the ramp — highly active nodes glow vivid blue,
sleeping nodes are faint grey. Creates an intuitive "busyness" visualisation.

**2D View** — Sized-circle markers (radius ∝ duty cycle %). Colour from the
same grey-to-blue ramp. Overlay option to show communication plane (P1/P2/P3)
as icon shape: circle = P1 routine, diamond = P2 escalation, star = P3 event.

---

## 6. Temporal & Analytical Heatmaps

### 6.1 Subsidence Velocity Change (Acceleration)

| Property | Value |
|----------|-------|
| **Source** | `d²S/dt² = −S_final · c² · e^(−c·t)` — second time-derivative |
| **Range** | −0.01 → 0 m/day² (always negative for Knothe model — decelerating) |
| **Ramp** | Deep magenta (high deceleration, fresh event) → Pale pink → Transparent (settled) |

**3D View** — Vertex colour overlay. Recently triggered bowls show deep
magenta at centre (ground is decelerating rapidly). As the bowl settles,
colour fades to transparent. This reveals which parts of the terrain are
still actively evolving vs. geomechanically quiet.

**2D View** — Time-lapse raster animation. Slider control advances through
time steps, showing the acceleration field fading. Iso-acceleration contours
at key thresholds provide settlement completion estimates.

---

### 6.2 Time-to-Stable (Knothe Convergence)

| Property | Value |
|----------|-------|
| **Source** | `t_stable = −ln(ε) / c` where ε = 0.02 (2% remaining), c = 0.04/day → ~98 days |
| **Range** | 0 days (already stable) → 120 days (fresh event) |
| **Ramp** | Green (stable) → Yellow (settling, >30d remaining) → Red (active, >90d) |

**3D View** — Translucent countdown surface hovering above the terrain.
Each vertex coloured by estimated days until 98% settlement completion.
Vertices already stable are transparent. Clock icon billboards at grid
sample points show the countdown in days.

**2D View** — Choropleth raster with day-count labels at grid intersections.
A timeline slider shows how the "time remaining" field evolves as days pass.
Useful for planning re-entry and structure assessment schedules.

---

### 6.3 PINN Residual (Model Uncertainty)

| Property | Value |
|----------|-------|
| **Source** | Leave-one-out (LOO) residual from the Physics-Informed Neural Network |
| **Range** | 0 (model agrees with physics) → high (model deviates — possible anomaly) |
| **Ramp** | Transparent → Yellow → Hot pink (sequential, deviation-mapped) |

**3D View** — Stippled/noisy overlay on the terrain. Areas where the PINN
prediction deviates significantly from the Knothe analytic solution are
highlighted with a stipple density proportional to the residual magnitude.
High-residual zones may indicate geological anomalies (faults, water
inflows) not captured by the idealised Knothe model.

**2D View** — Dot-density map. Each dot represents one unit of residual at a
random position within the cell. Denser dot clusters indicate higher model
uncertainty. Boundary of the 90th-percentile residual region shown as a
dashed polygon labelled "Model Uncertainty Zone".

---

### 6.4 Alarm Z-Score

| Property | Value |
|----------|-------|
| **Source** | Statistical z-score of each sensor channel relative to its rolling baseline |
| **Range** | 0 → 5+ (standard deviations from mean) |
| **Ramp** | Transparent (z < 2) → Amber (z = 2–3) → Red with pulse (z > 3) |

**3D View** — Exclamation-mark billboard icons at nodes exceeding z > 2.
Icon size scales with z-score. Multiple sensor alarms at one node stack
vertically as a small alarm tower. Colour: amber for caution, red for
critical alert.

**2D View** — Icon markers with badge count showing how many sensor channels
are alarming at each node. Click to expand a per-channel z-score breakdown
table. A global "alarm density" heatmap (Gaussian kernel) shows spatial
clustering of anomalies.

---

### 6.5 Historical Subsidence Accumulation

| Property | Value |
|----------|-------|
| **Source** | Cumulative sum of all perturbation bowls applied to each grid point |
| **Range** | 0 → `CUMULATIVE_DEPTH_MAX_M` (50 m) |
| **Ramp** | Same as 1.1 but with isochrone rings: coloured by the event epoch that caused each layer |

**3D View** — Layered geological-style rendering. Terrain mesh shows the
current cumulative depth, but each perturbation bowl's contribution is
rendered as a separate translucent coloured strata layer (unique hue per
event, from a categorical Tableau-10 palette). Toggling layers on/off
reveals each event's individual contribution.

**2D View** — Stacked area chart per grid cell. Click any location to see
a vertical bar chart showing depth contributed by each event. The map fill
uses the cumulative depth ramp; an "event attribution" toggle overlays pie
charts at sample points showing the fractional contribution of each event.

---

## 7. Composite / Multi-Layer Heatmaps

### 7.1 Risk Index (Unified)

| Property | Value |
|----------|-------|
| **Source** | Weighted composite: `Risk = w₁·strain_norm + w₂·tilt_norm + w₃·PPV_norm + w₄·crack_density_norm` |
| **Weights** | w₁ = 0.35 (strain), w₂ = 0.25 (tilt), w₃ = 0.20 (vibration), w₄ = 0.20 (crack density) |
| **Range** | 0000 → 1.0 |
| **Ramp** | Forest green → Amber → Scarlet → Black (four-stop perceptual) |

**3D View** — Full terrain vertex colouring with the composite risk ramp.
The single most intuitive summary layer: green = safe, black = extreme
hazard. Contour lines at risk = 0.3 (caution), 0.6 (warning), 0.9
(critical) drawn in white. Risk > 0.9 zones have a red emissive glow.

**2D View** — Filled contour map (choropleth) with the same four-stop ramp.
Three risk isolines labelled with thresholds. Layer control allows adjusting
individual weights via slider controls in the legend panel to perform
what-if sensitivity analysis. The existing `risk_zones` GeoJSON
(`high_confidence`, `low_confidence`, `brittle_failure`) can be overlaid for
comparison.

---

### 7.2 Strain vs. Tilt Bivariate

| Property | Value |
|----------|-------|
| **Source** | Strain (x-axis, 3 bins: low/med/high) × Tilt (y-axis, 3 bins: low/med/high) |
| **Encoding** | 3×3 bivariate colour matrix |
| **Matrix** | <pre>         Low Tilt    Med Tilt    High Tilt<br>Low ε    #e8e8e8     #ace4e4     #5ac8c8<br>Med ε    #dfb0d6     #a5add3     #5698b9<br>High ε   #be64ac     #8c62aa     #3b4994</pre> |

**3D View** — Vertex colour from the 3×3 matrix. Identifies four critical
zone types at a glance: (1) low-both = stable ground (grey), (2) high-tilt
low-strain = edge of bowl (teal), (3) high-strain low-tilt = centre
tensile zone (pink), (4) high-both = critical transition ring (deep
purple). Legend shows the 3×3 grid with both axis labels.

**2D View** — Same 3×3 bivariate choropleth. Particularly powerful for the
2D view where users can see spatial patterns in the relationship between
two channels simultaneously. Legend panel shows the colour matrix with
interactive highlighting.

---

### 7.3 Signal Quality vs. Ground Motion (Reliability Map)

| Property | Value |
|----------|-------|
| **Source** | Axis 1: RSSI signal quality (3 bins). Axis 2: subsidence rate (3 bins: stable/settling/active) |
| **Encoding** | 3×3 bivariate — identifies zones where high ground motion coincides with poor signal (data gap risk) |
| **Critical Zone** | Poor signal + Active motion = "Blind Hazard" — highlighted with hatched overlay |

**3D View** — Semi-transparent Voronoi overlay on terrain. Each zone
coloured by the bivariate matrix. "Blind Hazard" zones (poor signal + active
subsidence) rendered with animated diagonal stripes shader to signal urgent
attention — these are the areas most likely to produce undetected collapse.

**2D View** — Voronoi choropleth with bivariate fill. "Blind Hazard" cells
get a cross-hatch SVG overlay and a tooltip warning: "Signal degraded in
active subsidence zone — data gap risk." This directly maps to the
`d_committed = 358 m` blind spot analysis from the mesh network design.

---

### 7.4 Time-of-Day Activity (Temporal Heatmap)

| Property | Value |
|----------|-------|
| **Source** | Binned sensor activity by hour-of-day × node-id (24 × 31 matrix) |
| **Encoding** | Calendar heatmap style — rows = nodes, columns = hours, cell colour = activity level |

**3D View** — Not a terrain overlay. Instead, a floating HUD panel
(rendered with `@react-three/drei Html`) showing the 24×31 matrix as a
grid of coloured squares. Row labels are node IDs; column labels are hours
0–23. Highlights diurnal patterns: blast activity at shift change, thermal
cycling, battery voltage dips at night.

**2D View** — Side-panel widget (not a map overlay). Standard calendar
heatmap matrix using the same colour scale. Click a cell to filter the map
to show only that node at that hour. Useful for shift scheduling and
identifying periodic noise sources.

---

## 8. Colour Ramp Reference

### Existing Ramps (from `hypsometry.ts`)

| Ramp | Use | Stops |
|------|-----|-------|
| `HEIGHT_STOPS` | Absolute elevation (undisturbed terrain) | Green `#417a2e` → Yellow `#efde86`, L* 46→88 ascending |
| `DEPTH_STOPS` | Subsidence displacement depth | Blue `#0093dc` → Violet `#6c2dff` → Red `#690003`, L* 58→20 descending |

### New Ramps Required

| Ramp | Use | Design Principle |
|------|-----|-----------------|
| **Warm Sequential** | Tilt, strain, PPV | White→Amber→Crimson. Single-hue warm, monotone-safe in greyscale. |
| **Cool Sequential** | SNR, displacement, temperature-cold | Navy→Cyan→White. Single-hue cool, perceptually uniform. |
| **Diverging Teal–Magenta** | Curvature, acceleration | Teal (negative) → White (zero) → Magenta (positive). Colour-blind–safe diverging. |
| **Traffic-Light** | RSSI, PDR, battery | Red→Yellow→Green. "Higher is better" convention, familiar to operators. |
| **Risk Four-Stop** | Composite risk index | Forest→Amber→Scarlet→Black. High contrast, greyscale-safe (light→dark). |
| **Bivariate 3×3** | Strain×Tilt, Signal×Motion | Purple-teal matrix per Brewer recommendations. Two-variable summary. |
| **Categorical Tableau-10** | Zone state, frequency band, event epoch | Maximally distinct hues. Already available via the `STATE_COLORS` palette for five categories; extend to ten. |

### Design Constraints

All ramps must satisfy:

1. **Perceptual monotonicity** — lightness must decrease (or increase) monotonically across the ramp so greyscale reproduction preserves order.
2. **Colour-blind safety** — avoid red-green adjacency in sequential ramps; use blue–orange or blue–red axes instead. Diverging ramps use teal–magenta (safe for protanopia and deuteranopia).
3. **Composite compatibility** — when overlaid on the existing `HEIGHT_STOPS` terrain base, the blended result must not produce a lightness inversion (same constraint solved by the excavation shadow for `DEPTH_STOPS`).
4. **Dark-theme readability** — the dashboard uses `#0F1724` background; all ramps must have sufficient contrast against dark chrome on labels and legends.
5. **Print-safe** — key threshold lines (DGMS 5.3 mm/m, PPV 10 mm/s) rendered as dashed black/white strokes, not relying on colour alone.

---

*Document generated from analysis of the Adriyala subsidence monitoring frontend
(React 19, Three.js 0.185, @react-three/fiber v9, Leaflet/MapLibre) and domain
models (Knothe, DGMS, PINN, LoRa mesh). All data channels derive from the 31-node
sensor network, the geomechanics engine, and the simulation backend.*
