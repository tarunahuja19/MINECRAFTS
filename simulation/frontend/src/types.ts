export type SegmentState = "STABLE" | "SETTLING" | "TENSION" | "CRITICAL" | "FAILED";

/**
 * The colour each zone state is drawn in, so a state reads the same wherever
 * it appears. This lived as two identical copies, in RightInspectorPanel and
 * TelemetryDrawer — the inspector and the table could therefore disagree
 * about what CRITICAL looks like after a one-sided edit. It sits here because
 * `SegmentState` does, and every consumer already imports from this module.
 *
 * TENSION and CRITICAL deliberately share --state-warning: the palette has
 * three state colours and these are two of five states, so the split falls
 * between "the ground is moving" and "the ground has gone".
 */
export const STATE_COLORS: Record<SegmentState, string> = {
  STABLE: "var(--state-active)",
  SETTLING: "var(--state-info-alt)",
  TENSION: "var(--state-warning)",
  CRITICAL: "var(--state-critical)",
  FAILED: "var(--state-critical)",
};

/**
 * The six node tiers (MESH_UPGRADE_BRIEF.md section 1). Tier determines both
 * what sensors a node carries and where it is placed:
 *
 *   1A  Scout   baseline/flat     flat interior of the subsidence bowl
 *   1B  Scout   tension/shear     the high-strain panel edge bands
 *   1C  Scout   fault/water       along the fault corridor
 *   2A  Anchor  mesh router       spread over the monitoring rectangle
 *   2B  Anchor  geotech borehole  sparse, over the panel
 *   3   Gateway master sink       outside the angle of draw
 */
export type NodeTier = "1A" | "1B" | "1C" | "2A" | "2B" | "3";

export const SCOUT_TIERS: NodeTier[] = ["1A", "1B", "1C"];
export const ANCHOR_TIERS: NodeTier[] = ["2A", "2B"];

export interface NodeDef {
  id: number;
  x: number;
  y: number;
  tier: NodeTier;
  role: string;
  /** Commissioned mesh DAG. Planned by the network planner, not derived
   *  from proximity — see the brief's section 4. Gateway has nulls. */
  parent_id: number | null;
  backup_parent_id: number | null;
  cluster_id: number | null;
  /** 0 gateway, 1 anchor, 2 scout. */
  hop_count: number;
  dist_to_parent_m: number | null;
  tx_dbm: number | null;
}

export interface ZoneDef {
  id: string;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  cx: number;
  cy: number;
}

export interface InitPayload {
  type: "init";
  window_size_m: number;
  grid_n: number;
  mesh_n: number;
  base_peak_subsidence: number;
  speed_multiplier: number;
  z0_mesh: number[][];
  base_bowl_mesh: number[][];
  nodes: NodeDef[];
  zones: ZoneDef[];
  dem_source?: string;
  dem_lat?: number;
  dem_lon?: number;
  /** Compass bearing of the panel long axis, from sandbox.geo. Sent so the
   *  3D view projects metres exactly as the map and the database do. */
  panel_bearing_deg?: number;
  elev_min_m?: number;
  elev_max_m?: number;
  elev_relief_m?: number;
  contour_interval_m?: number;
  contour_index_m?: number;
}

export interface Perturbation {
  cx: number;
  cy: number;
  radius_m: number;
  amp: number;
  yield?: number;
}

/**
 * One node's per-tick reading.
 *
 * Every channel is `number | null`, and null is LOAD-BEARING: it means this
 * node's tier does not carry that hardware at all, which is categorically
 * different from the sensor reading zero. The brief calls this the critical
 * read rule — never coerce a null to 0 (`?? 0`, `|| 0`, `fillna(0)`), because
 * a 2A anchor with no strain gauge would then be indistinguishable from one
 * sitting on perfectly unstrained ground.
 *
 * Which channels are non-null is decided by tier; see `NodeTier`.
 */
export interface NodeTelemetry {
  id: number;
  seq?: number;
  tilt_x: number | null;
  tilt_y: number | null;
  strain: number | null;
  vib_rms: number | null;
  vib_peak: number | null;
  vib_fdom: number | null;
  rssi: number | null;
  snr: number | null;
  alive: number;
  node_state?: string;
}

export interface ZoneTelemetry {
  id: string;
  state: SegmentState;
  eps: number;
  kappa: number;
}

export interface TickPayload {
  t_sim: number;
  t_days: number;
  time_scalar: number;
  speed_multiplier: number;
  vibration_active?: boolean;
  vibration_ppv?: number;
  perturbations: Perturbation[];
  nodes: NodeTelemetry[];
  segments: ZoneTelemetry[];
}

export interface LogEntry {
  id: string;
  timeStr: string;
  zoneId: string;
  state: SegmentState;
  eps: number;
  kappa: number;
  message: string;
  timestamp: Date;
}

export interface TargetLocation {
  x: number;
  y: number;
  label: string;
  elev?: number;
  slopeDeg?: number;
  zoneName?: string;
}

export interface LiveMathEvaluation {
  x: number;
  y: number;
  t_days: number;
  dist_from_center: number;
  base_s_m: number;
  collapse_delta_m: number;
  total_s_m: number;
  tilt_mm_m: number;
  curvature_per_m: number;
  strain_mm_m: number;
  time_factor: number;
}

/**
 * The ground interventions the operator can fire.
 *
 * Lived in components/MachineConsole.tsx, a 531-line console component that
 * was never rendered anywhere — the file survived purely because these two
 * types were exported from it, so four modules imported a dead component's
 * module to get a string union. The component is deleted; the types that
 * were actually in use moved here, where the rest of the wire and UI types
 * already live.
 *
 * "pillar" and "strain" were removed with it. Both fired the same collapse
 * kernel as "collapse" — pillar at ΔZ x 1.15 / R x 1.10 (inside what the
 * severity slider already covers) and strain at a deliberately shallow,
 * tight geometry its own docs described as "often barely visible as a dip".
 * Neither produced a bowl a viewer could tell from STANDARD, which is the
 * only thing a separate control can be for.
 */
export type PhysicalEventType = "collapse" | "stress" | "tilt" | "vibration";

/** Distance from the selected sensor node to one of its nearest neighbours. */
export interface NeighborDistance {
  id: number;
  distM: number;
  deltaMm: number;
}

// ---------------------------------------------------------------------------
// 60-Second Simulation Packet (§Phase 1 & Phase 7)
// ---------------------------------------------------------------------------

export interface PacketAvailableNotification {
  type: "packet_available";
  packet_id: number;
  session_id: string;
  grid_id: string;
  start_sim_time: number;
  end_sim_time: number;
}

export interface NodePacketAggregates {
  max_strain: number | null;
  max_tilt_x: number | null;
  max_tilt_y: number | null;
  max_tilt_magnitude: number | null;
  max_displacement: number | null;
  max_temperature: number | null;
  min_battery: number | null;
  max_vib_peak: number | null;
  max_vib_rms: number | null;
  last_alive: number;
  last_seq: number;
}

export interface NodePacketRecord {
  node_id: number;
  tier: NodeTier;
  aggregates: NodePacketAggregates;
  raw_aggregates?: Record<string, any>;
  reading_count: number;
  last_reading: Record<string, any>;
}

export interface TerrainPacketState {
  changed: boolean;
  max_subsidence_m: number;
  changes: Perturbation[];
}

export interface SimulationPacket {
  packet_id: number;
  session_id: string;
  grid_id: string;
  start_sim_time: number;
  end_sim_time: number;
  nodes: NodePacketRecord[];
  terrain: TerrainPacketState;
  events: Array<Record<string, any>>;
}

