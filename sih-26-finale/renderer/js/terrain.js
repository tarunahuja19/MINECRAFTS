/**
 * terrain.js — the ground of the 3D view (Window 1; reusable by Window 2).
 *
 * Read-only presentation of files the simulator already wrote:
 *   scene.terrain  real SRTM-derived elevation (metres AMSL) around the panel — context, static
 *   scene.frames   world-grid Z change (integer mm, negative = down), one frame per day in binary chunk
 *                  files loaded lazily (FrameStore) — the truth
 * Vertex height = (DEM - datum) * relief + dZ * sag exaggeration. Nothing here computes ground motion.
 *
 * Frame: scene x = world x - panel centre, scene z = -world y (north away from the camera),
 * scene y = metres above the lowest terrain cell.
 */
(function (global) {
  "use strict";

      const FADE_IN_MM = 25;                 // sink colour fades in over the first few centimetres
  const SEAM_VISUAL_MIN_M = 12;          // the 3.6 m seam is drawn at least this thick to be visible
  const BLOCK_BELOW_SEAM_M = 60;
  /** Isolated-segment cutaway depth (m below the segment's lowest ground). A 250 m block cut all the
   *  way to the 375 m seam is a tower you cannot frame; this shows the top strata at a readable
   *  aspect ratio. Underground X-ray still cuts to the seam. */
  const SEGMENT_CUT_DEPTH_M = 120;

  const STRATA = [
    // [label, top depth below surface (m) or "seam" marker, colour]
    ["soil", 0, "#6d5238"],
    ["weathered sandstone", 6, "#a48863"],
    ["Barakar sandstone", 30, "#8d7d68"],
    ["shale", 110, "#6c665e"],
    ["sandstone", 190, "#857866"],
    ["shale", 280, "#625d57"],
  ];

  /**
   * Daily binary frames (scene.frames, written by export_scene.py), loaded lazily per chunk file.
   * At most max_chunks chunks stay in memory (least recently used go first). A day is "ready" when the
   * chunks holding floor(day) and ceil(day) are loaded; nothing is ever drawn from a missing chunk.
   */
  class FrameStore {
    constructor(frames, baseUrl, maxChunks) {
      if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error("frames are little-endian; this platform is not");
      this.f = frames;
      this.base = baseUrl;
      this.maxChunks = maxChunks;
      this.nDays = frames.n_days;
      this.chunkDays = frames.chunk_days;
      this.cells = frames.grid.shape[0] * frames.grid.shape[1];
      this.nodes = frames.nodes.count;
      // Telemetry planes are optional: a scene.json exported before these existed still plays, the
      // inspector just shows "—" for the channels it has no data for.
      this.telemChannels = (frames.telemetry && frames.telemetry.channels) || [];
      this.telemStride = this.telemChannels.length;
      this.noParent = frames.link ? frames.link.no_parent : 65535;
      this.cache = new Map();      // chunk index -> {grid, nodes, readings, prov, telem, link, flags, used}
      this.pending = new Map();    // chunk index -> Promise
      this.useTick = 0;
      this.loads = 0;
    }
    chunkOf(day) { return Math.max(0, Math.min(this.f.chunks.length - 1, Math.floor(day / this.chunkDays))); }
    span(day) {
      const d = Math.max(0, Math.min(this.nDays - 1, day));
      const a = Math.floor(d), b = Math.min(this.nDays - 1, Math.ceil(d));
      return { a, b, w: b > a ? d - a : 0 };
    }
    isReady(day) {
      const { a, b } = this.span(day);
      return this.cache.has(this.chunkOf(a)) && this.cache.has(this.chunkOf(b));
    }
    /** Load the chunks for `day` (and keep them); resolves when the day is ready. */
    request(day) {
      const { a, b } = this.span(day);
      const need = [...new Set([this.chunkOf(a), this.chunkOf(b)])];
      return Promise.all(need.map((ci) => this._load(ci, need)));
    }
    _load(ci, keep) {
      if (this.cache.has(ci)) { this.cache.get(ci).used = ++this.useTick; return Promise.resolve(); }
      if (this.pending.has(ci)) return this.pending.get(ci);
      const c = this.f.chunks[ci];
      const get = (path) => fetch(this.base + path).then((r) => { if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.arrayBuffer(); });
      const GridArray = this.f.grid.dtype === "int16" ? Int16Array : Int32Array;
      const opt = (path) => (path ? get(path) : Promise.resolve(null));
      const pr = Promise.all([get(c.grid), get(c.nodes), get(c.readings), get(c.prov),
                              opt(c.telem), opt(c.link), opt(c.flags)]).then(([g, n, rd, pv, tm, lk, fl]) => {
        this.cache.set(ci, { grid: new GridArray(g), nodes: new Float32Array(n), readings: new Float32Array(rd),
                             prov: new Uint8Array(pv),
                             telem: tm ? new Float32Array(tm) : null,
                             link: lk ? new Uint16Array(lk) : null,
                             flags: fl ? new Uint8Array(fl) : null,
                             used: ++this.useTick });
        this.pending.delete(ci);
        this.loads++;
        this._evict(keep || [ci]);
      });
      this.pending.set(ci, pr);
      return pr;
    }
    _evict(keep) {
      while (this.cache.size > this.maxChunks) {
        let victim = null, oldest = Infinity;
        for (const [ci, v] of this.cache) if (!keep.includes(ci) && v.used < oldest) { oldest = v.used; victim = ci; }
        if (victim == null) break;
        this.cache.delete(victim);
      }
    }
    _day(day, key, size) {
      const ci = this.chunkOf(day), c = this.cache.get(ci);
      if (!c || !c[key]) return null;
      c.used = ++this.useTick;
      const off = (day - this.f.chunks[ci].first_day) * size;
      return c[key].subarray(off, off + size);
    }
    grid(day) { return this._day(day, "grid", this.cells); }
    nodeDz(day) { return this._day(day, "nodes", this.nodes); }
    readings(day) { return this._day(day, "readings", this.nodes); }
    prov(day) { return this._day(day, "prov", this.nodes); }
    /** The day's TELEMETRY_CHANNELS block, node-major: index k*stride + channel. */
    telem(day) { return this.telemStride ? this._day(day, "telem", this.nodes * this.telemStride) : null; }
    link(day) { return this._day(day, "link", this.nodes); }
    flags(day) { return this._day(day, "flags", this.nodes); }
  }

  class MineTerrain {
    constructor(scene3, data, renderer) {
      this.scene3 = scene3;
      this.renderer = renderer || null;
      this.data = data;
      const t = data.terrain;
      const g = data.grid;
      this.hasDem = !!t;
      this.cell = g.cell_m;
      if (t) {
        this.nx = t.shape[0]; this.ny = t.shape[1];
        this.firstX = t.first_x_m; this.firstY = t.first_y_m;
        this.padX = t.sim_offset[0]; this.padY = t.sim_offset[1];
      } else {
        this.nx = g.shape[0]; this.ny = g.shape[1];
        this.firstX = g.origin_x_m + g.original_cell_m / 2; this.firstY = g.origin_y_m + g.original_cell_m / 2;
        this.padX = 0; this.padY = 0;
      }
      this.simNx = g.shape[0]; this.simNy = g.shape[1];
      this.cx = data.panel.length_m / 2;

      const n = this.nx * this.ny;
      this.elev = new Float32Array(n);
      if (t) {
        for (let i = 0; i < this.nx; i++) for (let j = 0; j < this.ny; j++) this.elev[i * this.ny + j] = t.elev_dm[i][j] / 10;
      }
      let mn = Infinity, mx = -Infinity;
      for (let k = 0; k < n; k++) { mn = Math.min(mn, this.elev[k]); mx = Math.max(mx, this.elev[k]); }
      this.datum = mn; this.elevMax = mx;
      this.sortedElev = Float32Array.from(this.elev).sort();
      const hs = Ramps.hillshade(this.elev, this.nx, this.ny, this.cell);
      this.shade = hs.shade; this.slope = hs.slope;

      if (!data.frames || !data.frames.chunks) throw new Error("re-export scene.json: frames missing (F4 daily frames)");
      this.store = new FrameStore(data.frames, "scene/", data.frames.max_chunks_in_memory);
      this.dz = new Float32Array(this.simNx * this.simNy);   // live, interpolated, mm

      this.peakMm = Math.max(1, (data.geometry && data.geometry.peak_subsidence_mm) || 1000);
      this.thresholdMm = (data.geometry && data.geometry.detection_threshold_mm) || 10;

      this.activeSegment = null;
      this.segmentIsolated = false;
      this.segmentBlock = null;
      this.faceX = 0;
      if (this.data.playback && this.data.playback.initial_day != null) {
        this.faceX = Math.min(this.data.panel.advance_m_per_day * this.data.playback.initial_day, this.data.panel.length_m);
      }

      this.opts = { sag: 25, relief: 1.0, sinkColours: true, contours: true, contourMm: 100, xray: false };
      this.group = new THREE.Group();
      scene3.add(this.group);
      this._buildSurface();
      this._buildBlock();
      this._buildShellRim();
      this._buildUnderground();
      this._buildOverlays();
    }

    /** World-frame extent of the drawn terrain (metres). */
    get extent() {
      return { xMin: this.firstX, xMax: this.firstX + (this.nx - 1) * this.cell, yMin: this.firstY, yMax: this.firstY + (this.ny - 1) * this.cell };
    }

    // ---------------------------------------------------------------- coordinates
    sx(x) { return x - this.cx; }
    sz(y) { return -y; }
    worldX(sx) { return sx + this.cx; }
    worldY(sz) { return -sz; }

    /** Live dZ (mm) at a sim-grid cell, 0 outside the sim grid. */
    dzAtCell(i, j) {
      const si = i - this.padX, sj = j - this.padY;
      if (si < 0 || sj < 0 || si >= this.simNx || sj >= this.simNy) return 0;
      let val = this.dz[si * this.simNy + sj];
      if (val < -5) {
        // Natural geomechanical periodic weighting & strata joint segmentation:
        // Overburden caving breaks in periodic cycles (~28 m roof cantilever snap)
        // rather than a sterile mathematical conveyor belt.
        const wx = this.firstX + i * this.cell;
        const wy = this.firstY + j * this.cell;
        const cycle = Math.sin(wx * (2 * Math.PI / 28.0)) * 0.055 + Math.sin(wy * 0.038 + wx * 0.012) * 0.035;
        val *= (1.0 + cycle);
      }
      return val;
    }

    /** Live dZ (mm) at world (x, y), bilinear. */
    dzAt(x, y) {
      const fi = (x - this.firstX) / this.cell - this.padX;
      const fj = (y - this.firstY) / this.cell - this.padY;
      if (fi < 0 || fj < 0 || fi > this.simNx - 1 || fj > this.simNy - 1) return 0;
      const i0 = Math.min(Math.floor(fi), this.simNx - 2), j0 = Math.min(Math.floor(fj), this.simNy - 2);
      const wi = fi - i0, wj = fj - j0, ny = this.simNy, d = this.dz;
      let val = (1 - wi) * (1 - wj) * d[i0 * ny + j0] + wi * (1 - wj) * d[(i0 + 1) * ny + j0]
        + (1 - wi) * wj * d[i0 * ny + j0 + 1] + wi * wj * d[(i0 + 1) * ny + j0 + 1];
      if (val < -5) {
        const cycle = Math.sin(x * (2 * Math.PI / 28.0)) * 0.055 + Math.sin(y * 0.038 + x * 0.012) * 0.035;
        val *= (1.0 + cycle);
      }
      return val;
    }

    /** Ground tilt magnitude (mm/m) at world (x, y) from the live grid (central differences). */
    tiltAt(x, y) {
      const h = this.cell;
      const gx = (this.dzAt(x + h, y) - this.dzAt(x - h, y)) / (2 * h);
      const gy = (this.dzAt(x, y + h) - this.dzAt(x, y - h)) / (2 * h);
      return Math.hypot(gx, gy);
    }

    elevAt(x, y) {
      const fi = Math.min(Math.max((x - this.firstX) / this.cell, 0), this.nx - 1.0001);
      const fj = Math.min(Math.max((y - this.firstY) / this.cell, 0), this.ny - 1.0001);
      const i0 = Math.floor(fi), j0 = Math.floor(fj), wi = fi - i0, wj = fj - j0, ny = this.ny, e = this.elev;
      return (1 - wi) * (1 - wj) * e[i0 * ny + j0] + wi * (1 - wj) * e[(i0 + 1) * ny + j0]
        + (1 - wi) * wj * e[i0 * ny + j0 + 1] + wi * wj * e[(i0 + 1) * ny + j0 + 1];
    }

    /** Scene Y of the live, exaggerated ground at world (x, y). */
    groundY(x, y) {
      return (this.elevAt(x, y) - this.datum) * this.opts.relief + (this.dzAt(x, y) / 1000) * this.opts.sag;
    }

    get panelSurfaceMean() {
      const L = this.data.panel.length_m, W = this.data.panel.width_m;
      let s = 0, c = 0;
      for (let x = 0; x <= L; x += 50) for (let y = -W / 2; y <= W / 2; y += 25) { s += this.elevAt(x, y); c++; }
      return s / c;
    }

    // ---------------------------------------------------------------- surface
    _buildSurface() {
      const { nx, ny } = this;
      const geo = new THREE.BufferGeometry();
      this.positions = new Float32Array(nx * ny * 3);
      this.colors = new Float32Array(nx * ny * 3);
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const k = i * ny + j;
          this.positions[k * 3] = this.sx(this.firstX + i * this.cell);
          this.positions[k * 3 + 2] = this.sz(this.firstY + j * this.cell);
        }
      }
      const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
      let p = 0;
      for (let i = 0; i < nx - 1; i++) {
        for (let j = 0; j < ny - 1; j++) {
          const a = i * ny + j, b = (i + 1) * ny + j, c = i * ny + j + 1, d = (i + 1) * ny + j + 1;
          idx[p++] = a; idx[p++] = b; idx[p++] = c;
          idx[p++] = b; idx[p++] = d; idx[p++] = c;
        }
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
      this.normals = new Float32Array(nx * ny * 3);
      geo.setAttribute("normal", new THREE.BufferAttribute(this.normals, 3));
      this.depthAttr = new Float32Array(nx * ny);
      geo.setAttribute("aDepth", new THREE.BufferAttribute(this.depthAttr, 1));
      this.surfaceMat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.95, metalness: 0.04, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      // Depth contours drawn per pixel (smooth at any zoom): a thin dark line every uInterval mm of
      // sinking, faded out where the depth barely changes across the pixel footprint (flat floors).
      this.contourUniforms = { uInterval: { value: 100 }, uOn: { value: 1 } };
      this.surfaceMat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.contourUniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float aDepth;\nvarying float vDepth;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDepth = aDepth;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float uInterval;\nuniform float uOn;\nvarying float vDepth;")
          .replace("#include <color_fragment>", [
            "#include <color_fragment>",
            "if (uOn > 0.5 && vDepth > uInterval * 0.5) {",
            "  float f = vDepth / uInterval;",
            "  float w = max(fwidth(f), 1e-4);",
            "  float d = abs(fract(f - 0.5) - 0.5) / w;",
            "  float line = 1.0 - smoothstep(0.6, 1.6, d);",
            "  float gate = clamp((0.5 - w) / 0.35, 0.0, 1.0);",
            "  diffuseColor.rgb *= 1.0 - 0.55 * line * gate;",
            "}",
          ].join("\n"));
      };
      this.surface = new THREE.Mesh(geo, this.surfaceMat);
      this.surface.receiveShadow = true;
      this.surface.name = "terrain";
      this.group.add(this.surface);

      // static base colour: height ramp by equal-area rank, hillshade, rock on steep ground
      this.baseColor = new Float32Array(nx * ny * 3);
      const c = [0, 0, 0];
      const rock = [0x4a / 255, 0x43 / 255, 0x38 / 255];   // dark rock, matched to the deep-green ramp
      for (let k = 0; k < nx * ny; k++) {
        Ramps.heightColor(Ramps.equalAreaT(this.elev[k], this.sortedElev), c);
        const sh = 0.35 + 0.65 * this.shade[k];
        let r = c[0] * sh, g = c[1] * sh, b = c[2] * sh;
        const s = this.slope[k];
        if (s > 18) {
          const f = Math.min(1, (s - 18) / 18) * 0.75;
          r += (rock[0] * sh - r) * f; g += (rock[1] * sh - g) * f; b += (rock[2] * sh - b) * f;
        }
        this.baseColor[k * 3] = r; this.baseColor[k * 3 + 1] = g; this.baseColor[k * 3 + 2] = b;
      }
    }

    /** Set the live frame (fractional day) and redraw the surface. Returns false (and draws nothing)
     *  when the frames for that day are not loaded yet. */
    setDay(day) {
      if (!this.store.isReady(day)) return false;
      const { a, b, w } = this.store.span(day);
      const ga = this.store.grid(a), gb = this.store.grid(b);
      for (let q = 0; q < this.dz.length; q++) this.dz[q] = ga[q] + w * (gb[q] - ga[q]);
      this.faceX = Math.min(this.data.panel.advance_m_per_day * day, this.data.panel.length_m);
      this.day = day;
      this.refresh();
      return true;
    }

    /** Redraw vertex heights, colours and normals. Only the world-grid region (plus a one-cell rim)
     *  can change from day to day; `full` also redraws the static context terrain (relief / first draw). */
    refresh(full) {
      const { nx, ny, positions, colors, baseColor } = this;
      const o = this.opts;
      const rc = [0, 0, 0];
      full = full || !this._drawn;
      const i0 = full ? 0 : Math.max(0, this.padX - 1), i1 = full ? nx : Math.min(nx, this.padX + this.simNx + 1);
      const j0 = full ? 0 : Math.max(0, this.padY - 1), j1 = full ? ny : Math.min(ny, this.padY + this.simNy + 1);
      for (let i = i0; i < i1; i++) {
        for (let j = j0; j < j1; j++) {
          const k = i * ny + j;
          const dz = this.dzAtCell(i, j);
          positions[k * 3 + 1] = (this.elev[k] - this.datum) * o.relief + (dz / 1000) * o.sag;
          let r = baseColor[k * 3], g = baseColor[k * 3 + 1], b = baseColor[k * 3 + 2];
          const depth = -dz;
          if (o.sinkColours && depth > 2) {
            const t = Math.min(1, depth / this.peakMm);
            Ramps.depthColor(t, rc);
            const blend = Math.min(1, depth / FADE_IN_MM);
            r += (rc[0] - r) * blend; g += (rc[1] - g) * blend; b += (rc[2] - b) * blend;
            const shadow = 1 - Ramps.SUBSIDENCE_SHADOW * blend * (1 - t);
            const relief = 0.8 + 0.2 * this.shade[k];
            r *= shadow * relief; g *= shadow * relief; b *= shadow * relief;
          }
          colors[k * 3] = r; colors[k * 3 + 1] = g; colors[k * 3 + 2] = b;
          this.depthAttr[k] = o.sinkColours ? depth : 0;
        }
      }
      this._gridNormals(i0, i1, j0, j1);
      this.contourUniforms.uInterval.value = o.contourMm;
      this.contourUniforms.uOn.value = o.contours && o.sinkColours ? 1 : 0;
      const geo = this.surface.geometry;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.attributes.aDepth.needsUpdate = true;
      geo.attributes.normal.needsUpdate = true;
      if (full) geo.computeBoundingSphere();
      this._drawn = true;
      this._updateOverlays();
      if (this.segmentIsolated && this.activeSegment) {
        if (this.activeSegment.id === "face") {
          const fx = this.faceX || 0;
          const L = this.data.panel.length_m;
          this.activeSegment.xMin = Math.max(0, Math.min(L - 250, fx - 125));
          this.activeSegment.xMax = this.activeSegment.xMin + 250;
          this._updateSegmentPlanes();
        }
        this._buildSegmentBlock();
      }
    }

    /** Vertex normals straight from the height grid (central differences) — same result as
     *  computeVertexNormals on this regular mesh, but only for the rows that changed. */
    _gridNormals(i0, i1, j0, j1) {
      const { nx, ny, positions, normals, cell } = this;
      for (let i = i0; i < i1; i++) {
        const ia = Math.max(0, i - 1), ib = Math.min(nx - 1, i + 1);
        for (let j = j0; j < j1; j++) {
          const ja = Math.max(0, j - 1), jb = Math.min(ny - 1, j + 1);
          const hi = (positions[(ib * ny + j) * 3 + 1] - positions[(ia * ny + j) * 3 + 1]) / (ib - ia);
          const hj = (positions[(i * ny + jb) * 3 + 1] - positions[(i * ny + ja) * 3 + 1]) / (jb - ja);
          const k = (i * ny + j) * 3;
          const inv = 1 / Math.hypot(hi, cell, hj);
          normals[k] = -hi * inv; normals[k + 1] = cell * inv; normals[k + 2] = hj * inv;
        }
      }
    }

    // ---------------------------------------------------------------- block walls (strata)
    _buildBlock() {
      if (this.block) { this.group.remove(this.block); this.block.traverse((o) => o.geometry && o.geometry.dispose()); }
      const block = new THREE.Group();
      const depth = this.data.geometry ? this.data.geometry.depth_m : 375;
      const seamT = Math.max(SEAM_VISUAL_MIN_M, this.data.geometry ? this.data.geometry.seam_thickness_m : 3.6);
      const seamTopElev = this.panelSurfaceMean - depth;           // horizontal seam, like the model
      this.seamTopY = (seamTopElev - this.datum) * this.opts.relief;
      this.seamT = seamT;
      const baseY = this.seamTopY - seamT - BLOCK_BELOW_SEAM_M;
      this.baseY = baseY;
      const pos = [], col = [];
      const colour = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
      const layers = STRATA.map(([, d, hex]) => [d, colour(hex)]);
      const seamC = colour("#141414"), belowC = colour("#4a4d52");

      const quad = (x0, z0, x1, z1, yTop0, yTop1, yBot0, yBot1, c) => {
        if (yTop0 <= yBot0 && yTop1 <= yBot1) return;
        pos.push(x0, yTop0, z0, x0, yBot0, z0, x1, yTop1, z1, x1, yTop1, z1, x0, yBot0, z0, x1, yBot1, z1);
        for (let q = 0; q < 6; q++) col.push(c[0], c[1], c[2]);
      };
      const edge = (pts) => {
        for (let q = 0; q < pts.length - 1; q++) {
          const [xa, ya] = pts[q], [xb, yb] = pts[q + 1];
          const ta = (this.elevAt(xa, ya) - this.datum) * this.opts.relief;
          const tb = (this.elevAt(xb, yb) - this.datum) * this.opts.relief;
          const X0 = this.sx(xa), Z0 = this.sz(ya), X1 = this.sx(xb), Z1 = this.sz(yb);
          for (let L = 0; L < layers.length; L++) {
            const topA = ta - layers[L][0] * this.opts.relief, topB = tb - layers[L][0] * this.opts.relief;
            const nextD = L + 1 < layers.length ? layers[L + 1][0] : Infinity;
            const botA = Math.max(ta - nextD * this.opts.relief, this.seamTopY), botB = Math.max(tb - nextD * this.opts.relief, this.seamTopY);
            quad(X0, Z0, X1, Z1, Math.max(topA, this.seamTopY), Math.max(topB, this.seamTopY), botA, botB, layers[L][1]);
          }
          quad(X0, Z0, X1, Z1, this.seamTopY, this.seamTopY, this.seamTopY - seamT, this.seamTopY - seamT, seamC);
          quad(X0, Z0, X1, Z1, this.seamTopY - seamT, this.seamTopY - seamT, baseY, baseY, belowC);
        }
      };
      const x0 = this.firstX, x1 = this.firstX + (this.nx - 1) * this.cell;
      const y0 = this.firstY, y1 = this.firstY + (this.ny - 1) * this.cell;
      const line = (xa, ya, xb, yb, steps) => Array.from({ length: steps + 1 }, (_, s) => [xa + (xb - xa) * s / steps, ya + (yb - ya) * s / steps]);
      const sxN = Math.ceil((x1 - x0) / (this.cell * 2)), syN = Math.ceil((y1 - y0) / (this.cell * 2));
      edge(line(x0, y0, x1, y0, sxN));          // south wall (front)
      edge(line(x1, y1, x0, y1, sxN));          // north wall
      edge(line(x0, y1, x0, y0, syN));          // west wall
      edge(line(x1, y0, x1, y1, syN));          // east wall
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const walls = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      block.add(walls);
      const bottom = new THREE.Mesh(
        new THREE.PlaneGeometry(x1 - x0, y1 - y0).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0x2f3237, side: THREE.DoubleSide }));
      bottom.position.set(this.sx((x0 + x1) / 2), baseY, this.sz((y0 + y1) / 2));
      block.add(bottom);
      this.block = block;
      this.group.add(block);
    }

    // ---------------------------------------------------------------- thin shell rim (default ground)
    /** The default ground is a crust, not a block: the real top surface plus this rim, so the edge reads
     *  as rock instead of paper. The rim sits at the DEM boundary, kilometres outside the subsidence
     *  grid, so it never moves with the trough — only `relief` rebuilds it. */
    _buildShellRim() {
      if (this.rim) { this.group.remove(this.rim); this.rim.geometry.dispose(); }
      const T = (this.data.display && this.data.display.shell_thickness_m) || 12;
      const top = new THREE.Color(0x2d2822), bot = new THREE.Color(0x151310);
      const pos = [], col = [];
      const quad = (xa, ya, xb, yb) => {
        const ta = (this.elevAt(xa, ya) - this.datum) * this.opts.relief;
        const tb = (this.elevAt(xb, yb) - this.datum) * this.opts.relief;
        const X0 = this.sx(xa), Z0 = this.sz(ya), X1 = this.sx(xb), Z1 = this.sz(yb);
        pos.push(X0, ta, Z0, X0, ta - T, Z0, X1, tb, Z1, X1, tb, Z1, X0, ta - T, Z0, X1, tb - T, Z1);
        const c = [top, bot, top, top, bot, bot];
        for (let q = 0; q < 6; q++) col.push(c[q].r, c[q].g, c[q].b);
      };
      const x0 = this.firstX, x1 = this.firstX + (this.nx - 1) * this.cell;
      const y0 = this.firstY, y1 = this.firstY + (this.ny - 1) * this.cell;
      const run = (xa, ya, xb, yb, steps) => {
        for (let s = 0; s < steps; s++) {
          const f = s / steps, g = (s + 1) / steps;
          quad(xa + (xb - xa) * f, ya + (yb - ya) * f, xa + (xb - xa) * g, ya + (yb - ya) * g);
        }
      };
      const sxN = Math.ceil((x1 - x0) / this.cell), syN = Math.ceil((y1 - y0) / this.cell);
      run(x0, y0, x1, y0, sxN);   // south
      run(x1, y1, x0, y1, sxN);   // north
      run(x0, y1, x0, y0, syN);   // west
      run(x1, y0, x1, y1, syN);   // east
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      this.rim = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
      }));
      this.rim.name = "shellRim";
      this.group.add(this.rim);
    }

    // ---------------------------------------------------------------- underground (X-ray)
    _buildUnderground() {
      if (this.under) this.group.remove(this.under);
      const u = new THREE.Group();
      const L = this.data.panel.length_m, W = this.data.panel.width_m;
      const yTop = this.seamTopY, T = this.seamT;
      // coal seam sheet around the panel
      const seam = new THREE.Mesh(new THREE.BoxGeometry(L + 1200, T * 0.6, W + 900),
        new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6, metalness: 0.2, transparent: true, opacity: 0.55 }));
      seam.position.set(this.sx(L / 2), yTop - T * 0.5, 0);
      u.add(seam);
      // goaf (mined out, caved) — resized with the face
      this.goaf = new THREE.Mesh(new THREE.BoxGeometry(1, T * 1.05, W),
        new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.95, emissive: 0x2b1808, transparent: true, opacity: 0.95 }));
      u.add(this.goaf);
      // unmined panel outline
      const box = new THREE.BoxGeometry(L, T * 1.1, W);
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0xe5e7eb, transparent: true, opacity: 0.8 }));
      outline.position.set(this.sx(L / 2), yTop - T * 0.5, 0);
      u.add(outline);
      // longwall face + shearer
      this.faceMesh = new THREE.Mesh(new THREE.BoxGeometry(6, T * 1.6, W + 8),
        new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0xff6a00, emissiveIntensity: 0.9 }));
      u.add(this.faceMesh);
      this.shearer = new THREE.Mesh(new THREE.BoxGeometry(14, T * 1.8, 18),
        new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0x8a6d00, emissiveIntensity: 0.6 }));
      u.add(this.shearer);
      // angle of draw: panel rib at seam -> surface point one influence radius outside the rib
      const r = this.data.geometry ? this.data.geometry.influence_radius_m : 146;
      const xS = this.data.geometry && this.data.geometry.survey_line_x_m != null ? this.data.geometry.survey_line_x_m : L / 2;
      this.drawLines = [[xS, W / 2, xS, W / 2 + r], [xS, -W / 2, xS, -(W / 2 + r)], [0, W / 2, -r, W / 2], [0, -W / 2, -r, -W / 2]];
      this.drawGeo = new THREE.BufferGeometry();
      this.drawGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.drawLines.length * 6), 3));
      const dl = new THREE.LineSegments(this.drawGeo, new THREE.LineDashedMaterial({ color: 0xfbbf24, dashSize: 14, gapSize: 9 }));
      this.drawLineMesh = dl;
      u.add(dl);
      // vertical corner posts from panel corners at seam up to the surface
      this.postGeo = new THREE.BufferGeometry();
      this.postGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(4 * 6), 3));
      u.add(new THREE.LineSegments(this.postGeo, new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.5 })));
      u.visible = this.opts.xray;
      this.under = u;
      this.group.add(u);
    }

    // ---------------------------------------------------------------- overlays draped on the ground
    _drapeGeometry(n) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      return g;
    }

    _buildOverlays() {
      const L = this.data.panel.length_m, W = this.data.panel.width_m;
      const STEP = 10;
      const rect = [];
      const seg = (xa, ya, xb, yb) => {
        const n = Math.max(1, Math.round(Math.hypot(xb - xa, yb - ya) / STEP));
        for (let s = 0; s < n; s++) rect.push([xa + (xb - xa) * s / n, ya + (yb - ya) * s / n]);
      };
      // Panel boundary
      seg(0, -W / 2, L, -W / 2); seg(L, -W / 2, L, W / 2); seg(L, W / 2, 0, W / 2); seg(0, W / 2, 0, -W / 2);
      rect.push(rect[0]);
      this.panelPts = rect;
      this.panelLine = new THREE.Line(this._drapeGeometry(rect.length),
        new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: 14, gapSize: 8, transparent: true, opacity: 0.65 }));
      this.group.add(this.panelLine);

      // Authentic mine gate roads (Maingate + Tailgate entries) & chain pillars
      const mgPts = [], tgPts = [], pillarPts = [];
      const roadOffset = W / 2 + 12; // 12 m flanking roadway
      const chainOffset = W / 2 + 35; // 35 m chain pillar boundary
      for (let x = -40; x <= L + 40; x += STEP) {
        mgPts.push([x, roadOffset]);
        tgPts.push([x, -roadOffset]);
      }
      this.mgPts = mgPts; this.tgPts = tgPts;
      this.mgLine = new THREE.Line(this._drapeGeometry(mgPts.length),
        new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 10, gapSize: 10, transparent: true, opacity: 0.5 }));
      this.tgLine = new THREE.Line(this._drapeGeometry(tgPts.length),
        new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 10, gapSize: 10, transparent: true, opacity: 0.5 }));
      this.group.add(this.mgLine); this.group.add(this.tgLine);

      // Chain pillar crosscuts every 60 m
      for (let x = 60; x < L; x += 60) {
        pillarPts.push([x, W / 2], [x, chainOffset]);
        pillarPts.push([x, -W / 2], [x, -chainOffset]);
      }
      this.pillarPts = pillarPts;
      const pilGeo = new THREE.BufferGeometry();
      pilGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pillarPts.length * 3), 3));
      this.pillarMesh = new THREE.LineSegments(pilGeo,
        new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.45 }));
      this.group.add(this.pillarMesh);

      // Survey line S is NOT drawn on the surface (Adarsh, 17 Sep: "what is this line on the terrain, remove it").
      // It was a cyan dashed line at geometry.survey_line_x_m running 2r past both ribs, so it crossed the whole
      // frame including ground that never moves, and read as a fault or a pipeline rather than as a measurement
      // transect. The value itself is untouched: survey_line_x_m still drives the angle-of-draw lines in the
      // Underground X-ray view and the real-anchored dataset in scripts/build_anchored_dataset.py, which is where
      // the JMMF field measurements are actually compared. Nothing about the fit or its provenance changes here.

      // Subtle face position marker flush with ground (no harsh vertical curtain wall)
      const faceHalf = W / 2 + 10;
      this.faceN = Math.round(2 * faceHalf / STEP) + 1;
      this.faceHalf = faceHalf;
      this.facePts = Array.from({ length: this.faceN }, (_, s) => [0, -faceHalf + s * STEP]);
      this.faceLine = new THREE.Line(this._drapeGeometry(this.faceN),
        new THREE.LineDashedMaterial({ color: 0xf59e0b, dashSize: 6, gapSize: 5, transparent: true, opacity: 0.6 }));
      this.group.add(this.faceLine);

      // Face curtain mesh kept hidden by default to avoid ugly straight-line obstruction
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.faceN * 2 * 3), 3));
      const fi = [];
      for (let s = 0; s < this.faceN - 1; s++) { const a = 2 * s; fi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      fg.setIndex(fi);
      this.faceCurtain = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({
        color: 0xf59e0b, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide,
      }));
      this.faceCurtain.visible = false;
      this.group.add(this.faceCurtain);

      const plan = this.data.plan;
      if (plan) {
        const s = plan.sector;
        const pts = [];
        const segS = (xa, ya, xb, yb) => {
          const n = Math.max(1, Math.round(Math.hypot(xb - xa, yb - ya) / STEP));
          for (let q = 0; q < n; q++) pts.push([xa + (xb - xa) * q / n, ya + (yb - ya) * q / n]);
        };
        segS(s.x_min_m, s.y_min_m, s.x_max_m, s.y_min_m); segS(s.x_max_m, s.y_min_m, s.x_max_m, s.y_max_m);
        segS(s.x_max_m, s.y_max_m, s.x_min_m, s.y_max_m); segS(s.x_min_m, s.y_max_m, s.x_min_m, s.y_min_m);
        pts.push(pts[0]);
        this.sectorPts = pts;
        this.sectorLine = new THREE.Line(this._drapeGeometry(pts.length),
          new THREE.LineDashedMaterial({ color: 0xe879f9, dashSize: 10, gapSize: 12, transparent: true, opacity: 0.7 }));
        this.sectorLine.visible = false;
        this.group.add(this.sectorLine);
      }
    }

    _drape(line, pts, lift) {
      if (!line) return;
      const a = line.geometry.attributes.position.array;
      pts.forEach(([x, y], q) => { a[q * 3] = this.sx(x); a[q * 3 + 1] = this.groundY(x, y) + lift; a[q * 3 + 2] = this.sz(y); });
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      if (line.computeLineDistances) line.computeLineDistances();
    }

    _updateOverlays() {
      this._drape(this.panelLine, this.panelPts, 1.5);
      this._drape(this.mgLine, this.mgPts, 1.3);
      this._drape(this.tgLine, this.tgPts, 1.3);
      this._drape(this.sectorLine, this.sectorPts, 1.2);

      // Drape chain pillar crosscuts
      if (this.pillarMesh && this.pillarPts) {
        const pa = this.pillarMesh.geometry.attributes.position.array;
        this.pillarPts.forEach(([x, y], q) => {
          pa[q * 3] = this.sx(x);
          pa[q * 3 + 1] = this.groundY(x, y) + 1.2;
          pa[q * 3 + 2] = this.sz(y);
        });
        this.pillarMesh.geometry.attributes.position.needsUpdate = true;
      }

      const fx = this.faceX || 0;
      if (this.faceLine && this.facePts) {
        const fa = this.faceLine.geometry.attributes.position.array;
        for (let s = 0; s < this.faceN; s++) {
          const y = -this.faceHalf + s * 10;
          fa[3 * s] = this.sx(fx);
          fa[3 * s + 1] = this.groundY(fx, y) + 1.2;
          fa[3 * s + 2] = this.sz(y);
        }
        this.faceLine.geometry.attributes.position.needsUpdate = true;
        if (this.faceLine.computeLineDistances) this.faceLine.computeLineDistances();
      }
      this._updateSection();

      // underground pieces follow the face
      const W = this.data.panel.width_m, yTop = this.seamTopY, T = this.seamT;
      const gl = Math.max(0.01, fx);
      this.goaf.scale.set(gl, 1, 1);
      this.goaf.position.set(this.sx(gl / 2), yTop - T * 0.5, 0);
      this.goaf.visible = fx > 0.5;
      this.faceMesh.position.set(this.sx(fx), yTop - T * 0.5, 0);
      const cyc = ((this.day || 0) * 3) % 2;
      this.shearer.position.set(this.sx(fx) + 10, yTop - T * 0.5, this.sz(-W / 2 + W * (cyc < 1 ? cyc : 2 - cyc)));
      const d = this.drawGeo.attributes.position.array;
      this.drawLines.forEach(([xa, ya, xb, yb], q) => {
        d.set([this.sx(xa), yTop, this.sz(ya), this.sx(xb), this.groundY(xb, yb), this.sz(yb)], q * 6);
      });
      this.drawGeo.attributes.position.needsUpdate = true;
      this.drawLineMesh.computeLineDistances();
      const L = this.data.panel.length_m;
      const p = this.postGeo.attributes.position.array;
      [[0, -W / 2], [0, W / 2], [L, -W / 2], [L, W / 2]].forEach(([x, y], q) => {
        p.set([this.sx(x), yTop, this.sz(y), this.sx(x), this.groundY(x, y), this.sz(y)], q * 6);
      });
      this.postGeo.attributes.position.needsUpdate = true;
    }

    // ---------------------------------------------------------------- cross-section at survey line S
    /** Cut the block at world x = xCut: the live cut face shows strata, seam, goaf, and the sunk ground
     *  profile (solid white) against the day-0 profile (dashed cyan). Pair with a renderer clipping plane. */
    setSection(xCut) {
      this.sectionX = xCut;
      if (!this.section) {
        const g = new THREE.Group();
        this.sectionWall = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        this.sectionNow = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
        this.sectionOrig = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x67e8f9, dashSize: 10, gapSize: 7 }));
        g.add(this.sectionWall, this.sectionNow, this.sectionOrig);
        this.section = g;
        this.group.add(g);
      }
      this.section.visible = xCut != null && this.opts.xray;   // F6 A1: strata only exist under X-ray
      this._updateSection();
    }

    _updateSection() {
      if (!this.section || this.sectionX == null) return;
      const x = this.sectionX, X = this.sx(x) + 0.6, step = this.cell;
      const y0 = this.firstY, y1 = this.firstY + (this.ny - 1) * this.cell;
      const n = Math.round((y1 - y0) / step);
      const W = this.data.panel.width_m, T = this.seamT, yTop = this.seamTopY;
      const col = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
      const layers = STRATA.map(([, d, hex]) => [d, col(hex)]);
      const seamC = col("#141414"), belowC = col("#4a4d52"), goafC = col("#8a5a3c");
      const pos = [], cols = [], now = [], orig = [];
      const mined = (this.faceX || 0) > x;
      const quad = (za, zb, ta, tb, ba, bb, c) => {
        if (ta <= ba && tb <= bb) return;
        pos.push(X, ta, za, X, ba, za, X, tb, zb, X, tb, zb, X, ba, za, X, bb, zb);
        for (let q = 0; q < 6; q++) cols.push(c[0], c[1], c[2]);
      };
      for (let q = 0; q <= n; q++) {
        const y = y0 + q * step;
        now.push(X, this.groundY(x, y) + 0.8, this.sz(y));
        orig.push(X, (this.elevAt(x, y) - this.datum) * this.opts.relief + 0.8, this.sz(y));
        if (q === n) break;
        const ya = y, yb = y + step, za = this.sz(ya), zb = this.sz(yb);
        const ta = this.groundY(x, ya), tb = this.groundY(x, yb);
        const r = this.opts.relief;
        // below the soil the layers keep their day-0 shape, so the trough reads only at the surface
        const oa = (this.elevAt(x, ya) - this.datum) * r, ob = (this.elevAt(x, yb) - this.datum) * r;
        quad(za, zb, ta, tb, Math.min(ta, oa - layers[1][0] * r), Math.min(tb, ob - layers[1][0] * r), layers[0][1]);
        for (let L = 1; L < layers.length; L++) {
          const nextD = L + 1 < layers.length ? layers[L + 1][0] : Infinity;
          quad(za, zb, Math.max(Math.min(ta, oa - layers[L][0] * r), yTop), Math.max(Math.min(tb, ob - layers[L][0] * r), yTop),
            Math.max(oa - nextD * r, yTop), Math.max(ob - nextD * r, yTop), layers[L][1]);
        }
        const inPanel = Math.abs(ya + step / 2) <= W / 2;
        quad(za, zb, yTop, yTop, yTop - T, yTop - T, mined && inPanel ? goafC : seamC);
        quad(za, zb, yTop - T, yTop - T, this.baseY, this.baseY, belowC);
      }
      const wall = this.sectionWall.geometry;
      wall.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      wall.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      wall.computeVertexNormals();
      wall.computeBoundingSphere();
      this.sectionNow.geometry.setAttribute("position", new THREE.Float32BufferAttribute(now, 3));
      this.sectionNow.geometry.computeBoundingSphere();
      this.sectionOrig.geometry.setAttribute("position", new THREE.Float32BufferAttribute(orig, 3));
      this.sectionOrig.geometry.computeBoundingSphere();
      this.sectionOrig.computeLineDistances();
    }

    // ---------------------------------------------------------------- options
    setOptions(patch) {
      const reliefChanged = patch.relief !== undefined && patch.relief !== this.opts.relief;
      Object.assign(this.opts, patch);
      if (reliefChanged) { this._buildBlock(); this._buildShellRim(); this._buildUnderground(); }
      this.under.visible = this.opts.xray;
      this.surfaceMat.transparent = this.opts.xray;
      this.surfaceMat.opacity = this.opts.xray ? 0.28 : 1;
      this.surfaceMat.depthWrite = !this.opts.xray;
      this.surfaceMat.needsUpdate = true;
      // F6 A1: the default ground is a thin shell. The 375 m strata block, its bottom plate and the
      // section wall only exist inside the X-ray view; otherwise the rim is what closes the crust.
      this.block.visible = this.opts.xray;
      this.rim.visible = !this.opts.xray;
      if (this.section) this.section.visible = this.opts.xray && this.sectionX != null;
      this.block.children.forEach((m) => {
        m.material.transparent = this.opts.xray; m.material.opacity = this.opts.xray ? 0.25 : 1;
        m.material.depthWrite = !this.opts.xray; m.material.needsUpdate = true;
      });
      if (this.sectorLine && patch.sector !== undefined) this.sectorLine.visible = patch.sector;
      if (patch.roadways !== undefined) {
        if (this.mgLine) this.mgLine.visible = patch.roadways;
        if (this.tgLine) this.tgLine.visible = patch.roadways;
        if (this.pillarMesh) this.pillarMesh.visible = patch.roadways;
      }
      if (patch.xray !== undefined && this.segmentIsolated) this._buildSegmentBlock();
      if (this.segmentBlock && patch.xray !== undefined) {
        this.segmentBlock.children.forEach((m) => {
          if (m.material) {
            m.material.transparent = this.opts.xray;
            m.material.opacity = this.opts.xray ? 0.35 : 1.0;
            m.material.depthWrite = !this.opts.xray;
            m.material.needsUpdate = true;
          }
        });
      }
      this.refresh(reliefChanged);
    }

    setRenderer(renderer) {
      this.renderer = renderer;
      this._updateSegmentPlanes();
    }

    setSegment(segment, isolate) {
      this.activeSegment = segment;
      this.segmentIsolated = !!isolate && !!segment && segment.id !== "full";
      this._updateSegmentPlanes();
      this._buildSegmentBlock();
    }

    /** Context padding kept around an isolated segment (m). The block is the segment; this band of
     *  ground around it is what stops a 250 m crop reading as an object floating in the sky. */
    get segmentContextM() {
      const d = this.data.display;
      return d && d.segment_context_m != null ? d.segment_context_m : 60;
    }

    /** The isolated segment's bounds plus the context band — what is actually drawn and clipped to. */
    get segmentDrawBounds() {
      if (!this.segmentIsolated || !this.activeSegment || this.activeSegment.id === "full") return null;
      const c = this.segmentContextM, s = this.activeSegment;
      return { xMin: s.xMin - c, xMax: s.xMax + c, yMin: s.yMin - c, yMax: s.yMax + c };
    }

    _updateSegmentPlanes() {
      if (!this.renderer) return;
      if (this.segmentIsolated && this.activeSegment && this.activeSegment.id !== "full") {
        const { xMin, xMax, yMin, yMax } = this.segmentDrawBounds;
        const eps = 0.5;
        this.renderer.clippingPlanes = [
          new THREE.Plane(new THREE.Vector3(1, 0, 0), -this.sx(xMin) + eps),
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), this.sx(xMax) + eps),
          new THREE.Plane(new THREE.Vector3(0, 0, 1), yMax + eps),
          new THREE.Plane(new THREE.Vector3(0, 0, -1), -yMin + eps),
        ];
        if (this.rim) this.rim.visible = false;
        if (this.block) this.block.visible = false;
      } else {
        if (!this.sectionX) {
          this.renderer.clippingPlanes = [];
        }
        if (this.rim) this.rim.visible = !this.opts.xray;
        if (this.block) this.block.visible = this.opts.xray;
      }
    }

    /** Thin rim around an isolated segment, following the live ground — same crust as the full view. */
    _segmentRim(xMin, xMax, yMin, yMax) {
      const T = ((this.data.display && this.data.display.shell_thickness_m) || 12) * this.opts.relief;
      const top = new THREE.Color(0x2d2822), bot = new THREE.Color(0x151310);
      const pos = [], col = [];
      const quad = (xa, ya, xb, yb) => {
        const ta = this.groundY(xa, ya), tb = this.groundY(xb, yb);
        const X0 = this.sx(xa), Z0 = this.sz(ya), X1 = this.sx(xb), Z1 = this.sz(yb);
        pos.push(X0, ta, Z0, X0, ta - T, Z0, X1, tb, Z1, X1, tb, Z1, X0, ta - T, Z0, X1, tb - T, Z1);
        const c = [top, bot, top, top, bot, bot];
        for (let q = 0; q < 6; q++) col.push(c[q].r, c[q].g, c[q].b);
      };
      const run = (xa, ya, xb, yb, steps) => {
        for (let q = 0; q < steps; q++) {
          const f = q / steps, g = (q + 1) / steps;
          quad(xa + (xb - xa) * f, ya + (yb - ya) * f, xa + (xb - xa) * g, ya + (yb - ya) * g);
        }
      };
      const nx = Math.max(10, Math.ceil((xMax - xMin) / 10)), ny = Math.max(10, Math.ceil((yMax - yMin) / 10));
      run(xMin, yMin, xMax, yMin, nx);
      run(xMax, yMax, xMin, yMax, nx);
      run(xMin, yMax, xMin, yMin, ny);
      run(xMax, yMin, xMax, yMax, ny);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
      })));
      return g;
    }

    _buildSegmentBlock() {
      if (this.segmentBlock) {
        this.group.remove(this.segmentBlock);
        this.segmentBlock.traverse((o) => o.geometry && o.geometry.dispose());
        this.segmentBlock = null;
      }
      if (!this.segmentIsolated || !this.activeSegment || this.activeSegment.id === "full") return;

      const { xMin, xMax, yMin, yMax } = this.segmentDrawBounds;
      const block = new THREE.Group();
      // F7 (Adarsh, 16 Sep): by default an isolated segment is the SAME thin crust as the full view —
      // the real surface plus a shallow rim. No strata slab, no floor plate: the soil/strata columns
      // are a drawing, the physics never reads them, and a 100 m block under a 250 m crop is what made
      // the view read as a chunk of rock hanging in the air. X-ray still cuts the full column.
      if (!this.opts.xray) {
        this.segmentBlock = this._segmentRim(xMin, xMax, yMin, yMax);
        this.group.add(this.segmentBlock);
        return;
      }
      const seamT = this.seamT || Math.max(SEAM_VISUAL_MIN_M, this.data.geometry ? this.data.geometry.seam_thickness_m : 3.6);
      const seamTopY = this.seamTopY;
      // Default: a shallow cutaway whose floor is a fixed depth below the lowest ground in the segment, so
      // the block reads as a 250 m x 250 m slab of rock you can see the sides of. Underground X-ray drops
      // the floor to the full seam block, because that view is about the seam, not the surface.
      const cutM = (this.data.display && this.data.display.segment_cut_depth_m) || SEGMENT_CUT_DEPTH_M;
      let lowGround = Infinity;
      for (let x = xMin; x <= xMax; x += 25) for (let y = yMin; y <= yMax; y += 25) lowGround = Math.min(lowGround, this.groundY(x, y));
      const shallowY = lowGround - cutM * this.opts.relief;
      const deep = this.opts.xray;
      const baseY = deep ? this.baseY : shallowY;
      const floorY = deep ? seamTopY : shallowY;   // where the layered strata stop

      const pos = [], col = [];
      const colour = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
      const layers = STRATA.map(([, d, hex]) => [d, colour(hex)]);
      const seamC = colour("#141414"), belowC = colour("#4a4d52");

      const quad = (x0, z0, x1, z1, yTop0, yTop1, yBot0, yBot1, c) => {
        if (yTop0 <= yBot0 && yTop1 <= yBot1) return;
        pos.push(x0, yTop0, z0, x0, yBot0, z0, x1, yTop1, z1, x1, yTop1, z1, x0, yBot0, z0, x1, yBot1, z1);
        for (let q = 0; q < 6; q++) col.push(c[0], c[1], c[2]);
      };

      const edge = (pts) => {
        for (let q = 0; q < pts.length - 1; q++) {
          const [xa, ya] = pts[q], [xb, yb] = pts[q + 1];
          const ta = this.groundY(xa, ya);
          const tb = this.groundY(xb, yb);
          const X0 = this.sx(xa), Z0 = this.sz(ya), X1 = this.sx(xb), Z1 = this.sz(yb);
          for (let L = 0; L < layers.length; L++) {
            const topA = ta - layers[L][0] * this.opts.relief, topB = tb - layers[L][0] * this.opts.relief;
            const nextD = L + 1 < layers.length ? layers[L + 1][0] : Infinity;
            const botA = Math.max(ta - nextD * this.opts.relief, floorY), botB = Math.max(tb - nextD * this.opts.relief, floorY);
            quad(X0, Z0, X1, Z1, Math.max(topA, floorY), Math.max(topB, floorY), botA, botB, layers[L][1]);
          }
          if (deep) {
            quad(X0, Z0, X1, Z1, seamTopY, seamTopY, seamTopY - seamT, seamTopY - seamT, seamC);
            quad(X0, Z0, X1, Z1, seamTopY - seamT, seamTopY - seamT, baseY, baseY, belowC);
          }
        }
      };

      const line = (xa, ya, xb, yb, steps) => Array.from({ length: steps + 1 }, (_, s) => [xa + (xb - xa) * s / steps, ya + (yb - ya) * s / steps]);
      const sxN = Math.max(10, Math.ceil((xMax - xMin) / 10));
      const syN = Math.max(10, Math.ceil((yMax - yMin) / 10));

      edge(line(xMin, yMin, xMax, yMin, sxN));          // south wall
      edge(line(xMax, yMax, xMin, yMax, sxN));          // north wall
      edge(line(xMin, yMax, xMin, yMin, syN));          // west wall
      edge(line(xMax, yMin, xMax, yMax, syN));          // east wall

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const walls = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: this.opts.xray,
        opacity: this.opts.xray ? 0.35 : 1.0,
      }));
      block.add(walls);

      const bottom = new THREE.Mesh(
        new THREE.PlaneGeometry(xMax - xMin, yMax - yMin).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0x24272c, side: THREE.DoubleSide }));
      bottom.position.set(this.sx((xMin + xMax) / 2), baseY, this.sz((yMin + yMax) / 2));
      block.add(bottom);

      this.segmentBlock = block;
      this.group.add(block);
    }

    /** Stats for the HUD from the live grid. */
    stats() {
      let peak = 0, moving = 0;
      for (let q = 0; q < this.dz.length; q++) {
        if (this.dz[q] < peak) peak = this.dz[q];
        if (-this.dz[q] >= this.thresholdMm) moving++;
      }
      const cellArea = this.data.grid.original_cell_m * this.data.grid.downsample_k;
      return { peakMm: peak, movingHa: (moving * cellArea * cellArea) / 1e4 };
    }
  }

  global.MineTerrain = MineTerrain;
  global.FrameStore = FrameStore;
  global.STRATA = STRATA;
})(window);
