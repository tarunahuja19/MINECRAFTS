/**
 * network.js — sensor network drawn on the live ground.
 *
 * Planned network (v2, scene.plan from minesim.placement): every node stands on the real terrain and
 * sinks with it. True-size 3D models (scale 1.0 default) with distinct physical silhouettes for all
 * five tiers.
 * - 1A tilt scout: slim stake + round tilt-meter capsule + small tilted solar plate (Teal)
 * - 1B strain-rod scout: square pad + box enclosure + 10 m rod + pin (Amber)
 * - 1C wire-extensometer scout: two short posts 30 m apart joined by thin taut wire + enclosure (Red)
 * - Anchor: mast + router box + whip antenna + hexagonal pad (Blue)
 * - Gateway: lattice tower + dish (White)
 *
 * Beacon shows live sink depth ramp (grey below detection threshold).
 * Links are click-to-view (solid primary, dashed backup, straight gateway, red if blocked).
 * All radio links (debug) layer is off by default.
 */
(function (global) {
  "use strict";

  const TIER_COLOUR = { "1A": "#00f0ff", "1B": "#ffb703", "1C": "#ff3366", anchor: "#3a86ff", gateway: "#ffffff" };
  const PROV_COLOUR = { real: "#10b981", pinned: "#f59e0b", synthetic: "#38bdf8", undelivered: "#9ca3af" };
  const TIER_NAME = {
    "1A": "Scout 1A · tilt", "1B": "Scout 1B · strain rod + pot", "1C": "Scout 1C · wire extensometer",
    anchor: "Anchor · cluster router", gateway: "Gateway · RTK base + sink",
  };
  const STILL = new THREE.Color("#9aa3ad");

  class MineNetwork {
    constructor(scene3, terrain, data) {
      this.scene3 = scene3;
      this.t = terrain;
      this.data = data;
      this.plan = data.plan ? data.plan.nodes : [];
      this.byId = new Map(this.plan.map((n, k) => [n.node_id, k]));

      if (!data.node_models) {
        throw new Error("re-export scene.json: node_models missing");
      }
      const nm = data.node_models;
      this.models = nm;
      if (!nm.antenna_height_m || nm.antenna_height_m.scout == null || nm.antenna_height_m.anchor == null || nm.antenna_height_m.gateway == null) {
        throw new Error("re-export scene.json: node_models.antenna_height_m missing");
      }
      this.antH = nm.antenna_height_m;
      if (nm.strain_rod_baseline_m == null) throw new Error("re-export scene.json: node_models.strain_rod_baseline_m missing");
      this.rodLen = nm.strain_rod_baseline_m;
      if (nm.extensometer_baseline_m == null) throw new Error("re-export scene.json: node_models.extensometer_baseline_m missing");
      this.extLen = nm.extensometer_baseline_m;
      if (nm.detail_distance_m == null) throw new Error("re-export scene.json: node_models.detail_distance_m missing");
      this.detailDistance = nm.detail_distance_m;
      if (nm.pick_radius_m == null) throw new Error("re-export scene.json: node_models.pick_radius_m missing");
      this.pickRadius = nm.pick_radius_m;
      if (!nm.backup_dash_m) throw new Error("re-export scene.json: node_models.backup_dash_m missing");
      this.backupDash = nm.backup_dash_m;
      if (!nm.selection_ring_m) throw new Error("re-export scene.json: node_models.selection_ring_m missing");
      this.selectionRing = nm.selection_ring_m;

      // Visual scale of every node model. Not physical: a true-size 0.6 m tilt scout is sub-pixel at
      // the 250 m segment view, so the models are drawn oversized on purpose (Adarsh, 16 Sep).
      this.scale = nm.visual_scale != null ? nm.visual_scale : 2.2;
      // Node footprint sampled for the stand height, and the lift above it. A model placed on the
      // ground height of its centre buries its uphill side on any slope; standing every node on the
      // HIGHEST ground under its footprint (plus this clearance) makes it sit on the hill instead.
      this.standSampleR = nm.stand_sample_r_m != null ? nm.stand_sample_r_m : 3.0;
      this.standClearanceM = nm.stand_clearance_m != null ? nm.stand_clearance_m : 0.25;
      this.showDebugLinks = false;
      this.forceIcons = false;      // set by app.js while a segment is isolated (see updateLod)
      this.segmentBounds = null;    // {xMin,xMax,yMin,yMax} while a segment is isolated, else null
      this.blockedLinks = [];

      this.group = new THREE.Group();
      scene3.add(this.group);
      this.colourBy = "sink";           // "sink" = live depth ramp; "prov" = provenance of the day's nodes.csv reading
      this.selected = null;

      if (!data.zoom) throw new Error("re-export scene.json: zoom missing");
      this.zoomCfg = data.zoom;
      this.lodView = { iconsOn: false, modelsOn: true, opacity: 0 };
      this.clusters = [];

      this._build();
      this._buildIcons();
    }

    // ---------------------------------------------------------------- far-zoom icons (F2)
    /** Sprite per tier: red channel = fill mask, green channel = outline mask (tinted in the shader). */
    static iconTexture(tier) {
      const N = 64, c = document.createElement("canvas");
      c.width = c.height = N;
      const g = c.getContext("2d");
      const m = N / 2, R = N / 2 - 8;
      const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], q) => (q ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
      const ring = (n, r, rot, inner) => Array.from({ length: n * (inner ? 2 : 1) }, (_, q) => {
        const rr = inner && q % 2 ? inner : r;
        const a = rot + (q * 2 * Math.PI) / (n * (inner ? 2 : 1));
        return [m + rr * Math.cos(a), m + rr * Math.sin(a)];
      });
      g.lineJoin = "round";
      if (tier === "1A") {
        // Upward Triangle (Tilt)
        poly(ring(3, R, -Math.PI / 2));
      } else if (tier === "1B") {
        // Rotated Diamond / Square (Strain)
        poly(ring(4, R * 1.05, Math.PI / 4));
      } else if (tier === "1C") {
        // Barbell / Twin anchor with horizontal span (Wire Extensometer)
        g.beginPath();
        g.arc(m - R * 0.55, m, R * 0.38, 0, Math.PI * 2);
        g.arc(m + R * 0.55, m, R * 0.38, 0, Math.PI * 2);
        g.rect(m - R * 0.55, m - R * 0.15, R * 1.1, R * 0.3);
      } else if (tier === "anchor") {
        // Bold Hexagon with inner core (Anchor Hub)
        poly(ring(6, R, 0));
      } else {
        // 5-point Star (Gateway)
        poly(ring(5, R, -Math.PI / 2, R * 0.45));
      }
      g.fillStyle = "#ff0000"; g.fill();
      g.lineWidth = 10; g.strokeStyle = "#00ff00"; g.stroke();

      // For anchor, add inner core dot
      if (tier === "anchor") {
        g.beginPath();
        g.arc(m, m, R * 0.28, 0, Math.PI * 2);
        g.fillStyle = "#ff0000"; g.fill();
        g.lineWidth = 4; g.strokeStyle = "#00ff00"; g.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.flipY = false;
      return tex;
    }

    _buildIcons() {
      const tiers = ["1A", "1B", "1C", "anchor", "gateway"];
      this.iconLayers = tiers.map((tier) => {
        const idxs = this.plan.map((n, k) => (n.tier === tier ? k : -1)).filter((k) => k >= 0);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, idxs.length) * 3), 3));
        geo.setAttribute("aOutline", new THREE.BufferAttribute(new Float32Array(Math.max(1, idxs.length) * 3), 3));
        geo.setAttribute("aScale", new THREE.BufferAttribute(new Float32Array(Math.max(1, idxs.length)), 1));
        geo.setDrawRange(0, idxs.length);
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            map: { value: MineNetwork.iconTexture(tier) }, uTier: { value: new THREE.Color(TIER_COLOUR[tier]) },
            uSize: { value: 1 }, uOpacity: { value: 1 },
          },
          vertexShader: [
            "attribute vec3 aOutline; attribute float aScale; uniform float uSize; varying vec3 vOutline; varying float vScale;",
            "void main() { vOutline = aOutline; vScale = aScale;",
            "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize * aScale; }",
          ].join("\n"),
          fragmentShader: [
            "uniform sampler2D map; uniform vec3 uTier; uniform float uOpacity; varying vec3 vOutline; varying float vScale;",
            "void main() { if (vScale <= 0.0) discard; vec4 t = texture2D(map, gl_PointCoord);",
            "  float a = t.a * uOpacity; if (a < 0.04) discard;",
            "  gl_FragColor = vec4(uTier * t.r + vOutline * t.g, a); }",
          ].join("\n"),
          transparent: true, depthTest: false, depthWrite: false,
        });
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        points.renderOrder = 20;
        points.visible = false;
        this.scene3.add(points);
        return { tier, idxs, points };
      });
      this.iconColour = new Float32Array(this.plan.length * 3);
      this.iconHidden = new Uint8Array(this.plan.length);
      // F9 layer control: 1 = this node may be drawn, 0 = the operator switched its tier off or
      // thinned it out. This is a VIEW filter only. It never touches scene.json, plan.counts, the
      // hardware cost or any reported statistic — hiding a node must not change what we claim the
      // network is. Default: everything shown.
      this.shown = new Uint8Array(this.plan.length).fill(1);
    }

    /** World (scene) position of a node's icon: on the live ground at antenna height. */
    iconPos(k, out) {
      const n = this.plan[k];
      return out.set(this.t.sx(n.x_m), this.antennaTop(n, k), this.t.sz(n.y_m));
    }

    /**
     * Level of detail from the visible ground width (m): icons above zoom.icon_above_view_m, models at or
     * below it, icons fading out down to zoom.models_below_view_m. Icons within icon_px of each other on
     * screen merge into a count badge (this.clusters). Call once per frame after the camera moves.
     */
    updateLod(camera, viewW, widthPx, heightPx, pixelRatio) {
      const z = this.zoomCfg, show = this.group.visible && this.plan.length > 0;
      const above = z.icon_above_view_m, below = z.models_below_view_m;
      const eps = 1e-3;                                   // a level's width equals its threshold exactly
      // forceIcons: while a 250 m segment is isolated the camera sits inside the models-only band, where a
      // true-size node is a few pixels of rock-coloured geometry. Icons are screen-space constant size, so
      // keeping them on there is what makes "which nodes are in this block" readable at all.
      // Icons are on at EVERY zoom (Adarsh, 16 Sep: "nodes are not visible until we zoom in"). They are
      // screen-space sprites, so they mark where every node is from the 8 km overview down to the 60 m
      // walk-up, while the 3D models fade in underneath them below zoom.icon_above_view_m.
      const iconsOn = show;
      const modelsOn = viewW <= above * (1 + eps);
      const opacity = 1;
      this.lodView = { iconsOn, modelsOn, opacity };
      for (const { m } of this.parts) if (m !== this.hit) m.visible = modelsOn;
      if (this.extensometerWires && !modelsOn) this.extensometerWires.visible = false;

      this.clusters = [];
      this.iconHidden.fill(0);
      for (let k = 0; k < this.shown.length; k++) if (!this.shown[k]) this.iconHidden[k] = 1;
      const P = this.plan, v = new THREE.Vector3();
      this.screen = this.screen && this.screen.length === P.length * 2 ? this.screen : new Float32Array(P.length * 2);
      const onScreen = new Uint8Array(P.length);
      for (let k = 0; k < P.length; k++) {
        this.iconPos(k, v).project(camera);
        this.screen[2 * k] = (v.x * 0.5 + 0.5) * widthPx;
        this.screen[2 * k + 1] = (-v.y * 0.5 + 0.5) * heightPx;
        onScreen[k] = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05 ? 1 : 0;
      }
      // Individual nodes always rendered with distinct tier icons (no clumping count badges)
      const sel = this.selected && this.selected.kind === "plan" ? this.selected.k : -1;
      // Icons are screen-space sprites, so the renderer's clipping planes (which do cut the terrain and
      // the 3D node models) leave them floating in the void outside an isolated segment. Cull them here
      // against the segment's own bounds: an isolated block shows only the nodes standing on it.
      const sb = this.segmentBounds;
      for (const L of this.iconLayers) {
        L.points.visible = iconsOn && L.idxs.length > 0;
        if (!L.points.visible) continue;
        const pos = L.points.geometry.attributes.position, col = L.points.geometry.attributes.aOutline, sc = L.points.geometry.attributes.aScale;
        L.idxs.forEach((k, q) => {
          this.iconPos(k, v);
          pos.array[3 * q] = v.x; pos.array[3 * q + 1] = v.y; pos.array[3 * q + 2] = v.z;
          col.array[3 * q] = this.iconColour[3 * k]; col.array[3 * q + 1] = this.iconColour[3 * k + 1]; col.array[3 * q + 2] = this.iconColour[3 * k + 2];
          const n = P[k];
          const culled = sb && (n.x_m < sb.xMin || n.x_m > sb.xMax || n.y_m < sb.yMin || n.y_m > sb.yMax);
          sc.array[q] = culled ? 0 : (this.iconHidden[k] && k !== sel ? 0 : (k === sel ? 1.6 : 1));
        });
        pos.needsUpdate = true; col.needsUpdate = true; sc.needsUpdate = true;
        L.points.material.uniforms.uSize.value = z.icon_px * pixelRatio;
        L.points.material.uniforms.uOpacity.value = opacity;
      }
    }

    /** Nearest drawn icon within zoom.pick_px of a screen point (CSS px), or null. */
    pickScreen(px, py) {
      if (!this.lodView.iconsOn || !this.screen) return null;
      let best = null, bestD = this.zoomCfg.pick_px;
      for (let k = 0; k < this.plan.length; k++) {
        if (this.iconHidden[k]) continue;
        const d = Math.hypot(this.screen[2 * k] - px, this.screen[2 * k + 1] - py);
        if (d <= bestD) { best = { kind: "plan", k, d: 0 }; bestD = d; }
      }
      return best;
    }

    /** Cluster badge under a screen point, or null. */
    pickCluster(px, py, radiusPx) {
      for (const c of this.clusters) if (Math.hypot(c.sx - px, c.sy - py) <= radiusPx) return c;
      return null;
    }

    _instanced(geo, mat, idxs) {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, idxs.length));
      m.count = idxs.length;
      m.userData.idxs = idxs;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    }

    _build() {
      const P = this.plan;
      const byTier = (pred) => P.map((n, k) => (pred(n) ? k : -1)).filter((k) => k >= 0);
      const t1A = byTier((n) => n.tier === "1A");
      const t1B = byTier((n) => n.tier === "1B");
      const t1C = byTier((n) => n.tier === "1C");
      const anchors = byTier((n) => n.tier === "anchor");
      const gws = byTier((n) => n.tier === "gateway");
      const all = P.map((_, k) => k);

      const metal = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.45, metalness: 0.7 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.5 });
      const white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.6 });
      const yellow = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 });
      const mat1A = new THREE.MeshStandardMaterial({ color: TIER_COLOUR["1A"], roughness: 0.35, metalness: 0.3 });
      const mat1B = new THREE.MeshStandardMaterial({ color: TIER_COLOUR["1B"], roughness: 0.35, metalness: 0.3 });
      const mat1C = new THREE.MeshStandardMaterial({ color: TIER_COLOUR["1C"], roughness: 0.35, metalness: 0.3 });
      const matAnchor = new THREE.MeshStandardMaterial({ color: TIER_COLOUR["anchor"], roughness: 0.35, metalness: 0.4 });

      this.parts = [];
      const add = (geo, mat, idxs, place) => {
        const m = this._instanced(geo, mat, idxs);
        this.parts.push({ m, place });
        return m;
      };

      const antScout = this.antH.scout;
      const antAnchor = this.antH.anchor;
      const antGw = this.antH.gateway;
      const padCfg = this.models.pad;
      const t1aCfg = this.models.tier_1a;
      const t1bCfg = this.models.tier_1b;
      const t1cCfg = this.models.tier_1c;
      const ancCfg = this.models.anchor;
      const gwCfg = this.models.gateway;
      const bcnCfg = this.models.beacon;

      // ----------------- Pads per tier (showing tier colour) -----------------
      // 1A pad: round cylinder (teal/cyan)
      const p1a_r = padCfg.scout_radius_m, p1a_h = padCfg.scout_height_m;
      this.pad1A = add(new THREE.CylinderGeometry(p1a_r, p1a_r, p1a_h, 12),
        new THREE.MeshStandardMaterial({ color: TIER_COLOUR["1A"], roughness: 0.5 }), t1A, () => ({ y: p1a_h / 2 }));

      // 1B pad: square box pad (amber)
      const p1b_s = t1bCfg.pad_size_m, p1b_h = padCfg.scout_height_m;
      this.pad1B = add(new THREE.BoxGeometry(p1b_s, p1b_h, p1b_s),
        new THREE.MeshStandardMaterial({ color: TIER_COLOUR["1B"], roughness: 0.5 }), t1B, () => ({ y: p1b_h / 2 }));

      // 1C pad: round pad (ruby)
      this.pad1C = add(new THREE.CylinderGeometry(p1a_r, p1a_r, p1a_h, 12),
        new THREE.MeshStandardMaterial({ color: TIER_COLOUR["1C"], roughness: 0.5 }), t1C, () => ({ y: p1a_h / 2 }));

      // Anchor pad: hexagonal pad (blue)
      const anc_pr = padCfg.anchor_radius_m, anc_ph = padCfg.anchor_height_m;
      this.padAnchor = add(new THREE.CylinderGeometry(anc_pr, anc_pr, anc_ph, 6),
        new THREE.MeshStandardMaterial({ color: TIER_COLOUR["anchor"], roughness: 0.5 }), anchors, () => ({ y: anc_ph / 2 }));

      // Gateway pad: round concrete pad (white)
      const gw_pr = padCfg.gateway_radius_m, gw_ph = padCfg.gateway_height_m;
      this.padGateway = add(new THREE.CylinderGeometry(gw_pr, gw_pr, gw_ph, 16),
        new THREE.MeshStandardMaterial({ color: TIER_COLOUR["gateway"], roughness: 0.5 }), gws, () => ({ y: gw_ph / 2 }));

      // ----------------- 1A Tilt Scout Model -----------------
      // slim stake + small round tilt-meter capsule + small tilted solar plate
      const st_r = t1aCfg.stake_radius_m;
      add(new THREE.CylinderGeometry(st_r, st_r, antScout, 6), metal, t1A, () => ({ y: antScout / 2 }));
      const cap_r = t1aCfg.capsule_radius_m, cap_h = t1aCfg.capsule_height_m;
      add(new THREE.CylinderGeometry(cap_r, cap_r, cap_h, 12), mat1A, t1A, () => ({ y: antScout * 0.55 }));
      const sp = t1aCfg.solar_plate_m;
      const sp_tilt = t1aCfg.tilt_deg * (Math.PI / 180);
      add(new THREE.BoxGeometry(sp[0], sp[1], sp[2]), mat1A, t1A, () => ({ y: antScout * 0.85, rx: -sp_tilt }));

      // ----------------- 1B Strain-Rod Scout Model -----------------
      // square pad + box enclosure + 10 m rod lying flat on the ground + pin at far end
      const b1b = t1bCfg.box_size_m;
      const ant_stake_b = t1bCfg.antenna_stake_radius_m;
      add(new THREE.BoxGeometry(b1b[0], b1b[1], b1b[2]), mat1B, t1B, () => ({ y: p1b_h + b1b[1] / 2 }));
      add(new THREE.CylinderGeometry(ant_stake_b, ant_stake_b, antScout, 6), metal, t1B, () => ({ y: antScout / 2, ox: b1b[0] / 2 }));
      // 10 m rod lying flat on the ground along x (true baseline: fixed length 10m, center at rodLen/2)
      const rod_r = t1bCfg.rod_radius_m;
      add(new THREE.CylinderGeometry(rod_r, rod_r, this.rodLen, 6).rotateZ(Math.PI / 2), white, t1B,
        () => ({ y: p1b_h / 2 + rod_r, baseOx: this.rodLen / 2, fixedSx: 1 }));
      // pin at far end of rod (true baseline: at x + rodLen)
      const pin_r = t1bCfg.pin_radius_m, pin_h = t1bCfg.pin_height_m;
      add(new THREE.CylinderGeometry(pin_r, pin_r, pin_h, 8), yellow, t1B,
        () => ({ y: pin_h / 2, baseOx: this.rodLen }));

      // ----------------- 1C Wire-Extensometer Scout Model -----------------
      // two short posts 30 m apart joined by thin taut wire at post height, bigger enclosure on first post
      const post_r = t1cCfg.post_radius_m, post_h = t1cCfg.post_height_m;
      const b1c = t1cCfg.box_size_m;
      const ant_stake_c = t1cCfg.antenna_stake_radius_m;
      const [disc_r, disc_h] = t1cCfg.post2_disc_m;
      // Post 1 + big enclosure + antenna
      add(new THREE.CylinderGeometry(post_r, post_r, post_h, 6), metal, t1C, () => ({ y: post_h / 2 }));
      add(new THREE.BoxGeometry(b1c[0], b1c[1], b1c[2]), mat1C, t1C, () => ({ y: post_h + b1c[1] / 2 }));
      add(new THREE.CylinderGeometry(ant_stake_c, ant_stake_c, antScout, 6), metal, t1C, () => ({ y: antScout / 2, ox: b1c[0] / 2 }));
      // Post 2 at 30 m baseline
      add(new THREE.CylinderGeometry(post_r, post_r, post_h, 6), metal, t1C, () => ({ y: post_h / 2, baseOx: this.extLen }));
      add(new THREE.CylinderGeometry(disc_r, disc_r, disc_h, 6), mat1C, t1C, () => ({ y: disc_h / 2, baseOx: this.extLen }));

      // Thin taut wire (part of sensor, not radio link; LOD checked with camera distance)
      const wireGeo = new THREE.BufferGeometry();
      const wirePos = new Float32Array(t1C.length * 6);
      this.wirePosAttr = wirePos;
      wireGeo.setAttribute("position", new THREE.BufferAttribute(wirePos, 3));
      this.extensometerWires = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({
        color: TIER_COLOUR["1C"], transparent: true, opacity: 0.95,
      }));
      this.group.add(this.extensometerWires);
      this.extensometerWires.visible = true;

      // ----------------- Anchor Model -----------------
      // mast + router box + whip antenna
      const mast_r = ancCfg.mast_radius_m;
      add(new THREE.CylinderGeometry(mast_r, mast_r, antAnchor, 8), metal, anchors, () => ({ y: antAnchor / 2 }));
      const abox = ancCfg.router_box_m;
      add(new THREE.BoxGeometry(abox[0], abox[1], abox[2]), matAnchor, anchors, () => ({ y: antAnchor * 0.6 }));
      const whip_l = ancCfg.whip_length_m, whip_r = ancCfg.whip_radius_m;
      add(new THREE.CylinderGeometry(whip_r, whip_r, whip_l, 6), white, anchors, () => ({ y: antAnchor + whip_l / 2 }));

      // ----------------- Gateway Model -----------------
      // lattice tower (10 m) + dish
      const leg_r = gwCfg.leg_radius_m;
      const base_w = gwCfg.base_width_m / 2;
      const top_w = gwCfg.top_width_m / 2;
      const brace_r = gwCfg.brace_radius_m;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

      // 4 lattice legs at (±, ±), tapered from base_width_m to top_width_m
      corners.forEach(([sx, sz]) => {
        const dx = sx * (top_w - base_w);
        const dy = antGw;
        const dz = sz * (top_w - base_w);
        const L_leg = Math.hypot(dx, dy, dz);
        const qLeg = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(dx, dy, dz).normalize()
        );
        add(new THREE.CylinderGeometry(leg_r, leg_r, L_leg, 6), metal, gws, () => ({
          y: antGw / 2,
          ox: sx * (base_w + top_w) / 2,
          oz: sz * (base_w + top_w) / 2,
          q: qLeg,
        }));
      });

      // Lattice cross bracing: 2 levels with X-bracing and horizontal ties
      const yLevels = [0.2, antGw * 0.5, antGw * 0.98];
      const cornerAt = (idx, y) => {
        const w = base_w + (top_w - base_w) * (y / antGw);
        return [corners[idx][0] * w, corners[idx][1] * w];
      };
      for (let b = 0; b < yLevels.length - 1; b++) {
        const ya = yLevels[b], yb = yLevels[b + 1];
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          const [cAx0, cAz0] = cornerAt(i, ya), [cBx0, cBz0] = cornerAt(j, ya);
          const [cAx1, cAz1] = cornerAt(i, yb), [cBx1, cBz1] = cornerAt(j, yb);

          // Horizontal tie at upper level yb
          const hdx = cBx1 - cAx1, hdz = cBz1 - cAz1;
          const hLen = Math.hypot(hdx, hdz);
          const qH = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(hdx, 0, hdz).normalize()
          );
          add(new THREE.CylinderGeometry(brace_r, brace_r, hLen, 4), metal, gws, () => ({
            y: yb,
            ox: (cAx1 + cBx1) / 2,
            oz: (cAz1 + cBz1) / 2,
            q: qH,
          }));

          // Diagonal 1: corner A (ya) -> corner B (yb)
          const d1x = cBx1 - cAx0, d1y = yb - ya, d1z = cBz1 - cAz0;
          const len1 = Math.hypot(d1x, d1y, d1z);
          const q1 = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(d1x, d1y, d1z).normalize()
          );
          add(new THREE.CylinderGeometry(brace_r, brace_r, len1, 4), metal, gws, () => ({
            y: (ya + yb) / 2,
            ox: (cAx0 + cBx1) / 2,
            oz: (cAz0 + cBz1) / 2,
            q: q1,
          }));

          // Diagonal 2: corner B (ya) -> corner A (yb)
          const d2x = cAx1 - cBx0, d2y = yb - ya, d2z = cAz1 - cBz0;
          const len2 = Math.hypot(d2x, d2y, d2z);
          const q2 = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(d2x, d2y, d2z).normalize()
          );
          add(new THREE.CylinderGeometry(brace_r, brace_r, len2, 4), metal, gws, () => ({
            y: (ya + yb) / 2,
            ox: (cBx0 + cAx1) / 2,
            oz: (cBz0 + cAz1) / 2,
            q: q2,
          }));
        }
      }

      // Tower platform at top
      add(new THREE.BoxGeometry(top_w * 2, 0.1, top_w * 2), metal, gws, () => ({ y: antGw }));

      // Dish at tower top: open shallow cone (reads as a dish from any angle), facing outward horizontally
      const dish_r = gwCfg.dish_radius_m;
      const [dishDepthFrac, dishDropM, feedR] = [gwCfg.dish_depth_frac, gwCfg.dish_drop_m, gwCfg.feed_radius_m];
      const dishDir = new THREE.Vector3(1, 0, 0);
      const qDish = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dishDir);
      const dishMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide });
      const dishDepth = dish_r * dishDepthFrac;
      const dishY = antGw - dishDropM;
      const dishX = top_w + dishDepth / 2;
      add(new THREE.CylinderGeometry(dish_r, dish_r * 0.2, dishDepth, 28, 1, true), dishMat, gws, () => ({ y: dishY, ox: dishX, q: qDish }));
      // feed boom from dish centre outward
      const feedLen = dish_r * 0.9;
      add(new THREE.CylinderGeometry(feedR, feedR, feedLen, 6), metal, gws, () => ({ y: dishY, ox: top_w + feedLen / 2, q: qDish }));
      add(new THREE.SphereGeometry(feedR * 3, 8, 6), dark, gws, () => ({ y: dishY, ox: top_w + feedLen }));

      // ----------------- Beacons (live sink colour) -----------------
      const bcn_r = bcnCfg.radius_m;
      this.beacons = add(new THREE.SphereGeometry(bcn_r, 12, 8),
        new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.2, emissiveIntensity: 0.8 }), all,
        (n) => {
          const h = n.tier === "gateway" ? antGw + 0.25 : (n.tier === "anchor" ? antAnchor : antScout);
          return { y: h };
        });

      // ----------------- Hit targets (pick radius from config, true size independent of slider) -----------------
      const hitR = this.pickRadius;
      this.hit = add(new THREE.CylinderGeometry(hitR, hitR, 1, 8), new THREE.MeshBasicMaterial({ visible: false }), all,
        (n) => {
          const h = n.tier === "gateway" ? antGw : (n.tier === "anchor" ? antAnchor : antScout);
          return { y: h / 2, sy: Math.max(2, h), fixedRadius: true };
        });

      // ----------------- Radio Links -----------------
      // Debug lines: straight scout->parent and straight anchor->gateway (NO ARCS)
      const primaryLinks = P.filter((n) => n.parent_id != null);
      this.debugLinkNodes = primaryLinks;
      const dbgGeo = new THREE.BufferGeometry();
      dbgGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(primaryLinks.length * 6), 3));
      dbgGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(primaryLinks.length * 6), 3));
      this.debugLines = new THREE.LineSegments(dbgGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65 }));
      this.debugLines.visible = false;
      this.group.add(this.debugLines);

      // On-click selection links: solid primary links, dashed backup links
      const maxSelSegs = 64;
      const selSolidGeo = new THREE.BufferGeometry();
      selSolidGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxSelSegs * 6), 3));
      selSolidGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(maxSelSegs * 6), 3));
      this.selSolidLines = new THREE.LineSegments(selSolidGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
      this.group.add(this.selSolidLines);

      const selDashGeo = new THREE.BufferGeometry();
      selDashGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxSelSegs * 6), 3));
      selDashGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(maxSelSegs * 6), 3));
      this.selDashLines = new THREE.LineSegments(selDashGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
      this.group.add(this.selDashLines);

      // Selection ring on the ground
      const [ringInner, ringOuter] = this.selectionRing;
      this.selRing = new THREE.Mesh(new THREE.RingGeometry(ringInner, ringOuter, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      this.selRing.visible = false;
      this.group.add(this.selRing);
    }

    /** Live world-grid dZ (mm) at plan node k for the terrain's current (fractional) day. */
    liveDz(k) {
      const st = this.t.store, day = this.t.day || 0;
      if (!st.isReady(day)) return this.t.dzAt(this.plan[k].x_m, this.plan[k].y_m);
      const { a, b, w } = st.span(day);
      const da = st.nodeDz(a)[k], db = st.nodeDz(b)[k];
      return da + w * (db - da);
    }

    /** The node's nodes.csv reading on the nearest day: { mm (NaN if none), prov: real|pinned|synthetic|undelivered|none, day }. */
    reading(k) {
      const st = this.t.store, day = Math.round(Math.max(0, Math.min(st.nDays - 1, this.t.day || 0)));
      if (!st.isReady(day)) return { mm: NaN, prov: "none", day };
      return { mm: st.readings(day)[k], prov: st.f.prov.codes[String(st.prov(day)[k])], day };
    }

    /**
     * Everything else node k reported on the nearest day, straight out of nodes.csv — the channels in
     * frames.telemetry, the parent the packet actually took, and the delivered / emergency-slot bits.
     * Values are NaN (or null) only where the simulator wrote nothing; nothing here is filled in or
     * recomputed from the planner's static peaks.
     * Returns null when the day is not loaded yet or the scene predates the telemetry planes.
     */
    telemetry(k) {
      const st = this.t.store, day = Math.round(Math.max(0, Math.min(st.nDays - 1, this.t.day || 0)));
      if (!st.isReady(day) || !st.telemStride) return null;
      const tm = st.telem(day);
      if (!tm) return null;
      const out = { day };
      const base = k * st.telemStride;
      st.telemChannels.forEach((name, q) => { out[name] = tm[base + q]; });
      const lk = st.link(day), fl = st.flags(day);
      const bits = (st.f.flags && st.f.flags.bits) || { delivered: 1, via_emergency: 2 };
      out.parent_used = lk && lk[k] !== st.noParent ? lk[k] : null;
      out.delivered = fl ? (fl[k] & bits.delivered) !== 0 : null;
      out.via_emergency = fl ? (fl[k] & bits.via_emergency) !== 0 : null;
      return out;
    }

    antennaTop(n, k) {
      const h = n.tier === "gateway" ? this.antH.gateway : (n.tier === "anchor" ? this.antH.anchor : this.antH.scout);
      return this.base[k] + h * this.scale;
    }

    /** Scene Y a node stands at: the highest live ground under its footprint, plus clearance. Keeps a
     *  model upright and above the slope instead of half-buried on the uphill side. */
    standY(n) {
      const t = this.t, r = this.standSampleR * this.scale;
      let y = t.groundY(n.x_m, n.y_m);
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        const g = t.groundY(n.x_m + dx, n.y_m + dz);
        if (g > y) y = g;
      }
      return y + this.standClearanceM * this.scale;
    }

    refresh() {
      const P = this.plan, t = this.t, S = this.scale;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      this.base = P.map((n) => this.standY(n));

      for (const { m, place } of this.parts) {
        const idxs = m.userData.idxs;
        idxs.forEach((k, inst) => {
          const n = P[k];
          const p = place(n);
          if (p.q) {
            q.copy(p.q);
          } else {
            e.set(p.rx || 0, p.ry || 0, p.rz || 0);
            q.setFromEuler(e);
          }
          const s = (p.s || 1) * S;
          const sx = p.fixedSx != null ? p.fixedSx : (p.fixedRadius ? 1 : ((p.sx ? p.sx : 1) * s));
          const sy = (p.sy ? p.sy : 1) * s;
          const sz = p.fixedSz != null ? p.fixedSz : (p.fixedRadius ? 1 : s);
          // F9: a filtered-out node is scaled to nothing, which removes it from the drawn models AND
          // from this.hit — the invisible cylinder the raycaster picks against — in a single step.
          if (this.shown[k]) sc.set(sx, sy, sz); else sc.set(0, 0, 0);

          const baseOx = p.baseOx || 0;
          const baseOz = p.baseOz || 0;
          // Offset parts (far rod pin, second extensometer post) follow the ground but never sink below
          // the node's own stand height — one rigid instrument, not a rubber sheet.
          const groundY = (baseOx !== 0 || baseOz !== 0)
            ? Math.max(t.groundY(n.x_m + baseOx, n.y_m + baseOz), this.base[k] - this.standClearanceM * S)
            : this.base[k];
          v.set(
            t.sx(n.x_m + baseOx) + (p.ox || 0) * S,
            groundY + (p.y || 0) * S,
            t.sz(n.y_m + baseOz) + (p.oz || 0) * S
          );
          m4.compose(v, q, sc);
          m.setMatrixAt(inst, m4);
        });
        m.instanceMatrix.needsUpdate = true;
      }

      // Update 1C thin extensometer wires
      if (this.extensometerWires) {
        const t1C = P.map((n, k) => (n.tier === "1C" ? k : -1)).filter((k) => k >= 0);
        const wpa = this.wirePosAttr;
        const postH = this.models.tier_1c.post_height_m;
        t1C.forEach((k, idx) => {
          const n = P[k];
          const x0 = t.sx(n.x_m), y0 = this.base[k] + postH * S, z0 = t.sz(n.y_m);
          const y1g = Math.max(t.groundY(n.x_m + this.extLen, n.y_m), this.base[k] - this.standClearanceM * S);
          const x1 = t.sx(n.x_m + this.extLen), y1 = y1g + postH * S, z1 = t.sz(n.y_m);
          const off = idx * 6;
          wpa[off] = x0; wpa[off + 1] = y0; wpa[off + 2] = z0;
          wpa[off + 3] = x1; wpa[off + 4] = y1; wpa[off + 5] = z1;
        });
        this.extensometerWires.geometry.attributes.position.needsUpdate = true;
        this.extensometerWires.geometry.computeBoundingSphere();
      }

      // Update beacon colours (live sink depth ramp)
      const c = [0, 0, 0];
      const col = new THREE.Color();
      P.forEach((n, k) => {
        const depth = -this.liveDz(k);
        if (this.colourBy === "prov") {
          const pr = this.reading(k).prov;
          col.set(PROV_COLOUR[pr] || STILL);
        } else if (depth < t.thresholdMm) col.copy(STILL);
        else {
          Ramps.depthColor(Math.min(1, depth / t.peakMm), c);
          col.setRGB(c[0], c[1], c[2]);
        }
        this.beacons.setColorAt(k, col);
        this.iconColour[3 * k] = col.r; this.iconColour[3 * k + 1] = col.g; this.iconColour[3 * k + 2] = col.b;
      });
      if (this.beacons.instanceColor) this.beacons.instanceColor.needsUpdate = true;
      this.beacons.material.emissive = new THREE.Color(0x222222);

      // ----------------- All radio links (debug) lines -----------------
      const clearC = new THREE.Color("#7dd3fc");
      const blockC = new THREE.Color("#f87171");
      const gwLinkC = new THREE.Color("#a5b4fc");

      if (this.debugLines && this.debugLines.visible) {
        const dpa = this.debugLines.geometry.attributes.position.array;
        const dca = this.debugLines.geometry.attributes.color.array;
        let o = 0;
        for (const n of this.debugLinkNodes) {
          const ka = this.byId.get(n.node_id);
          const kb = this.byId.get(n.parent_id);
          if (ka == null || kb == null) continue;
          const na = P[ka], nb = P[kb];
          const Ax = t.sx(na.x_m), Ay = this.antennaTop(na, ka), Az = t.sz(na.y_m);
          const Bx = t.sx(nb.x_m), By = this.antennaTop(nb, kb), Bz = t.sz(nb.y_m);
          const lc = n.link_clear === false ? blockC : (na.tier === "anchor" ? gwLinkC : clearC);

          dpa[o] = Ax; dpa[o + 1] = Ay; dpa[o + 2] = Az;
          dpa[o + 3] = Bx; dpa[o + 4] = By; dpa[o + 5] = Bz;
          dca[o] = lc.r; dca[o + 1] = lc.g; dca[o + 2] = lc.b;
          dca[o + 3] = lc.r; dca[o + 4] = lc.g; dca[o + 5] = lc.b;
          o += 6;
        }
        this.debugLines.geometry.setDrawRange(0, o / 3);
        this.debugLines.geometry.attributes.position.needsUpdate = true;
        this.debugLines.geometry.attributes.color.needsUpdate = true;
      }

      // ----------------- Click Selection Links -----------------
      this.blockedLinks = [];
      const solidPa = this.selSolidLines.geometry.attributes.position.array;
      const solidCa = this.selSolidLines.geometry.attributes.color.array;
      const dashPa = this.selDashLines.geometry.attributes.position.array;
      const dashCa = this.selDashLines.geometry.attributes.color.array;
      let so = 0, doff = 0;

      if (this.selected != null && this.selected.kind === "plan") {
        const k = this.selected.k;
        const n = P[k];
        const Ax = t.sx(n.x_m), Ay = this.antennaTop(n, k), Az = t.sz(n.y_m);

        // Helper to add solid segment
        const addSolid = (x0, y0, z0, x1, y1, z1, colr, isBlocked, linkLabel) => {
          if (so + 6 > solidPa.length) return;
          solidPa[so] = x0; solidPa[so + 1] = y0; solidPa[so + 2] = z0;
          solidPa[so + 3] = x1; solidPa[so + 4] = y1; solidPa[so + 5] = z1;
          solidCa[so] = colr.r; solidCa[so + 1] = colr.g; solidCa[so + 2] = colr.b;
          solidCa[so + 3] = colr.r; solidCa[so + 4] = colr.g; solidCa[so + 5] = colr.b;
          so += 6;
          if (isBlocked) {
            this.blockedLinks.push({
              text: "terrain blocks radio",
              mid: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
            });
          }
        };

        // Helper to add dashed segment
        const [dashLen, gapLen] = this.backupDash;
        const step = dashLen + gapLen;
        const addDashed = (x0, y0, z0, x1, y1, z1, colr) => {
          const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
          const len = Math.hypot(dx, dy, dz);
          if (len < 1) return;
          const nDashes = Math.max(2, Math.floor(len / step));
          for (let s = 0; s < nDashes; s++) {
            if (doff + 6 > dashPa.length) break;
            const f0 = (s * step) / len;
            const f1 = Math.min(1, (s * step + dashLen) / len);
            dashPa[doff] = x0 + dx * f0; dashPa[doff + 1] = y0 + dy * f0; dashPa[doff + 2] = z0 + dz * f0;
            dashPa[doff + 3] = x0 + dx * f1; dashPa[doff + 4] = y0 + dy * f1; dashPa[doff + 5] = z0 + dz * f1;
            dashCa[doff] = colr.r; dashCa[doff + 1] = colr.g; dashCa[doff + 2] = colr.b;
            dashCa[doff + 3] = colr.r; dashCa[doff + 4] = colr.g; dashCa[doff + 5] = colr.b;
            doff += 6;
          }
        };

        if (["1A", "1B", "1C"].includes(n.tier)) {
          // Scout -> parent anchor (solid)
          if (n.parent_id != null) {
            const pk = this.byId.get(n.parent_id);
            if (pk != null) {
              const p = P[pk];
              const Bx = t.sx(p.x_m), By = this.antennaTop(p, pk), Bz = t.sz(p.y_m);
              const blocked = (n.link_clear === false);
              addSolid(Ax, Ay, Az, Bx, By, Bz, blocked ? blockC : new THREE.Color("#ffffff"), blocked, "parent");
            }
          }
          // Scout -> backup anchor (dashed)
          if (n.backup_parent_id != null) {
            const bpk = this.byId.get(n.backup_parent_id);
            if (bpk != null) {
              const bp = P[bpk];
              const Cx = t.sx(bp.x_m), Cy = this.antennaTop(bp, bpk), Cz = t.sz(bp.y_m);
              addDashed(Ax, Ay, Az, Cx, Cy, Cz, new THREE.Color("#94a3b8"));
            }
          }
        } else if (n.tier === "anchor") {
          // Anchor -> gateway (straight, not arced)
          if (n.parent_id != null) {
            const gwk = this.byId.get(n.parent_id);
            if (gwk != null) {
              const gw = P[gwk];
              const Gx = t.sx(gw.x_m), Gy = this.antennaTop(gw, gwk), Gz = t.sz(gw.y_m);
              const blocked = (n.link_clear === false);
              addSolid(Ax, Ay, Az, Gx, Gy, Gz, blocked ? blockC : new THREE.Color("#ffffff"), blocked, "gw");
            }
          }
          // Anchor's children links
          const children = P.filter((c) => c.parent_id === n.node_id);
          for (const c of children) {
            const ck = this.byId.get(c.node_id);
            if (ck == null) continue;
            const Cx = t.sx(c.x_m), Cy = this.antennaTop(c, ck), Cz = t.sz(c.y_m);
            const childBlocked = (c.link_clear === false);
            addSolid(Cx, Cy, Cz, Ax, Ay, Az, childBlocked ? blockC : clearC, childBlocked, "child");
          }
        }

        // Selection ring
        this.selRing.position.set(Ax, this.base[k] + 0.1, Az);
        this.selRing.scale.setScalar(S * (n.tier === "gateway" ? 2.5 : (n.tier === "anchor" ? 1.5 : 1.0)));
        this.selRing.visible = this.group.visible;
      } else {
        this.selRing.visible = false;
      }

      this.selSolidLines.geometry.setDrawRange(0, so / 3);
      this.selSolidLines.geometry.attributes.position.needsUpdate = true;
      this.selSolidLines.geometry.attributes.color.needsUpdate = true;

      this.selDashLines.geometry.setDrawRange(0, doff / 3);
      this.selDashLines.geometry.attributes.position.needsUpdate = true;
      this.selDashLines.geometry.attributes.color.needsUpdate = true;

    }

    updateCamera(camera) {
      // 1C wire extensometer: draw only when camera is closer than detail_distance_m to any 1C sensor
      if (this.extensometerWires) {
        if (!this.group.visible) {
          this.extensometerWires.visible = false;
          return;
        }
        const P = this.plan, t = this.t;
        const camPos = camera.position;
        let minDistSq = Infinity;
        for (let k = 0; k < P.length; k++) {
          if (P[k].tier === "1C") {
            const gx = t.sx(P[k].x_m);
            const gy = this.base ? this.base[k] : t.groundY(P[k].x_m, P[k].y_m);
            const gz = t.sz(P[k].y_m);
            const dx = camPos.x - gx, dy = camPos.y - gy, dz = camPos.z - gz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < minDistSq) minDistSq = d2;
          }
        }
        this.extensometerWires.visible = this.lodView.modelsOn && (minDistSq < this.detailDistance * this.detailDistance);
      }
    }

    /** F9: which nodes the operator has left switched on. `pred(node, k)` -> boolean.
     *  A filtered-out node loses its icon, its 3D model, its pick target and its label in one place:
     *  a hidden node that is still clickable is worse than no filter at all. */
    setShown(pred) {
      for (let k = 0; k < this.plan.length; k++) this.shown[k] = pred(this.plan[k], k) ? 1 : 0;
      if (this.selected && this.selected.kind === "plan" && !this.shown[this.selected.k]) this.selected = null;
      this.refresh();
    }

    setVisible({ plan, links }) {
      if (plan !== undefined) {
        this.group.visible = plan;
        if (!plan) for (const L of this.iconLayers) L.points.visible = false;
      }
      if (links !== undefined) {
        this.showDebugLinks = links;
        this.debugLines.visible = links && this.group.visible;
        this.refresh();
      }
    }

    pick(raycaster) {
      const hits = [];
      if (this.group.visible) {
        for (const h of raycaster.intersectObject(this.hit)) {
          hits.push({ d: h.distance, kind: "plan", k: h.instanceId });
        }
      }
      hits.sort((a, b) => a.d - b.d);
      return hits[0] || null;
    }

    select(sel) {
      this.selected = sel;
      this.refresh();
    }
  }

  global.MineNetwork = MineNetwork;
  global.TIER_COLOUR = TIER_COLOUR;
  global.TIER_NAME = TIER_NAME;
  global.PROV_COLOUR = PROV_COLOUR;
})(window);
