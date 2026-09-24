/**
 * app.js — Window 1 wiring: load scene.json, build ground + network, timeline, cameras, inspector.
 * Read-only: no control here changes terrain truth.
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));

  fetch("scene/scene.json")
    .then((r) => { if (!r.ok) throw new Error(`scene/scene.json: HTTP ${r.status}`); return r.json(); })
    .catch((e) => { $("loading").textContent = `Could not load scene: ${e.message}. Run: python renderer/export_scene.py`; throw e; })
    .then((data) => {
      try { start(data); } catch (e) { $("loading").textContent = `Renderer error: ${e.message}`; throw e; }
    });

  function start(data) {
    const view = $("viewport");
    // F9: the canvas no longer fills the window — it fills the middle cell of the shell grid. Every
    // measurement below (size, aspect, picking, label projection, metres-per-pixel) must come from
    // #viewport's own box. Reading window.innerWidth here would offset every click and every label
    // by the width of the left rail. The rect is cached because it is read per node per frame;
    // refreshCanvas() is the single place that reinstates it.
    let vRect = view.getBoundingClientRect();
    const vW = () => vRect.width || 1;
    const vH = () => vRect.height || 1;
    const GFX = data.display && data.display.graphics ? data.display.graphics : {};
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.localClippingEnabled = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, GFX.max_pixel_ratio || 2));
    renderer.setSize(vW(), vH());
    // F6 A4: colour-correct output. Vertex colours are authored in sRGB, so the renderer converts on
    // write, and ACES filmic tone mapping keeps the bright sunlit slopes off the clipping point.
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = GFX.exposure != null ? GFX.exposure : 1.05;
    view.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // F6 A4: an equirectangular sky gradient — zenith, horizon haze, nadir ground-bounce. Equirect
    // mapping (not a flat background image) means the horizon stays put when the camera rolls under
    // the ground, and PMREM can turn the same gradient into the scene's ambient light.
    const SKY = GFX.sky || {};
    const skyTex = (() => {
      const c = document.createElement("canvas");
      c.width = 16; c.height = 256;
      const g = c.getContext("2d").createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0.00, SKY.zenith || "#060a16");
      g.addColorStop(0.42, SKY.upper || "#16203a");
      g.addColorStop(0.50, SKY.horizon || "#41506b");
      g.addColorStop(0.58, SKY.lower || "#211f21");
      g.addColorStop(1.00, SKY.nadir || "#0a0908");
      const ctx = c.getContext("2d");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
      const t = new THREE.CanvasTexture(c);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.encoding = THREE.sRGBEncoding;
      return t;
    })();
    scene.background = skyTex;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(skyTex).texture;
    pmrem.dispose();
    const sky = new THREE.Color(SKY.horizon || "#41506b");
    scene.fog = new THREE.Fog(sky, 3500, 9000);
    const camera = new THREE.PerspectiveCamera(42, vW() / vH(), 1, 60000);

    // The sky gradient now carries the ambient term, so the fill lights only shape it.
    scene.add(new THREE.HemisphereLight(0xe0ecff, 0x40342a, GFX.hemi_intensity != null ? GFX.hemi_intensity : 0.30));
    const sun = new THREE.DirectionalLight(0xfff1dc, GFX.sun_intensity != null ? GFX.sun_intensity : 1.35);
    sun.position.set(-2200, 1500, -1600);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fb8ff, GFX.fill_intensity != null ? GFX.fill_intensity : 0.22);
    fill.position.set(1500, 900, 2000);
    scene.add(fill);
    // F6 A2: a dim light from below so the underside of the shell is readable, not black, when the
    // camera passes under the ground.
    const underLight = new THREE.DirectionalLight(0xb7a888, GFX.under_intensity != null ? GFX.under_intensity : 0.30);
    underLight.position.set(600, -1800, 900);
    scene.add(underLight);

    const terrain = new MineTerrain(scene, data, renderer);
    terrain.setRenderer(renderer);
    const net = new MineNetwork(scene, terrain, data);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // F6 A2: full 360°. The camera may pass under the ground and look up at the subsidence bowl from
    // below — the ground is a thin shell now, and the surface is DoubleSide, so three.js flips the
    // normal on back faces and the underside lights correctly.
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.enableZoom = true;              // Allows smooth two-finger trackpad pinch and wheel zooming
    controls.zoomSpeed = 1.0;

    // ------------------------------------------------------------------ fixed zoom levels (F2)
    // Horizontal scale is 1 scene unit = 1 m; a level is the ground width visible across the screen at
    // the orbit target. Distance for width w: d = (w / 2) / tan(horizontal fov / 2).
    const Z = data.zoom;
    const LEVELS = Z.levels_view_width_m;
    const halfTan = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
    const distFor = (w) => w / 2 / halfTan();
    const viewWidth = () => 2 * camera.position.distanceTo(controls.target) * halfTan();
    const nearestLevel = (w) => LEVELS.reduce((b, lw, q) => (Math.abs(Math.log(lw / w)) < Math.abs(Math.log(LEVELS[b] / w)) ? q : b), 0);
    let zoomLevel = Z.default_level;
    function applyZoomLimits() {
      controls.minDistance = distFor(Math.min(...LEVELS)) * 0.999;
      controls.maxDistance = distFor(Math.max(...LEVELS)) * 1.001;
    }
    applyZoomLimits();

    // ------------------------------------------------------------------ legends + summary
    const TIER_SVG = {
      "1A": `<svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align:middle;margin-right:6px"><polygon points="7,2 13,12 1,12" fill="${TIER_COLOUR["1A"]}"/></svg>`,
      "1B": `<svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align:middle;margin-right:6px"><rect x="2" y="2" width="10" height="10" rx="1" fill="${TIER_COLOUR["1B"]}"/></svg>`,
      "1C": `<svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align:middle;margin-right:6px"><polygon points="7,1 13,7 7,13 1,7" fill="${TIER_COLOUR["1C"]}"/></svg>`,
      "anchor": `<svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align:middle;margin-right:6px"><polygon points="7,1 12.5,4 12.5,10 7,13 1.5,10 1.5,4" fill="${TIER_COLOUR["anchor"]}"/></svg>`,
      "gateway": `<svg width="14" height="14" viewBox="0 0 14 14" style="vertical-align:middle;margin-right:6px"><polygon points="7,1 8.8,4.8 13,5.4 10,8.3 10.7,12.5 7,10.4 3.3,12.5 4,8.3 1,5.4 5.2,4.8" fill="${TIER_COLOUR["gateway"]}"/></svg>`,
    };

    const geom = data.geometry || {};
    $("mineTitle").textContent = `${(data.mine || "mine").replace(/_/g, " ").toUpperCase()} — Subsidence Simulator`;
    $("elevRange").textContent = `${fmt(terrain.datum)}–${fmt(terrain.elevMax)} m AMSL`;
    $("heightRamp").style.background = Ramps.cssGradient(Ramps.HEIGHT_STOPS);
    $("heightTicks").innerHTML = [0, 0.25, 0.5, 0.75, 1].map((q) => `<span>${fmt(terrain.sortedElev[Math.round(q * (terrain.sortedElev.length - 1))])}</span>`).join("");
    $("depthRamp").style.background = Ramps.cssGradient(Ramps.DEPTH_STOPS);
    $("depthTicks").innerHTML = [0, 0.25, 0.5, 0.75, 1].map((q) => `<span>${fmt(q * terrain.peakMm)}</span>`).join("");
    $("sinkMax").textContent = `0–${fmt(terrain.peakMm)} mm`;
    $("demNote").textContent = data.terrain
      ? `Terrain: ${data.terrain.source} (${data.terrain.provenance}). Height ticks are area quantiles. Sinking: world grid, one frame per simulated day (${data.frames.n_days} frames, loaded ${data.frames.chunk_days} days at a time), interpolated.`
      : "No DEM configured for this mine — flat ground.";

    const plan = data.plan;
    if (plan) {
      // Per-tier counts are not repeated here: the Sensor node layers box already lists the same five
      // numbers beside the switches that act on them.
      $("planCost").textContent = `₹${fmt(plan.cost_inr.total)}`;
      const c = plan.checks;
      const scouts = (plan.counts["1A"] || 0) + (plan.counts["1B"] || 0) + (plan.counts["1C"] || 0);
      const row = (k, v, cls = "") => `<div class="row"><span>${k}</span><span class="${cls}">${v}</span></div>`;
      $("planChecks").innerHTML =
        row("Children per anchor", `max ${c.max_children} / cap ${c.cap}`, c.max_children <= c.cap ? "ok" : "bad") +
        row("Scout spacing (min · median)", `${fmt(c.scout_nn_min_m, 1)} · ${fmt(c.scout_nn_median_m, 1)} m`) +
        row("Irregularity (NN CV)", fmt(c.scout_nn_cv, 2), c.scout_nn_cv > 0.1 ? "ok" : "warn") +
        row("Closest two anchors", `${fmt(c.anchor_spacing_min_m, 1)} m (need ${fmt(c.min_anchor_spacing_m, 1)})`,
            c.anchor_spacing_min_m >= c.min_anchor_spacing_m ? "ok" : "bad") +
        row("Steepest node site", `${fmt(c.max_node_slope_deg, 1)}°`) +
        row("Steep moving cells skipped", fmt(c.steep_moving_cells_excluded)) +
        row("Scout links terrain-clear", `${c.scout_links_clear}/${scouts}`, c.scout_links_clear === scouts ? "ok" : "warn") +
        row("Anchor→gateway clear", `${c.anchor_links_clear}/${plan.counts.anchor}`, c.anchor_links_clear === plan.counts.anchor ? "ok" : "warn") +
        row("Worst link margin", `${fmt(c.min_link_margin_db, 1)} dB (need ${fmt(c.link_margin_required_db)})`, c.min_link_margin_db >= c.link_margin_required_db ? "ok" : "bad");
    } else {
      $("planBox").innerHTML = '<h3>Planned network</h3><div class="note">No plan in scene. Run: python -m minesim.placement (in mine-sim), then re-export.</div>';
      $("tPlan").checked = false; $("tLinks").checked = false;
    }

    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // ------------------------------------------------------------------ cameras
    const L = data.panel.length_m, W = data.panel.width_m;
    const xS = geom.survey_line_x_m != null ? geom.survey_line_x_m : L / 2;
    const gw = plan ? plan.nodes.find((n) => n.tier === "gateway") : null;
    const fly = { from: null, to: null, t: 1 };
    function clampTarget(target) {
      const e = terrain.extent;
      const wx = Math.min(e.xMax, Math.max(e.xMin, terrain.worldX(target.x)));
      const wy = Math.min(e.yMax, Math.max(e.yMin, terrain.worldY(target.z)));
      return new THREE.Vector3(terrain.sx(wx), target.y, terrain.sz(wy));
    }
    /** Fly (or jump) to a view. With snap (default) the distance is moved onto the nearest zoom level. */
    function setCam(pos, target, instant, snap = true) {
      target = clampTarget(target);
      if (snap) {
        const dir = pos.clone().sub(target);
        const d = dir.length() || 1;
        zoomLevel = nearestLevel(2 * d * halfTan());
        pos = target.clone().add(dir.multiplyScalar(distFor(LEVELS[zoomLevel]) / d));
      }
      if (instant) { camera.position.copy(pos); controls.target.copy(target); controls.update(); return; }
      fly.from = { p: camera.position.clone(), q: controls.target.clone() };
      fly.to = { p: pos, q: target };
      fly.t = 0;
    }
    function cam(name, instant) {
      const g = (x, y) => terrain.groundY(x, y);
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      if (name !== "under" && $("tXray").checked && cam.autoXray) { $("tXray").checked = false; applyLayers(); cam.autoXray = false; }
      if (name === "section") {
        terrain.setSection(xS);
        renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -terrain.sx(xS))];
      } else if (terrain.sectionX != null) {
        terrain.setSection(null);
        renderer.clippingPlanes = [];
      }
      if (name === "overview") setCam(V(terrain.sx(-250), g(L / 2, 0) + 1150, 1900), V(terrain.sx(L * 0.42), g(L / 2, 0), -150), instant);
      if (name === "face") {
        const fx = terrain.faceX;
        setCam(V(terrain.sx(fx + 420), g(fx, 0) + 260, 520), V(terrain.sx(fx - 120), g(fx - 120, 0), 0), instant);
      }
      if (name === "section") {
        // F6 A1: strata live in the X-ray view now, so the cut face needs it on.
        if (!$("tXray").checked) { $("tXray").checked = true; applyLayers(); cam.autoXray = true; }
        const mid = (terrain.seamTopY + g(xS, 0)) / 2;
        setCam(V(terrain.sx(xS) - 1250, mid + 260, -40), V(terrain.sx(xS), mid + 20, 0), instant);
      }
      if (name === "network" && plan) {
        const selParam = new URLSearchParams(location.search).get("select");
        const selNode = (selParam != null) ? plan.nodes.find((m) => m.node_id === parseInt(selParam, 10)) : null;
        if (selNode) {
          const gy = g(selNode.x_m, selNode.y_m);
          setCam(V(terrain.sx(selNode.x_m) + 35, gy + 40, terrain.sz(selNode.y_m) + 55), V(terrain.sx(selNode.x_m) + 8, gy + 4, terrain.sz(selNode.y_m) - 8), instant);
        } else {
          const s = plan.sector, mx = (s.x_min_m + s.x_max_m) / 2;
          setCam(V(terrain.sx(mx - 150), g(mx, 0) + 520, 620), V(terrain.sx(mx), g(mx, 0), 0), instant);
        }
      }
      if (name === "under") {
        if (!$("tXray").checked) { $("tXray").checked = true; applyLayers(); cam.autoXray = true; }
        setCam(V(terrain.sx(-600), terrain.seamTopY + 700, 1750), V(terrain.sx(L * 0.42), terrain.seamTopY + 120, 0), instant);
      }
      if (name === "top") setCam(V(terrain.sx(L / 2), 5200, 1), V(terrain.sx(L / 2), 0, 0), instant);

      // Close-up camera presets for individual node inspections
      const selParam = new URLSearchParams(location.search).get("select");
      const selNode = (selParam != null && plan) ? plan.nodes.find((m) => m.node_id === parseInt(selParam, 10)) : null;

      if (name === "1a" && plan) {
        const n = (selNode && selNode.tier === "1A") ? selNode : (plan.nodes.find((m) => m.tier === "1A") || plan.nodes[100]);
        if (n) {
          const gy = g(n.x_m, n.y_m);
          setCam(V(terrain.sx(n.x_m) + 3.2, gy + 2.4, terrain.sz(n.y_m) + 4.0), V(terrain.sx(n.x_m), gy + 1.1, terrain.sz(n.y_m)), instant);
        }
      }
      if (name === "1b" && plan) {
        const n = (selNode && selNode.tier === "1B") ? selNode : plan.nodes.find((m) => m.tier === "1B");
        if (n) {
          const gy = g(n.x_m, n.y_m);
          setCam(V(terrain.sx(n.x_m) + 8.0, gy + 4.5, terrain.sz(n.y_m) + 9.5), V(terrain.sx(n.x_m) + 5.0, gy + 0.8, terrain.sz(n.y_m)), instant);
        }
      }
      if (name === "1c" && plan) {
        const n = (selNode && selNode.tier === "1C") ? selNode : plan.nodes.find((m) => m.tier === "1C");
        if (n) {
          const gy = g(n.x_m, n.y_m);
          setCam(V(terrain.sx(n.x_m) + 18.0, gy + 9.0, terrain.sz(n.y_m) + 24.0), V(terrain.sx(n.x_m) + 15.0, gy + 1.0, terrain.sz(n.y_m)), instant);
        }
      }
      if (name === "anchor" && plan) {
        const n = (selNode && selNode.tier === "anchor") ? selNode : plan.nodes.find((m) => m.tier === "anchor");
        if (n) {
          const gy = g(n.x_m, n.y_m);
          setCam(V(terrain.sx(n.x_m) + 3.8, gy + 2.8, terrain.sz(n.y_m) + 4.8), V(terrain.sx(n.x_m), gy + 1.3, terrain.sz(n.y_m)), instant);
        }
      }
      if (name === "gateway" && plan) {
        const n = (selNode && selNode.tier === "gateway") ? selNode : (gw || plan.nodes.find((m) => m.tier === "gateway"));
        if (n) {
          const gy = g(n.x_m, n.y_m);
          setCam(V(terrain.sx(n.x_m) + 20.0, gy + 11.0, terrain.sz(n.y_m) + 22.0), V(terrain.sx(n.x_m), gy + 5.0, terrain.sz(n.y_m)), instant);
        }
      }
    }

    document.querySelectorAll("[data-cam]").forEach((b) => b.addEventListener("click", () => cam(b.dataset.cam)));

    // ------------------------------------------------------------------ panel segments (250m x 250m)
    const NUM_SEGMENTS = 10;
    const SEG_LEN_M = L / NUM_SEGMENTS; // 250 m
    const HALF_W = W / 2; // 125 m
    const segments = [];
    for (let i = 1; i <= NUM_SEGMENTS; i++) {
      const xMin = (i - 1) * SEG_LEN_M;
      const xMax = i * SEG_LEN_M;
      segments.push({
        id: String(i),
        num: i,
        name: `Seg ${i}: ${fmt(xMin)} – ${fmt(xMax)} m`,
        short: `${i}`,
        xMin,
        xMax,
        yMin: -HALF_W,
        yMax: HALF_W,
      });
    }

    /** Cut depth of an isolated segment block, in scene units (metres x relief) — matches terrain.js.
     *  Zero in the default view: the isolated segment is now a thin crust with nothing under it, so
     *  the camera frames the ground, not a slab of rock. Only X-ray cuts a column worth aiming into. */
    function segmentCutDepth() {
      if (!terrain.opts.xray) return 0;
      const m = (data.display && data.display.segment_cut_depth_m) || 120;
      return m * terrain.opts.relief;
    }

    function getFaceSegment() {
      const fx = terrain.faceX || 0;
      const xMin = Math.max(0, Math.min(L - SEG_LEN_M, fx - SEG_LEN_M / 2));
      return {
        id: "face",
        name: `⚡ Active Face: ~${fmt(Math.round(xMin))}–${fmt(Math.round(xMin + SEG_LEN_M))} m`,
        short: "Face",
        xMin,
        xMax: xMin + SEG_LEN_M,
        yMin: -HALF_W,
        yMax: HALF_W,
      };
    }

    let currentSegmentId = "full";

    function updateSegmentStats(seg) {
      if (!seg || seg.id === "full") {
        if ($("segStats")) $("segStats").textContent = "Full mine overview · 10 segments along 2500 m panel";
        if ($("segChip")) $("segChip").textContent = "Full";
        return;
      }
      let nodeCount = 0;
      if (plan && plan.nodes) {
        nodeCount = plan.nodes.filter((n) => n.x_m >= seg.xMin && n.x_m <= seg.xMax && n.y_m >= seg.yMin && n.y_m <= seg.yMax).length;
      }
      const fx = terrain.faceX || 0;
      let faceStatus = "";
      if (fx < seg.xMin) {
        faceStatus = `Face ${fmt(seg.xMin - fx)} m ahead (unmined)`;
      } else if (fx >= seg.xMin && fx <= seg.xMax) {
        faceStatus = `⚡ Face in segment (${fmt(fx - seg.xMin)} m)`;
      } else {
        faceStatus = `Passed (${fmt(fx - seg.xMax)} m, goaf)`;
      }
      const midX = (seg.xMin + seg.xMax) / 2;
      const elev = terrain.elevAt(midX, 0);
      if ($("segStats")) {
        $("segStats").innerHTML = `<b>${fmt(seg.xMin)}–${fmt(seg.xMax)} m</b> · elev ~${fmt(elev, 1)} m · <b>${nodeCount}</b> nodes<br><span style="color:#fb923c">${faceStatus}</span>`;
      }
      if ($("segChip")) $("segChip").textContent = seg.id === "face" ? "⚡ Face" : `Seg ${seg.id}`;
    }

    function selectSegment(id, instant = false) {
      currentSegmentId = id;
      let seg;
      if (id === "full") {
        seg = { id: "full", name: "Full Mine (Overview)", xMin: terrain.firstX, xMax: terrain.firstX + (terrain.nx - 1) * terrain.cell, yMin: terrain.firstY, yMax: terrain.firstY + (terrain.ny - 1) * terrain.cell };
      } else if (id === "face") {
        seg = getFaceSegment();
      } else {
        const num = parseInt(id, 10);
        seg = segments[num - 1];
      }
      if (!seg) return;

      const isolate = $("tIsolate") ? $("tIsolate").checked : true;
      terrain.setSegment(seg, isolate);
      net.forceIcons = terrain.segmentIsolated;
      net.segmentBounds = terrain.segmentDrawBounds;   // includes the context band, so its nodes show too

      if ($("segSelect")) $("segSelect").value = id;
      document.querySelectorAll(".seg-btn").forEach((btn) => {
        btn.classList.toggle("on", btn.dataset.seg === id);
      });

      if (id === "full") {
        cam("overview", instant);
      } else {
        const midX = (seg.xMin + seg.xMax) / 2;
        const midY = (seg.yMin + seg.yMax) / 2;
        const gy = terrain.groundY(midX, midY);
        // Frame the whole 250 x 250 m block INCLUDING its cutaway side walls, not just its top face:
        // aim below the surface by half the cut depth and stand far enough back that a 250 m footprint
        // plus ~120 m of strata both fit. Looking down ~32° from the south-east.
        const cut = segmentCutDepth();
        const camTarget = new THREE.Vector3(terrain.sx(midX), gy - cut * 0.45, 0);
        const camPos = new THREE.Vector3(terrain.sx(midX) + 400, camTarget.y + 330, 520);
        setCam(camPos, camTarget, instant, false);
      }

      updateSegmentStats(seg);
    }

    function stepSegment(delta) {
      if (currentSegmentId === "full") {
        selectSegment(delta > 0 ? "1" : "10");
        return;
      }
      if (currentSegmentId === "face") {
        const fx = terrain.faceX || 0;
        const currentIdx = Math.max(1, Math.min(NUM_SEGMENTS, Math.floor(fx / SEG_LEN_M) + 1));
        const nextIdx = Math.max(1, Math.min(NUM_SEGMENTS, currentIdx + delta));
        selectSegment(String(nextIdx));
        return;
      }
      const num = parseInt(currentSegmentId, 10);
      const nextNum = num + delta;
      if (nextNum < 1) selectSegment("full");
      else if (nextNum > NUM_SEGMENTS) selectSegment("full");
      else selectSegment(String(nextNum));
    }

    if ($("segSelect")) {
      $("segSelect").addEventListener("change", (e) => selectSegment(e.target.value));
    }
    document.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => selectSegment(btn.dataset.seg));
    });
    if ($("segPrev")) $("segPrev").addEventListener("click", () => stepSegment(-1));
    if ($("segNext")) $("segNext").addEventListener("click", () => stepSegment(1));
    if ($("tIsolate")) {
      $("tIsolate").addEventListener("change", () => {
        selectSegment(currentSegmentId, true);
      });
    }

    /** Zoom centre: the selected node, else the ground under the screen centre, else the orbit target. */
    function zoomCentre() {
      if (net.selected && net.selected.kind === "plan") {
        const n = plan.nodes[net.selected.k];
        return new THREE.Vector3(terrain.sx(n.x_m), terrain.groundY(n.x_m, n.y_m), terrain.sz(n.y_m));
      }
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const g = ray.intersectObject(terrain.surface)[0];
      return g ? g.point.clone() : controls.target.clone();
    }
    /** Fly to zoom level `level` (clamped), centred on `centre` (scene vector) or zoomCentre(). */
    function zoomTo(level, centre, instant) {
      level = Math.max(0, Math.min(LEVELS.length - 1, level));
      const target = clampTarget(centre || zoomCentre());
      const from = fly.t < 1 ? fly.to : { p: camera.position, q: controls.target };
      const dir = from.p.clone().sub(from.q).normalize();
      zoomLevel = level;
      setCam(target.clone().add(dir.multiplyScalar(distFor(LEVELS[level]))), target, instant, false);
    }
    $("zin").addEventListener("click", () => zoomTo(zoomLevel + 1));
    $("zout").addEventListener("click", () => zoomTo(zoomLevel - 1));
    window.addEventListener("keydown", (e) => {
      if (e.target !== document.body) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomTo(zoomLevel + 1); }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomTo(zoomLevel - 1); }
    });
    // Mouse wheel and two-finger trackpad zoom is handled natively by OrbitControls

    // ------------------------------------------------------------------ layers + sliders
    // ------------------------------------------------------------------ F9 layer control
    // Counts come from plan.counts in scene.json — never hardcoded, so they stay true if the plan changes.
    const TIERS = [
      { key: "gateway", label: "Gateway" },
      { key: "anchor",  label: "Anchor" },
      { key: "1A",      label: "1A tilt" },
      { key: "1B",      label: "1B tension" },
      { key: "1C",      label: "1C ground" },
    ];
    const DENSITY = (data.display && data.display.density_steps) || [1, 0.5, 0.25];
    const LS_KEY = "minesim.layers.v1";
    const tierOn = {};
    TIERS.forEach((t) => { tierOn[t.key] = true; });
    let densityStep = DENSITY[0];

    // Per-tier rank, so thinning keeps a spread-out subset instead of chopping off one end of the panel.
    // Deterministic (sorted by node_id), so the same nodes are drawn on every reload.
    const tierRank = new Map();
    TIERS.forEach((t) => {
      plan.nodes.map((nd, k) => [nd, k]).filter(([nd]) => nd.tier === t.key)
        .sort((a, b) => a[0].node_id - b[0].node_id)
        .forEach(([, k], i) => tierRank.set(k, i));
    });

    function loadLayerPrefs() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const o = JSON.parse(raw);
        if (o && o.tiers) TIERS.forEach((t) => { if (typeof o.tiers[t.key] === "boolean") tierOn[t.key] = o.tiers[t.key]; });
        if (DENSITY.includes(o.density)) densityStep = o.density;
      } catch (err) { /* private window, blocked storage, thumbnail capture: fall back to all-on */ }
    }
    function saveLayerPrefs() {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ tiers: tierOn, density: densityStep })); } catch (err) { /* ignore */ }
    }

    function nodeShown(nd, k) {
      if (!$("tPlan").checked) return false;
      if (!tierOn[nd.tier]) return false;
      if (densityStep >= 1) return true;
      // Gateway and anchors carry the mesh: thinning them would misrepresent the network, so only
      // the scout tiers thin out. Hiding the backbone is not decluttering, it is a wrong picture.
      if (nd.tier === "gateway" || nd.tier === "anchor") return true;
      const every = Math.round(1 / densityStep);
      return (tierRank.get(k) % every) === 0;
    }

    function applyNodeFilter() {
      net.setShown(nodeShown);
      let shown = 0;
      for (let k = 0; k < plan.nodes.length; k++) if (nodeShown(plan.nodes[k], k)) shown++;
      $("shownCount").textContent = `${shown} of ${plan.nodes.length} drawn`;
      saveLayerPrefs();
    }

    function buildLayerRows() {
      loadLayerPrefs();
      const counts = plan.counts || {};
      $("tierRowsLayers").innerHTML = TIERS.map((t) =>
        `<label class="tog"><input type="checkbox" data-tier="${t.key}"${tierOn[t.key] ? " checked" : ""} /> ${t.label} <small>${counts[t.key] != null ? counts[t.key] : 0}</small></label>`
      ).join("");
      $("tierRowsLayers").querySelectorAll("input[data-tier]").forEach((cb) => {
        cb.addEventListener("change", () => {
          tierOn[cb.dataset.tier] = cb.checked;
          // Master and tiers must never disagree: any tier switched on turns the master on.
          if (cb.checked && !$("tPlan").checked) $("tPlan").checked = true;
          applyLayers();
        });
      });
      $("density").innerHTML = DENSITY.map((d) =>
        `<option value="${d}"${d === densityStep ? " selected" : ""}>${Math.round(d * 100)}%</option>`).join("");
      $("density").addEventListener("change", () => { densityStep = +$("density").value; applyLayers(); });
      $("tPlan").addEventListener("change", () => {
        if ($("tPlan").checked) TIERS.forEach((t) => { tierOn[t.key] = true; });
        $("tierRowsLayers").querySelectorAll("input[data-tier]").forEach((cb) => { cb.checked = $("tPlan").checked && tierOn[cb.dataset.tier]; });
      });
    }

    // ------------------------------------------------------------------ F9 drawers
    // Below the breakpoints a rail becomes an overlay drawer. It is never deleted: the operator must
    // always be able to get the inspector back, which the old `#right { display: none }` did not allow.
    function syncDrawers() {
      [["right", 1100, "rightTab"], ["left", 860, "leftTab"]].forEach(([id, bp, tabId]) => {
        const rail = $(id), tab = $(tabId), collapsed = window.innerWidth <= bp;
        rail.classList.toggle("drawer", collapsed);
        tab.hidden = !collapsed;
        if (collapsed && rail.dataset.open !== "1") rail.hidden = true;
        if (!collapsed) { rail.hidden = false; delete rail.dataset.open; }
      });
    }
    [["rightTab", "right"], ["leftTab", "left"]].forEach(([tabId, id]) => {
      $(tabId).addEventListener("click", () => {
        const rail = $(id);
        if (rail.dataset.open === "1") { delete rail.dataset.open; rail.hidden = true; }
        else { rail.dataset.open = "1"; rail.hidden = false; }
      });
    });
    window.addEventListener("resize", syncDrawers);

    function applyLayers() {
      terrain.setOptions({
        sinkColours: $("tSink").checked, contours: $("tContours").checked, contourMm: +$("contourMm").value,
        roadways: $("tRoadways") ? $("tRoadways").checked : true,
        xray: $("tXray").checked, sector: $("tSector").checked,
        sag: +$("sag").value, relief: +$("relief").value,
      });
      net.colourBy = $("tProv").checked ? "prov" : "sink";
      $("provLegend").hidden = !$("tProv").checked;
      net.setVisible({ plan: $("tPlan").checked, links: $("tLinks").checked && $("tPlan").checked });
      net.scale = +$("nsize").value;
      net.refresh();
      applyNodeFilter();
      $("vchip").textContent = `vertical ×${$("sag").value}`;
      $("sagV").textContent = `×${$("sag").value}`;
    }
    ["tSink", "tContours", "contourMm", "tPlan", "tRoadways", "tLinks", "tSector", "tProv", "tXray", "relief"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", applyLayers);
    });
    ["sag", "nsize"].forEach((id) => $(id).addEventListener("input", applyLayers));

    // ------------------------------------------------------------------ simulation clock (F5)
    // The clock is simulated seconds since day 0. Playing adds real dt x sim_seconds_per_real_second_at_1x x speed.
    // Terrain and nodes are drawn at tSim / 86400 as a fractional day (daily frames, interpolated).
    const PB = data.playback;
    if (!PB) throw new Error("re-export scene.json: playback missing (F5)");
    const SPD = PB.sim_seconds_per_real_second_at_1x;
    const SPEEDS = PB.speeds;
    const DAY_S = 86400, HOUR_S = 3600;
    const maxDay = data.frames.n_days - 1;
    const tEnd = Math.min(data.run.days, maxDay) * DAY_S;
    const startMs = Date.parse(`${PB.start_date}T00:00:00Z`);
    $("day").max = maxDay;
    $("day").step = 1 / 24;
    let tSim = 0, playing = false, loop = false, last = performance.now(), dirty = true;
    let speed = PB.default_speed;
    let day = 0;                                // = tSim / DAY_S, kept for the rest of the view
    const clock = { loadingEvents: 0, loadingMs: 0, loadingSince: null, maxLoadingMs: 0 };

    const setT = (t) => { tSim = Math.max(0, Math.min(tEnd, t)); day = tSim / DAY_S; $("day").value = day; dirty = true; };
    const speedButtons = SPEEDS.map((v) => {
      const b = document.createElement("button");
      b.textContent = `${fmt(v)}×`;
      b.addEventListener("click", () => setSpeed(v));
      $("speeds").appendChild(b);
      return b;
    });
    function setSpeed(v) {
      speed = v;
      speedButtons.forEach((b, q) => b.classList.toggle("on", SPEEDS[q] === v));
      drawClock();
    }
    function setPlaying(on) {
      playing = on;
      if (playing && tSim >= tEnd) setT(0);
      $("play").textContent = playing ? "❚❚ Pause" : "▶ Play";
    }
    $("play").addEventListener("click", () => setPlaying(!playing));
    $("loop").addEventListener("click", () => { loop = !loop; $("loop").classList.toggle("on", loop); });
    $("stepBackDay").addEventListener("click", () => setT(tSim - DAY_S));
    $("stepBackHour").addEventListener("click", () => setT(tSim - HOUR_S));
    $("stepFwdHour").addEventListener("click", () => setT(tSim + HOUR_S));
    $("stepFwdDay").addEventListener("click", () => setT(tSim + DAY_S));
    $("day").addEventListener("input", () => setT(+$("day").value * DAY_S));
    window.addEventListener("keydown", (e) => {
      if (e.target !== document.body) return;
      if (e.code === "Space") { e.preventDefault(); setPlaying(!playing); }
      const q = SPEEDS.indexOf(speed);
      if (e.key === "[" && q > 0) setSpeed(SPEEDS[q - 1]);
      if (e.key === "]" && q < SPEEDS.length - 1) setSpeed(SPEEDS[q + 1]);
    });

    /** "4 h", "6 min", "41 d 16 h", "1 h 12 min", "17 s" */
    function dur(sec) {
      sec = Math.max(0, Math.round(sec));
      const d = Math.floor(sec / DAY_S), h = Math.floor((sec % DAY_S) / HOUR_S), m = Math.floor((sec % HOUR_S) / 60), s2 = sec % 60;
      if (d) return h ? `${d} d ${h} h` : `${d} d`;
      if (h) return m ? `${h} h ${m} min` : `${h} h`;
      if (m) return s2 && m < 10 ? `${m} min ${s2} s` : `${m} min`;
      return `${s2} s`;
    }
    function drawClock() {
      const when = new Date(startMs + tSim * 1000);
      const hh = String(when.getUTCHours()).padStart(2, "0"), mm = String(when.getUTCMinutes()).padStart(2, "0");
      const date = when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      $("sDay").textContent = `Day ${Math.floor(day)} · ${hh}:${mm}`;
      $("sDate").textContent = `${date} (sim) · SIMULATED`;
      $("rate").textContent = `at ${fmt(speed)}×: 1 real second = ${dur(SPD * speed)} sim · to end: ${dur((tEnd - tSim) / (SPD * speed))} real`;
    }

    let loadingShown = false;
    function setDay(d) {
      if (!terrain.setDay(d)) {
        // Frames for this day are not in memory yet: keep showing the last drawn day, never a wrong one.
        $("frameLoading").hidden = false;
        loadingShown = true;
        terrain.store.request(d).then(() => { dirty = true; });
        return false;
      }
      if (loadingShown) { $("frameLoading").hidden = true; loadingShown = false; }
      net.refresh();
      const st = terrain.stats();
      drawClock();
      $("sFace").textContent = `${fmt(terrain.faceX)} m`;
      $("sPeak").textContent = `${fmt(st.peakMm)} mm`;
      $("sArea").textContent = `${fmt(st.movingHa, 1)} ha`;
      if (plan) {
        let moving = 0;
        for (let k = 0; k < plan.nodes.length; k++) if (-net.liveDz(k) >= terrain.thresholdMm) moving++;
        $("sNodes").textContent = `${moving} / ${plan.nodes.length}`;
      }
      if (currentSegmentId === "face" && terrain.activeSegment) {
        const isolate = $("tIsolate") ? $("tIsolate").checked : true;
        const seg = getFaceSegment();
        terrain.setSegment(seg, isolate);
        net.forceIcons = terrain.segmentIsolated;
        net.segmentBounds = terrain.segmentDrawBounds;   // the face moves, so re-bind every frame
        updateSegmentStats(seg);
        if (!playing && fly.t >= 1) {
          const midX = (seg.xMin + seg.xMax) / 2;
          const gy = terrain.groundY(midX, 0);
          const targetX = terrain.sx(midX);
          const dx = targetX - controls.target.x;
          if (Math.abs(dx) > 2) {
            controls.target.x += dx;
            controls.target.y = gy - segmentCutDepth() * 0.5;
            camera.position.x += dx;
          }
        }
      } else if (currentSegmentId !== "full" && terrain.activeSegment) {
        updateSegmentStats(terrain.activeSegment);
      }
      if (net.selected) renderInspector();
      return true;
    }

    // ------------------------------------------------------------------ picking + inspector
    let downAt = null;
    renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
    /** Icons use a pixel-radius test (far zoom); 3D models use the ray (near zoom). */
    function pickAt(px, py) {
      let hit = net.pickScreen(px, py);
      if (!hit && net.lodView.modelsOn) hit = net.pick(ray);
      if (hit && hit.kind === "plan" && terrain.segmentIsolated && terrain.activeSegment && terrain.activeSegment.id !== "full") {
        const n = plan.nodes[hit.k];
        const seg = terrain.activeSegment;
        if (n.x_m < seg.xMin || n.x_m > seg.xMax || n.y_m < seg.yMin || n.y_m > seg.yMax) return null;
      }
      return hit;
    }
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
      const px = e.clientX - vRect.left, py = e.clientY - vRect.top;
      mouse.set((px / vW()) * 2 - 1, -(py / vH()) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = pickAt(px, py);
      net.select(hit);
      renderInspector();
    });
    renderer.domElement.addEventListener("pointermove", (e) => {
      const px = e.clientX - vRect.left, py = e.clientY - vRect.top;
      mouse.set((px / vW()) * 2 - 1, -(py / vH()) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const tip = $("tip");
      const hit = pickAt(px, py);
      if (hit && hit.kind === "plan") {
        const n = plan.nodes[hit.k];
        tip.textContent = `#${n.node_id} · ${n.tier} · ΔZ ${fmt(net.liveDz(hit.k))} mm`;
      } else {
        let g = ray.intersectObject(terrain.surface)[0];
        if (g && terrain.segmentIsolated && terrain.activeSegment && terrain.activeSegment.id !== "full") {
          const wx = terrain.worldX(g.point.x), wy = terrain.worldY(g.point.z);
          const seg = terrain.activeSegment;
          if (wx < seg.xMin || wx > seg.xMax || wy < seg.yMin || wy > seg.yMax) g = null;
        }
        if (!g) { tip.style.display = "none"; return; }
        const wx = terrain.worldX(g.point.x), wy = terrain.worldY(g.point.z);
        tip.textContent = `x ${fmt(wx)} m · y ${fmt(wy)} m · ground ${fmt(terrain.elevAt(wx, wy), 1)} m · ΔZ ${fmt(terrain.dzAt(wx, wy))} mm`;
      }
      tip.style.display = "block";
      tip.style.left = `${e.clientX + 14}px`;
      tip.style.top = `${e.clientY + 12}px`;
    });
    renderer.domElement.addEventListener("pointerleave", () => { $("tip").style.display = "none"; });

    function renderInspector() {
      const box = $("inspector");
      const sel = net.selected;
      if (!sel) {
        box.innerHTML = '<h3>Inspector</h3><div class="note" style="margin-top:0">Beacon = how far this spot has sunk · shape = tier · click a node to see its radio links</div>';
        return;
      }
      const row = (k, v, cls = "") => `<div class="row"><span>${k}</span><span class="${cls}">${v}</span></div>`;
      const grp = (t) => `<div class="grp">${t}</div>`;
      // A measured channel is shown only when the simulator actually wrote it: NaN means that sensor
      // reported nothing that day, and an em dash says so rather than printing a made-up 0.
      const num = (v, d, unit) => (v == null || Number.isNaN(v) ? "—" : `${fmt(v, d)} ${unit}`);
      const n = plan.nodes[sel.k];
      const dz = net.liveDz(sel.k);
      const tilt = terrain.tiltAt(n.x_m, n.y_m);
      const parent = n.parent_id != null ? plan.nodes.find((m) => m.node_id === n.parent_id) : null;
      const kids = plan.nodes.filter((m) => m.parent_id === n.node_id && n.tier === "anchor").length;
      const r = net.reading(sel.k);
      const t = net.telemetry(sel.k);
      const isScout = ["1A", "1B", "1C"].includes(n.tier);
      // Tilt arrives as two axis components in microradians; the magnitude is what an operator reads,
      // and 1 urad = 0.001 mm/m. Both are the node's own numbers — no grid lookup involved.
      const tiltMag = t && !Number.isNaN(t.tilt_x_urad) && !Number.isNaN(t.tilt_y_urad)
        ? Math.hypot(t.tilt_x_urad, t.tilt_y_urad) : NaN;
      // Anchors and the gateway are relays: they carry other nodes' packets and write no sensor row of
      // their own, so there is nothing measured to show for them.
      const measured = !isScout ? `<div class="note" style="margin-top:0">Relay only — this node carries its children's packets and writes no sensor readings.</div>`
        : !t ? `<div class="note" style="margin-top:0">Day not loaded yet — telemetry appears when the frame arrives.</div>`
        : row("Subsidence", Number.isNaN(r.mm) ? "—" : `${fmt(r.mm, 1)} mm · <i class="sw" style="background:${PROV_COLOUR[r.prov] || "#475569"}"></i> ${r.prov}`)
          + row("Tilt (magnitude)", Number.isNaN(tiltMag) ? "—" : `${fmt(tiltMag / 1000, 3)} mm/m · ${fmt(tiltMag, 0)} µrad`)
          + row("Tilt X · Y", Number.isNaN(t.tilt_x_urad) ? "—" : `${fmt(t.tilt_x_urad, 0)} · ${fmt(t.tilt_y_urad, 0)} µrad`)
          + row("Horizontal strain", num(t.strain_ustrain, 1, "µε"))
          + row("Displacement", num(t.disp_mm, 2, "mm"))
          + row("Battery", num(t.battery_mv, 0, "mV"))
          + row("Link RSSI", num(t.rssi_dbm, 1, "dBm"))
          + row("Packet delivered", t.delivered == null ? "—" : (t.delivered ? "yes" : "no"), t.delivered ? "ok" : "bad")
          + row("Parent actually used", t.parent_used == null ? "—"
              : `#${t.parent_used}${n.parent_id != null && t.parent_used !== n.parent_id ? " (failed over)" : ""}`,
              n.parent_id != null && t.parent_used != null && t.parent_used !== n.parent_id ? "warn" : "")
          + (t.via_emergency ? row("Emergency sub-slot", "in use", "warn") : "");

      box.innerHTML = `<h3>Planned node (v2)</h3>
        <div class="id">#${n.node_id}</div>
        <div class="tier">${TIER_SVG[n.tier] || ""}${TIER_NAME[n.tier]}</div>
        <div class="reason">${n.reason}</div>
        ${grp(isScout ? `Measured by this node — day ${t ? t.day : r.day}` : "Measured by this node")}
        ${measured}
        ${grp("Ground under the node — world grid")}
        ${row("Live ΔZ", `${fmt(dz)} mm`, -dz >= terrain.thresholdMm ? "warn" : "")}
        ${row("Live tilt", `${fmt(tilt, 2)} mm/m`)}
        ${grp("Planned before the run — static")}
        ${row("Peak S · strain · tilt", `${fmt(n.peak_subsidence_mm)} mm · ${fmt(n.peak_strain_ue / 1000, 2)} · ${fmt(n.peak_tilt_urad / 1000, 2)} mm/m`)}
        ${row("Ground (real DEM)", `${fmt(n.ground_m, 1)} m AMSL`)}
        ${row("Natural slope", `${fmt(n.slope_deg, 1)}°`)}
        ${row("Panel x · y", `${fmt(n.x_m, 1)} · ${fmt(n.y_m, 1)} m`)}
        ${n.lat_deg != null ? row("Lat · lon", `${n.lat_deg.toFixed(5)}° · ${n.lon_deg.toFixed(5)}°`) : ""}
        ${grp("Radio plan")}
        ${parent ? row("Parent", `#${parent.node_id} (${parent.tier})`) : row("Parent", "sink")}
        ${n.backup_parent_id != null ? row("Backup parent", `#${n.backup_parent_id}`) : ""}
        ${n.child_index != null ? row("Child index (emergency sub-slot)", n.child_index) : ""}
        ${n.tier === "anchor" ? row("Children", kids) : ""}
        ${n.link_m != null ? row("Link length", `${fmt(n.link_m)} m`) : ""}
        ${n.link_margin_db != null ? row("Free-space margin", `${fmt(n.link_margin_db, 1)} dB`) : ""}
        ${n.link_clear != null ? row("Terrain Fresnel clearance", n.link_clear ? "clear" : "blocked", n.link_clear ? "ok" : "bad") : ""}
        <button style="margin-top:10px;width:100%" id="focusBtn">Focus camera</button>`;
      $("focusBtn").onclick = () => zoomTo(LEVELS.length - 1);
    }

    // ------------------------------------------------------------------ labels
    const labelsEl = $("labels");
    const labels = [];
    const blockedLabelEls = [];
    function label(cls, text, pos) { const el = document.createElement("div"); el.className = `lbl ${cls}`; el.textContent = text; labelsEl.appendChild(el); labels.push({ el, pos }); }
    label("face", "Longwall face", () => [terrain.faceX, 0, 40]);
    if (gw) label("gw", `Gateway #${gw.node_id}`, () => [gw.x_m, gw.y_m, 10 * net.scale + 6]);
    label("under", `Seam ${fmt(geom.seam_thickness_m, 1)} m at ${fmt(geom.depth_m)} m depth`, () => [-40, W / 2 + 120, "seam"]);
    label("under", "Goaf (mined out)", () => [Math.max(0, terrain.faceX / 2), 0, "seam"]);
    label("under", `Angle of draw (r = ${fmt(geom.influence_radius_m)} m)`, () => [xS, W / 2 + (geom.influence_radius_m || 146) * 0.55, "draw"]);
    label("", "Panel 250 × 2500 m", () => [L * 0.72, W / 2, 10]);
    label("s", "Day-0 ground (dashed) vs today (white), sink ×exaggeration", () => [xS, -(W / 2 + 60), 70]);
    const v = new THREE.Vector3();
    function drawLabels() {
      const show = $("tLabels").checked;
      const xray = $("tXray").checked;
      for (const { el, pos } of labels) {
        let [x, y, h] = pos();
        const under = el.classList.contains("under");
        // A hidden node must not leave its label floating over the ground (F9).
        if (el.classList.contains("gw") && gw && !net.shown[plan.nodes.indexOf(gw)]) { el.style.display = "none"; continue; }
        const sectionOnly = el.textContent.startsWith("Day-0");
        const inSection = terrain.sectionX != null;
        const sectionOk = sectionOnly || el.textContent.startsWith("Seam") || el.textContent.startsWith("Goaf");
        if (!show || (under && !xray && !inSection) || (sectionOnly && !inSection) || (inSection && !sectionOk)) { el.style.display = "none"; continue; }
        if (terrain.segmentIsolated && terrain.activeSegment && terrain.activeSegment.id !== "full") {
          const seg = terrain.segmentDrawBounds || terrain.activeSegment;
          if (x < seg.xMin - 5 || x > seg.xMax + 5 || y < seg.yMin - 5 || y > seg.yMax + 5) { el.style.display = "none"; continue; }
        }
        let sy;
        if (h === "seam") sy = terrain.seamTopY + 25;
        if (h === "seam" && terrain.sectionX != null) { x = terrain.sectionX; }
        else if (h === "draw") sy = (terrain.seamTopY + terrain.groundY(x, y)) / 2;
        else sy = terrain.groundY(x, y) + h;
        v.set(terrain.sx(x), sy, terrain.sz(y)).project(camera);
        if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { el.style.display = "none"; continue; }
        el.style.display = "block";
        el.style.left = `${(v.x * 0.5 + 0.5) * vW()}px`;
        el.style.top = `${(-v.y * 0.5 + 0.5) * vH()}px`;
      }

      // Render blocked link labels ("terrain blocks radio")
      const blocked = net.blockedLinks || [];
      while (blockedLabelEls.length < blocked.length) {
        const el = document.createElement("div");
        el.className = "lbl blocked";
        labelsEl.appendChild(el);
        blockedLabelEls.push(el);
      }
      for (let i = 0; i < blockedLabelEls.length; i++) {
        const el = blockedLabelEls[i];
        if (i < blocked.length) {
          const item = blocked[i];
          el.textContent = item.text;
          v.set(item.mid[0], item.mid[1] + 1.5, item.mid[2]).project(camera);
          if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
            el.style.display = "none";
          } else {
            el.style.display = "block";
            el.style.left = `${(v.x * 0.5 + 0.5) * vW()}px`;
            el.style.top = `${(-v.y * 0.5 + 0.5) * vH()}px`;
          }
        } else {
          el.style.display = "none";
        }
      }
    }

    // Floating cluster badge count labels removed per request; individual nodes are always rendered distinctly
    const badgesEl = $("badges");
    const badgeEls = [];
    function drawBadges() {
      if (badgeEls.length > 0) {
        badgeEls.forEach((el) => { el.style.display = "none"; });
      }
    }
    // Compass: north from the panel bearing (advance_direction_deg, CCW from east). Site bearing is OPEN — VERIFY.
    const theta = THREE.MathUtils.degToRad(geom.advance_direction_deg || 0);
    const NORTH = new THREE.Vector2(Math.sin(theta), -Math.cos(theta));   // scene (x, z)
    const ADVANCE = new THREE.Vector2(1, 0);
    let hudKey = "";
    function drawHud() {
      const w = viewWidth();
      zoomLevel = nearestLevel(w);
      const mpp = w / vW();
      const lens = Z.scale_bar_lengths_m;
      let len = lens[0];
      for (const L of lens) if (L / mpp <= Z.scale_bar_max_px) len = L;
      const f = new THREE.Vector2(controls.target.x - camera.position.x, controls.target.z - camera.position.z);
      if (f.lengthSq() < 1e-9) f.set(0, -1);
      f.normalize();
      const r = new THREE.Vector2(-f.y, f.x);
      const ang = (d) => THREE.MathUtils.radToDeg(Math.atan2(d.dot(r), d.dot(f)));
      const key = `${Math.round(w)}|${len}|${Math.round(ang(NORTH))}|${zoomLevel}`;
      if (key === hudKey) return;
      hudKey = key;
      $("scaleLine").style.width = `${len / mpp}px`;
      $("scaleTxt").textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
      $("zoomChip").textContent = `view ≈ ${fmt(w >= 1000 ? Math.round(w / 10) * 10 : Math.round(w))} m wide · zoom ${zoomLevel + 1}/${LEVELS.length}`;
      $("cmpN").setAttribute("transform", `rotate(${ang(NORTH)} 30 30)`);
      $("cmpA").setAttribute("transform", `rotate(${ang(ADVANCE)} 30 30)`);
    }

    // ------------------------------------------------------------------ loop
    // A window 'resize' event does NOT fire when a rail collapses or a drawer opens, but the canvas
    // must re-fit for both. Observing #viewport catches every case, the window resize included.
    function refreshCanvas() {
      vRect = view.getBoundingClientRect();
      camera.aspect = vW() / vH();
      camera.updateProjectionMatrix();
      // updateStyle must stay on: passing false resizes only the drawing buffer and leaves the
      // canvas's CSS box at its previous size, which desynchronises it from the grid cell.
      renderer.setSize(vW(), vH());
      applyZoomLimits();
    }
    new ResizeObserver(refreshCanvas).observe(view);
    // The slider owns net.scale from the first applyLayers, so its opening value is where
    // node_models.visual_scale lands — otherwise the config value is overwritten before first paint.
    const initNsize = new URLSearchParams(location.search).get("nsize");
    if (initNsize != null) $("nsize").value = initNsize;
    else if (data.node_models && data.node_models.visual_scale != null) $("nsize").value = data.node_models.visual_scale;
    buildLayerRows();
    syncDrawers();
    applyLayers();
    const q0 = new URLSearchParams(location.search);
    const initDay = +(q0.get("day") || PB.initial_day);
    setT(initDay * DAY_S);
    terrain.faceX = Math.min(data.panel.advance_m_per_day * initDay, data.panel.length_m);
    const wantSpeed = q0.get("speed") != null ? +q0.get("speed") : PB.default_speed;
    setSpeed(SPEEDS.reduce((best, v) => (Math.abs(Math.log(v / wantSpeed)) < Math.abs(Math.log(best / wantSpeed)) ? v : best), SPEEDS[0]));
    if (q0.get("play") === "1") setPlaying(true);
    setDay(day);
    cam(new URLSearchParams(location.search).get("cam") || "overview", true);

    const initSelect = new URLSearchParams(location.search).get("select");
    if (initSelect != null && plan) {
      const selId = parseInt(initSelect, 10);
      const selK = plan.nodes.findIndex((n) => n.node_id === selId);
      if (selK >= 0) {
        net.select({ kind: "plan", k: selK });
        renderInspector();
      }
    }

    const initSeg = new URLSearchParams(location.search).get("seg");
    if (initSeg != null) {
      selectSegment(initSeg, true);
    }

    const qs = new URLSearchParams(location.search);
    if (qs.get("zoom") != null) zoomTo(+qs.get("zoom"), undefined, true);
    else if (qs.get("cam") == null && initSeg == null) zoomTo(Z.default_level, controls.target.clone(), true);

    $("loading").remove();
    window.__mine = {
      terrain, net, cam, camera,
      selectSegment, get segments() { return segments; }, get currentSegment() { return currentSegmentId; },
      select: (sel) => { net.select(sel); renderInspector(); },
      setDay: (d) => setT(d * DAY_S),
      get clock() {
        return { tSim, day, speed, playing, loop, tEnd, loadingEvents: clock.loadingEvents, loadingMs: clock.loadingMs,
          maxLoadingMs: clock.maxLoadingMs, loading: clock.loadingSince != null, chunkLoads: terrain.store.loads };
      },
      setSpeed, setPlaying, setLoop: (on) => { loop = on; $("loop").classList.toggle("on", loop); },
      zoomTo, viewWidth, levels: LEVELS, get zoomLevel() { return zoomLevel; }, fps: 0,
    };

    let lastUpdate = 0, fpsFrames = 0, fpsT0 = performance.now();
    function frame(now) {
      const dtReal = (now - last) / 1000;
      const dt = Math.min(PB.max_frame_dt_s, dtReal);
      last = now;
      if (playing) {
        const rate = SPD * speed;
        let next = tSim + dt * rate;
        if (next >= tEnd) next = loop ? 0 : tEnd;
        // Prefetch the next chunk once play is within prefetch_days of its start (or prefetch_real_s of play
        // at this speed, whichever is further).
        const ahead = Math.max(PB.prefetch_days, (rate * PB.prefetch_real_s) / DAY_S);
        const nextChunkDay = (terrain.store.chunkOf(next / DAY_S) + 1) * data.frames.chunk_days;
        if (nextChunkDay <= maxDay && nextChunkDay - next / DAY_S <= ahead) terrain.store.request(nextChunkDay);
        if (terrain.store.isReady(next / DAY_S)) {
          if (clock.loadingSince != null) {
            const held = now - clock.loadingSince;
            clock.loadingMs += held; clock.maxLoadingMs = Math.max(clock.maxLoadingMs, held); clock.loadingSince = null;
          }
          setT(next);
          if (tSim >= tEnd && !loop) setPlaying(false);
        } else {
          // Hold on the last drawn frame (and the clock) until the chunk arrives: never show a wrong day.
          if (clock.loadingSince == null) { clock.loadingSince = now; clock.loadingEvents++; }
          terrain.store.request(next / DAY_S);
          $("frameLoading").hidden = false;
          loadingShown = true;
        }
      }
      if (dirty && now - lastUpdate > 1000 / PB.ui_update_hz) { if (setDay(day)) dirty = false; lastUpdate = now; }
      if (fly.t < 1) {
        fly.t = Math.min(1, fly.t + Math.min(0.1, dtReal) / Z.fly_seconds);
        const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
        camera.position.lerpVectors(fly.from.p, fly.to.p, e);
        controls.target.lerpVectors(fly.from.q, fly.to.q, e);
      } else if (playing && currentSegmentId === "face" && terrain.activeSegment && terrain.activeSegment.id !== "full") {
        const midX = (terrain.activeSegment.xMin + terrain.activeSegment.xMax) / 2;
        const gy = terrain.groundY(midX, 0);
        const dx = terrain.sx(midX) - controls.target.x;
        if (Math.abs(dx) > 80) {
          controls.target.x += dx;
          controls.target.y = gy;
          camera.position.x += dx;
        } else {
          controls.target.x += dx * 0.08;
          controls.target.y = THREE.MathUtils.lerp(controls.target.y, gy, 0.08);
          camera.position.x += dx * 0.08;
        }
      }
      controls.update();
      const camDist = camera.position.distanceTo(controls.target);
      camera.near = camDist * Z.near_clip_factor;
      camera.far = Z.far_clip_m;
      camera.updateProjectionMatrix();
      scene.fog.near = camDist * Z.fog_near_factor;
      scene.fog.far = camDist * Z.fog_far_factor;
      net.updateLod(camera, viewWidth(), vW(), vH(), renderer.getPixelRatio());
      net.updateCamera(camera);
      renderer.render(scene, camera);
      drawLabels();
      drawBadges();
      drawHud();
      fpsFrames++;
      if (now - fpsT0 >= 1000) { window.__mine.fps = Math.round((fpsFrames * 1000) / (now - fpsT0)); fpsFrames = 0; fpsT0 = now; }
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
})();
