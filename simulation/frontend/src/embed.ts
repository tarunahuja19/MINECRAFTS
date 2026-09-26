/**
 * Embed mode: run the 3D viewport inside the operator dashboard's Simulation
 * tab (as an iframe), cropped to the operator's selected region.
 *
 * URL params (all optional; `embed=1` switches the App into viewport-only
 * layout):
 *   xmin, xmax, ymin, ymax — panel-frame metres of the selected region.
 *   nodes                  — comma-separated numeric node ids to render.
 *   day                    — parent mining-day label (display only).
 *   exag                   — initial vertical exaggeration.
 *   label                  — parent selection label (display only).
 *   slot                   — owning dashboard tab: "sim" or "forge". The FORGE
 *                            slot is a sandbox view, so engine packet-sync
 *                            toasts are suppressed there (SIM only).
 *
 * After load, the parent drives the viewport via postMessage commands
 * (`EmbedParentCommand`, source `R4_SIM_EMBED_SOURCE`) so the iframe never
 * needs a reload when the selection changes. Events flow back with source
 * `R4_SIM_VIEWPORT_SOURCE` (`EmbedChildEvent`).
 */

export interface EmbedClipBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface EmbedParams {
  isEmbed: boolean;
  clip: EmbedClipBounds | null;
  nodeIds: number[] | null;
  day: number | null;
  exag: number | null;
  label: string | null;
  slot: string | null;
}

export const R4_SIM_EMBED_SOURCE = "r4-sim-embed";
export const R4_SIM_VIEWPORT_SOURCE = "r4-sim-viewport";

export type EmbedParentCommand =
  | { source: typeof R4_SIM_EMBED_SOURCE; cmd: "set-bounds"; bounds: EmbedClipBounds | null; nodes?: number[] | null; label?: string | null }
  | { source: typeof R4_SIM_EMBED_SOURCE; cmd: "set-view"; pitchDeg: number; bearingDeg: number }
  | { source: typeof R4_SIM_EMBED_SOURCE; cmd: "recenter"; bounds?: EmbedClipBounds | null }
  | { source: typeof R4_SIM_EMBED_SOURCE; cmd: "set-exag"; value: number }
  | { source: typeof R4_SIM_EMBED_SOURCE; cmd: "set-day"; day: number }
  | { source: typeof R4_SIM_EMBED_SOURCE; cmd: "select-node"; id: number | null }
  | { source: typeof R4_SIM_EMBED_SOURCE; cmd: "start" }
  | { source: typeof R4_SIM_EMBED_SOURCE; cmd: "pause" }
  /** Clear this frame's own triggered effects; the live ground is untouched. */
  | { source: typeof R4_SIM_EMBED_SOURCE; cmd: "reset-local" }
  | {
      source: typeof R4_SIM_EMBED_SOURCE;
      cmd: "trigger";
      type: "collapse" | "tilt" | "vibration";
      cx: number;
      cy: number;
      sev: number;
      rad: number;
      /** Optional vibration peak (mm/s); engine default when absent. */
      ppv?: number;
      /** Optional vibration duration (s); engine default when absent. */
      durS?: number;
    }
  | {
      source: typeof R4_SIM_EMBED_SOURCE;
      cmd: "set-cracks";
      /** Crack segments in app mine-frame metres; empty list clears. */
      segments: Array<{ x0: number; y0: number; x1: number; y1: number; width_mm: number; isNew: boolean }>;
    }
  | {
      source: typeof R4_SIM_EMBED_SOURCE;
      cmd: "forge-frame";
      frame: {
        t_sim?: number;
        t_days: number;
        time_scalar?: number;
        bowl_py?: number[];
        face_y_m?: number;
        speed_multiplier?: number;
        perturbations?: Array<{ cx: number; cy: number; radius_m: number; amp: number; yield?: number }>;
        nodes?: Array<{ id: number; node_id?: number; node_state?: string; [key: string]: any }>;
        node_states?: Record<string, string>;
        [key: string]: any;
      };
    }
  | {
      source: typeof R4_SIM_EMBED_SOURCE;
      cmd: "forge-effect";
      /** FORGE only: dust, shake and toast. The ground comes from forge-frame. */
      type: "cave_in" | "tilt" | "vibration";
      cx: number;
      cy: number;
      rad: number;
      depth: number;
      /** vibration only: PPV in mm/s */
      ppv?: number;
    }
  | {
      source: typeof R4_SIM_EMBED_SOURCE;
      cmd: "forge-preview";
      x?: number | null;
      y?: number | null;
      radius_m?: number | null;
      /** CRACK preview: a dashed line A-B in panel-frame metres; replaces the ring. */
      line?: { x0: number; y0: number; x1: number; y1: number } | null;
    };

export type EmbedChildEvent =
  | { source: typeof R4_SIM_VIEWPORT_SOURCE; event: "ready" }
  | { source: typeof R4_SIM_VIEWPORT_SOURCE; event: "node-select"; id: number | null }
  | {
      source: typeof R4_SIM_VIEWPORT_SOURCE;
      event: "terrain-target";
      x: number;
      y: number;
      elev: number;
      slopeDeg: number;
      zoneName: string;
    }
  | {
      source: typeof R4_SIM_VIEWPORT_SOURCE;
      event: "status";
      connected: boolean;
      running: boolean;
      tDays: number;
      nodes: number;
      /** Longwall face position in panel-frame metres, when the server sends it. */
      faceYM?: number;
    }
  | {
      source: typeof R4_SIM_VIEWPORT_SOURCE;
      event: "forge-frame-applied";
      t_days: number;
      perturbations: number;
      max_amp: number;
      time_scalar: number;
    };

function num(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseEmbedParams(search?: string): EmbedParams {
  const empty: EmbedParams = {
    isEmbed: false,
    clip: null,
    nodeIds: null,
    day: null,
    exag: null,
    label: null,
    slot: null,
  };
  let params: URLSearchParams;
  try {
    params =
      typeof search === "string"
        ? new URLSearchParams(search.startsWith("?") ? search : `?${search}`)
        : new URLSearchParams(window.location.search);
  } catch {
    return empty;
  }

  const isEmbed = params.get("embed") === "1";
  if (!isEmbed) return empty;

  const xMin = num(params.get("xmin"));
  const xMax = num(params.get("xmax"));
  const yMin = num(params.get("ymin"));
  const yMax = num(params.get("ymax"));
  const clip =
    xMin !== null && xMax !== null && yMin !== null && yMax !== null && xMax > xMin && yMax > yMin
      ? { xMin, xMax, yMin, yMax }
      : null;

  let nodeIds: number[] | null = null;
  const rawNodes = params.get("nodes");
  if (rawNodes !== null && rawNodes !== "") {
    const ids = rawNodes
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    nodeIds = ids.length > 0 ? Array.from(new Set(ids)) : [];
  }

  return {
    isEmbed: true,
    clip,
    nodeIds,
    day: num(params.get("day")),
    exag: num(params.get("exag")),
    label: params.get("label"),
    slot: params.get("slot"),
  };
}

/**
 * FORGE is a private playground: it may READ the live engine (ticks, packets,
 * node details) but must never WRITE to it — no start/pause/speed, no
 * interventions, no resets. Anything it does stays inside its own frame.
 */
export function isEngineReadOnly(p: EmbedParams): boolean {
  return p.isEmbed && p.slot === "forge";
}

/**
 * Child-event payloads without the source tag. Written out instead of
 * `Omit<EmbedChildEvent, "source">` because Omit does not distribute over the
 * union and would only accept the properties common to every variant.
 */
export type EmbedChildPayload =
  | { event: "ready" }
  | { event: "node-select"; id: number | null }
  | {
      event: "terrain-target";
      x: number;
      y: number;
      elev: number;
      slopeDeg: number;
      zoneName: string;
    }
  | {
      event: "status";
      connected: boolean;
      running: boolean;
      tDays: number;
      nodes: number;
      /** Longwall face position in panel-frame metres, when the server sends it. */
      faceYM?: number;
    }
  | {
      event: "forge-frame-applied";
      t_days: number;
      perturbations: number;
      max_amp: number;
      time_scalar: number;
    };

/** Post an event to the embedding parent. No-op outside an iframe. */
export function postEmbedEvent(msg: EmbedChildPayload): void {
  try {
    if (typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage(
      { ...msg, source: R4_SIM_VIEWPORT_SOURCE },
      "*",
    );
  } catch {
    // Parent unreachable (navigated away) — nothing to report to.
  }
}
