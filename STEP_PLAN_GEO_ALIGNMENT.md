# Plan: Make the Simulation and the Dashboard Point at the Same Place

Goal of this plan (and nothing else): the simulation and the frontend agree on
ONE location, ONE grid, and ONE set of 31 node positions. No new physics, no
per-sector simulation, no new backend features.

---

## The one problem we are fixing

The simulation thinks in METRES around the real Adriyala mine.
The dashboard thinks in LAT/LON around Jharia, a mine 1000 km away.
Nothing converts between them. So the map can never show the real nodes.

    SIMULATION                        DASHBOARD
    origin 18.6435 N, 79.5725 E       centre 23.7440 N, 86.4195 E   <-- WRONG MINE
    nodes as x,y metres               markers need lat/lon
    600 x 600 m window                grid box drawn over Jharia
              |                                  |
              +---------- MISSING LINK ----------+
                     (metres -> lat/lon)

Everything below is building that link and then using it.

---

## Facts already confirmed in the code (not assumptions)

| Thing | Value | Where |
|---|---|---|
| Real site origin | 18.6435 N, 79.5725 E | simulation/sandbox/dem.py:9, server.py:210 |
| Window | 600 x 600 m, centred on panel centre (0,0) | constants.py:79 |
| Panel width (across strike) | 250 m | constants.py:35 |
| Panel length (along strike) | 2500 m | constants.py:36 |
| Radius of influence | 197.4 m (375 / 1.9) | constants.py:50 |
| Node count | 31 (25 scout, 5 anchor, 1 gateway) | layout.py |
| Nodes stored as | x, y, z in METRES | db.py:70 |
| Dashboard centre | 23.7440, 86.4195 (Jharia) | map-view.js:7 |
| Grid box | 23.7395..23.7485 / 86.4140..86.4250 (Jharia) | panel-grid.js:22 |
| metres -> lat/lon converter | DOES NOT EXIST ANYWHERE | verified by grep |

Note: the panel is 2500 m long but the window is only 600 m. The window shows
the middle slice of the panel. That is intentional and we keep it.

---

## Step 1 - Build the metres -> lat/lon converter (Python side)

New file: `simulation/sandbox/geo.py`

Fixed anchor constants:

    ORIGIN_LAT = 18.6435
    ORIGIN_LON = 79.5725
    PANEL_BEARING_DEG = 0.0     # +y = north for now; see Step 1b

Conversion (flat-earth, exact enough over 600 m):

    lat = ORIGIN_LAT + (y / 111320)
    lon = ORIGIN_LON + (x / (111320 * cos(radians(ORIGIN_LAT))))

At 18.6435 N, cos = 0.9475, so 1 deg lon = 105,480 m.
The 600 m window therefore spans about 0.0054 deg lat by 0.0057 deg lon.

Provide the inverse too (`latlon_to_xy`) so the frontend and backend can
round-trip without drift.

DONE WHEN: `python -c "from sandbox.geo import xy_to_latlon; print(xy_to_latlon(0,0), xy_to_latlon(300,300))"`
prints the origin, and a corner about 0.0027 deg away in each axis.

### Step 1b - the panel bearing (one thing I need to flag)

A real longwall panel runs along a compass bearing, not perfectly north.
I could not find Adriyala's true panel bearing in the repo or in open
literature. So Step 1 sets `PANEL_BEARING_DEG = 0.0` and treats +y as north.

This is a STATED ASSUMPTION, written in the file as a comment, and it is a
single constant to change later. It does not block anything: the whole system
stays self-consistent because everyone reads the same constant. If SCCL data
gives the real bearing later, changing that one number rotates the map, the
grid and all 31 nodes together, correctly.

---

## Step 2 - Store lat/lon in PostgreSQL

Add two columns to `nodes`:

    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION;

In `db.py sync_simulation_nodes` (line ~189), where each node is already
upserted with x and y, also compute and write lat/lon via `geo.xy_to_latlon`.
Extend `UPSERT_NODE_SQL` (line 70) to carry the two new columns.

Keep x and y. They stay the physics truth; lat/lon are the display projection.

CHECK WITH YOU - pgAdmin:

    SELECT node_id, tier, x, y, lat, lon FROM nodes ORDER BY node_id;

Expect exactly 31 rows, N01..N31, every lat near 18.64, every lon near 79.57.
Gateway N31 sits furthest out (it is placed outside the angle of draw).

---

## Step 3 - Serve lat/lon through the backend

`backend/routes/nodes.js` already has `GET /api/nodes` (line 49). Include the
new `lat` and `lon` columns in the SELECT and in the JSON response.

Nothing else in the backend changes.

CHECK WITH YOU - terminal:

    curl -s localhost:8080/api/nodes | head -c 600

Expect 31 entries each carrying lat and lon.

---

## Step 4 - Move the dashboard map to Adriyala

`dashboard_electron/renderer/js/map/map-view.js`:

    MINE_CENTER  23.7440, 86.4195   ->   18.6435, 79.5725
    MINE_BOUNDS  Jharia box         ->   18.6408..18.6462 / 79.5697..79.5753
    maxBounds    Jharia box         ->   a slightly larger Adriyala box

The 600 m window in degrees: +/- 0.0027 lat, +/- 0.0028 lon around origin.

CHECK WITH YOU - browser: open the dashboard, satellite view, you are looking
at the real Adriyala site in Telangana instead of Jharkhand.

---

## Step 5 - Put the 31 real nodes on the map

`dashboard_electron/renderer/js/map/node-markers.js` currently expects the old
60-node mock shape. Point it at `GET /api/nodes` and render one marker per
returned node at its lat/lon, styled by role:

    gateway (N31)  - large square, distinct colour, outside the panel
    anchor  (N26-30) - medium triangle
    scout   (N01-25) - small circle

Popup on click: node_id, tier, role, x/y in metres, lat/lon.

CHECK WITH YOU - browser: count 31 markers. Scouts cluster over the panel,
the gateway is clearly outside the others.

---

## Step 6 - Redraw the sector grid over the real panel

`dashboard_electron/renderer/js/map/panel-grid.js` has a hardcoded Jharia box
(line 22) and an 8x8 grid. Two changes:

1. Replace the bounds with the Adriyala window computed from `geo`, so the
   grid sits exactly on the 600 x 600 m simulation window - the grid and the
   physics then cover literally the same ground.

2. Keep 8x8 = 64 cells for now. Cell size becomes 75 x 75 m, which is a
   sensible sector. Many cells will hold zero nodes; draw those grey and
   label them "no coverage" rather than pretending they are healthy.

Grid maths, so cell -> metres is exact and reversible:

    cell (row r, col c), r and c from 0..7
    x_min = -300 + c * 75      x_max = x_min + 75
    y_max =  300 - r * 75      y_min = y_max - 75
    then convert those corners with geo.xy_to_latlon

Assign each node to a cell by its x,y - not by lat/lon - so assignment is done
in the physics frame and cannot drift.

CHECK WITH YOU - browser: the grid overlays the panel area, node markers sit
inside the cells you would expect, cells with no nodes are visibly grey.

---

## Step 7 - Show the same location in the simulation site

`simulation/sandbox/server.py` already reports dem_lat/dem_lon (lines 210, 451).
Confirm the Three.js terrain in `simulation/frontend/` uses that same origin and
the same 600 m window, and render the same 31 node positions on the terrain.

This is the step that lets you "see the mine in the simulation, change it, and
watch the dashboard react" - both screens are now drawing the same ground with
the same node set.

CHECK WITH YOU - both screens side by side: a node in the same relative spot on
both. Run the sim; the dashboard markers update.

---

## What we are deliberately NOT doing in this plan

- No per-sector simulation
- No new physics
- No changes to readings or simulation_packets
- No new backend endpoints
- Panel bearing stays 0 until real data says otherwise (Step 1b)

---

## Order and stopping points

    Step 1  geo.py                  -> python one-liner
    Step 2  db columns + write      -> STOP, you check pgAdmin
    Step 3  backend serves lat/lon  -> STOP, you check curl
    Step 4  map moves to Adriyala   -> STOP, you check browser
    Step 5  31 markers              -> STOP, you check browser
    Step 6  grid over real panel    -> STOP, you check browser
    Step 7  sim site same origin    -> STOP, you check both screens

Each STOP means no further code until you confirm.
