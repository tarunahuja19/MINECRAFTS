import React, { useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { NodeDef, NodeTelemetry, NodeTier, Perturbation, SegmentState, SimulationPacket } from "../types";
import { globalGeomechanics } from "../utils/geomechanicsEngine";
import { sampleBaseGroundY } from "../utils/terrainSampler";
import { ADRIYALA } from "../utils/geomechanicsEngine";
import { formatLatLon, xyToLatLon } from "../utils/geo";

const DGMS_TENSILE = ADRIYALA.DGMS_TENSILE_MM_PER_M;

interface NodeMarkersProps {
  nodes: NodeDef[];
  nodeTelemetry: NodeTelemetry[];
  z0Mesh?: number[][];
  baseBowlMesh?: number[][];
  timeScalar: number;
  perturbations: Perturbation[];
  latestPacket?: SimulationPacket | null;
  exaggeration: number;
  selectedNodeId: number | null;
  onSelectNode: (id: number) => void;
  showMeshTopology?: boolean;
  windowSizeM?: number;
}

const STATE_COLORS: Record<SegmentState, string> = {
  STABLE: "#00CC44",   // Emerald / Active
  SETTLING: "#7fa0b5", // Sky
  TENSION: "#FFA500",  // Amber / Warning
  CRITICAL: "#FF2222", // Vivid Red
  FAILED: "#FF4400",   // Orange-Red / Lastgasp
};

/**
 * Offline stand-in for the server's node layout, used only until the init
 * payload arrives (or when the backend is down).
 *
 * DUMPED FROM THE SERVER, not hand-typed: this is the literal output of
 * `sandbox.server._node_defs()` for the frozen layout seed. Placement is
 * seeded Poisson-disc (MESH_UPGRADE_BRIEF.md section 2) rather than a rule
 * simple enough to restate in a loop, so the only honest way to keep the
 * offline view agreeing with the server is to copy what the server emits.
 *
 * The previous version generated an 11x7 grid from a formula. That layout no
 * longer exists on either side: the brief replaced the uniform grid outright,
 * on the grounds that "a GNN trained on a grid memorises the grid".
 *
 * If the layout seed or node counts change server-side, re-dump this block.
 */
export const FALLBACK_NODES: NodeDef[] = [
  { id: 1, x: -135.0, y: 135.0, tier: "1A", role: "Scout / baseline", parent_id: 29, backup_parent_id: 26, cluster_id: 29, hop_count: 2, dist_to_parent_m: 142.30, tx_dbm: 5 },
  { id: 2, x: -5.0, y: 100.0, tier: "1A", role: "Scout / baseline", parent_id: 29, backup_parent_id: 26, cluster_id: 29, hop_count: 2, dist_to_parent_m: 80.16, tx_dbm: 5 },
  { id: 3, x: 135.0, y: 138.0, tier: "1A", role: "Scout / baseline", parent_id: 29, backup_parent_id: 26, cluster_id: 29, hop_count: 2, dist_to_parent_m: 141.38, tx_dbm: 5 },
  { id: 4, x: -140.0, y: 5.0, tier: "1A", role: "Scout / baseline", parent_id: 30, backup_parent_id: 29, cluster_id: 30, hop_count: 2, dist_to_parent_m: 232.00, tx_dbm: 10 },
  { id: 5, x: 0.0, y: 0.0, tier: "1A", role: "Scout / baseline", parent_id: 29, backup_parent_id: 30, cluster_id: 29, hop_count: 2, dist_to_parent_m: 180.00, tx_dbm: 10 },
  { id: 6, x: 140.0, y: -5.0, tier: "1A", role: "Scout / baseline", parent_id: 30, backup_parent_id: 29, cluster_id: 30, hop_count: 2, dist_to_parent_m: 224.11, tx_dbm: 10 },
  { id: 7, x: -135.0, y: -160.0, tier: "1A", role: "Scout / baseline", parent_id: 30, backup_parent_id: 27, cluster_id: 30, hop_count: 2, dist_to_parent_m: 136.47, tx_dbm: 5 },
  { id: 8, x: 5.0, y: -100.0, tier: "1A", role: "Scout / baseline", parent_id: 30, backup_parent_id: 29, cluster_id: 30, hop_count: 2, dist_to_parent_m: 80.16, tx_dbm: 5 },
  { id: 9, x: 135.0, y: -138.0, tier: "1A", role: "Scout / baseline", parent_id: 30, backup_parent_id: 28, cluster_id: 30, hop_count: 2, dist_to_parent_m: 141.38, tx_dbm: 5 },
  { id: 10, x: -216.0, y: 250.0, tier: "1B", role: "Scout / tension", parent_id: 26, backup_parent_id: 29, cluster_id: 26, hop_count: 2, dist_to_parent_m: 217.44, tx_dbm: 10 },
  { id: 11, x: -192.0, y: 125.0, tier: "1B", role: "Scout / tension", parent_id: 26, backup_parent_id: 29, cluster_id: 26, hop_count: 2, dist_to_parent_m: 243.65, tx_dbm: 10 },
  { id: 12, x: -204.0, y: 20.0, tier: "1B", role: "Scout / tension", parent_id: 27, backup_parent_id: 29, cluster_id: 27, hop_count: 2, dist_to_parent_m: 239.28, tx_dbm: 10 },
  { id: 13, x: -216.0, y: -125.0, tier: "1B", role: "Scout / tension", parent_id: 27, backup_parent_id: 30, cluster_id: 27, hop_count: 2, dist_to_parent_m: 100.70, tx_dbm: 5 },
  { id: 14, x: -192.0, y: -250.0, tier: "1B", role: "Scout / tension", parent_id: 27, backup_parent_id: 30, cluster_id: 27, hop_count: 2, dist_to_parent_m: 87.66, tx_dbm: 5 },
  { id: 15, x: 192.0, y: 250.0, tier: "1B", role: "Scout / tension", parent_id: 26, backup_parent_id: 29, cluster_id: 26, hop_count: 2, dist_to_parent_m: 193.62, tx_dbm: 10 },
  { id: 16, x: 216.0, y: 125.0, tier: "1B", role: "Scout / tension", parent_id: 26, backup_parent_id: 29, cluster_id: 26, hop_count: 2, dist_to_parent_m: 262.98, tx_dbm: 10 },
  { id: 17, x: 204.0, y: -20.0, tier: "1B", role: "Scout / tension", parent_id: 28, backup_parent_id: 30, cluster_id: 28, hop_count: 2, dist_to_parent_m: 201.14, tx_dbm: 10 },
  { id: 18, x: 192.0, y: -125.0, tier: "1B", role: "Scout / tension", parent_id: 28, backup_parent_id: 30, cluster_id: 28, hop_count: 2, dist_to_parent_m: 115.36, tx_dbm: 5 },
  { id: 19, x: 216.0, y: -250.0, tier: "1B", role: "Scout / tension", parent_id: 28, backup_parent_id: 30, cluster_id: 28, hop_count: 2, dist_to_parent_m: 67.20, tx_dbm: 5 },
  { id: 20, x: -245.0, y: -147.3, tier: "1C", role: "Scout / fault", parent_id: 27, backup_parent_id: 30, cluster_id: 27, hop_count: 2, dist_to_parent_m: 67.50, tx_dbm: 5 },
  { id: 21, x: -150.0, y: -96.8, tier: "1C", role: "Scout / fault", parent_id: 27, backup_parent_id: 30, cluster_id: 27, hop_count: 2, dist_to_parent_m: 164.97, tx_dbm: 10 },
  { id: 22, x: -50.0, y: -43.6, tier: "1C", role: "Scout / fault", parent_id: 30, backup_parent_id: 29, cluster_id: 30, hop_count: 2, dist_to_parent_m: 145.28, tx_dbm: 5 },
  { id: 23, x: 50.0, y: 9.6, tier: "1C", role: "Scout / fault", parent_id: 29, backup_parent_id: 30, cluster_id: 29, hop_count: 2, dist_to_parent_m: 177.58, tx_dbm: 10 },
  { id: 24, x: 150.0, y: 62.8, tier: "1C", role: "Scout / fault", parent_id: 29, backup_parent_id: 26, cluster_id: 29, hop_count: 2, dist_to_parent_m: 190.36, tx_dbm: 10 },
  { id: 25, x: 245.0, y: 113.3, tier: "1C", role: "Scout / fault", parent_id: 26, backup_parent_id: 29, cluster_id: 26, hop_count: 2, dist_to_parent_m: 293.55, tx_dbm: 10 },
  { id: 26, x: 0.0, y: 275.0, tier: "2A", role: "Anchor / router", parent_id: 31, backup_parent_id: 29, cluster_id: 26, hop_count: 1, dist_to_parent_m: 1286.61, tx_dbm: 14 },
  { id: 27, x: -270.0, y: -210.0, tier: "2A", role: "Anchor / router", parent_id: 31, backup_parent_id: 30, cluster_id: 27, hop_count: 1, dist_to_parent_m: 1205.33, tx_dbm: 14 },
  { id: 28, x: 270.0, y: -210.0, tier: "2A", role: "Anchor / router", parent_id: 31, backup_parent_id: 30, cluster_id: 28, hop_count: 1, dist_to_parent_m: 748.75, tx_dbm: 14 },
  { id: 29, x: 0.0, y: 180.0, tier: "2B", role: "Anchor / borehole", parent_id: 31, backup_parent_id: 26, cluster_id: 29, hop_count: 1, dist_to_parent_m: 1215.31, tx_dbm: 14 },
  { id: 30, x: 0.0, y: -180.0, tier: "2B", role: "Anchor / borehole", parent_id: 31, backup_parent_id: 27, cluster_id: 30, hop_count: 1, dist_to_parent_m: 982.24, tx_dbm: 14 },
  { id: 31, x: 826.1052631578948, y: -711.3684210526317, tier: "3", role: "Gateway", parent_id: null, backup_parent_id: null, cluster_id: null, hop_count: 0, dist_to_parent_m: null, tx_dbm: null },
];

/**
 * How each tier is drawn. Tier is communicated by SHAPE and SIZE, never by
 * colour — colour is reserved for the state palette (STATE_COLORS), and
 * overloading it with a second meaning would make a CRITICAL scout and a
 * healthy anchor compete for the same visual channel.
 *
 * Scouts are small and numerous; anchors are taller with a router head and
 * sit at 100-150 m spacing; the gateway is the tallest, a fixed mast on
 * bedrock outside the angle of draw.
 */
interface TierStyle {
  /** Height of the instrument mast, metres. */
  mastH: number;
  /** Radius of the base pad, metres. */
  padR: number;
  /** Head geometry drawn on top of the mast. */
  head: "solar" | "router" | "borehole" | "dish";
  /** Vertical offset of the status beacon, metres. */
  beaconY: number;
}

/**
 * Which tiers carry which measurement, mirroring `sensors.TIER_CHANNELS` on
 * the server. Only 1B carries a strain gauge; 2B reads tilt down a borehole
 * string rather than at the surface, and the gateway reads GPS only.
 *
 * These decide whether a missing value means "not reported yet" or "this
 * node has no such sensor" — see the read rule in `liveNodes`.
 */
const TIER_CARRIES_STRAIN: Record<NodeTier, boolean> = {
  "1A": false, "1B": true, "1C": false, "2A": false, "2B": false, "3": false,
};

const TIER_CARRIES_TILT: Record<NodeTier, boolean> = {
  "1A": true, "1B": true, "1C": true, "2A": true, "2B": false, "3": false,
};

const TIER_STYLE: Record<NodeTier, TierStyle> = {
  "1A": { mastH: 6.0, padR: 3.2, head: "solar", beaconY: 7.8 },
  "1B": { mastH: 6.0, padR: 3.2, head: "solar", beaconY: 7.8 },
  "1C": { mastH: 6.0, padR: 3.2, head: "solar", beaconY: 7.8 },
  "2A": { mastH: 11.0, padR: 4.6, head: "router", beaconY: 13.2 },
  "2B": { mastH: 8.0, padR: 5.2, head: "borehole", beaconY: 10.0 },
  "3": { mastH: 16.0, padR: 6.0, head: "dish", beaconY: 18.6 },
};

export const NodeMarkers: React.FC<NodeMarkersProps> = ({
  nodes,
  nodeTelemetry,
  latestPacket,
  perturbations = [],
  exaggeration = 1.0,
  selectedNodeId,
  onSelectNode,
  showMeshTopology = true,
}) => {
  const activeNodes = nodes && nodes.length > 0 ? nodes : FALLBACK_NODES;

  const nowSec = performance.now() / 1000.0;
  const UP_VECTOR = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  // Server telemetry indexed by node id, so each monument can be matched to
  // its own instrument reading in O(1) rather than scanning the array.
  const telemetryById = useMemo(() => {
    const m = new Map<number, NodeTelemetry>();
    for (const t of nodeTelemetry ?? []) m.set(t.id, t);
    return m;
  }, [nodeTelemetry]);

  // Map 60-second packet aggregated readings if available (§Phase 9)
  const packetAggregatesById = useMemo(() => {
    if (!latestPacket?.nodes) return new Map<number, any>();
    return new Map(latestPacket.nodes.map((n) => [n.node_id, n.aggregates]));
  }, [latestPacket]);

  // Compute live positions and 3D elevations of all nodes
  const liveNodes = useMemo(() => {
    return activeNodes.map((n) => {
      // Sample the SAME surface the viewport draws. This used to call
      // `evaluateNaturalElevation()` (procedural, 8-65 m) while the mesh
      // rendered the real DEM (0-174 m datum-relative), so monuments standing
      // on 174 m ridge ground were drawn at 40 m and vanished inside the hill.
      const z0 = sampleBaseGroundY(n.x, n.y);
      const state = globalGeomechanics.evaluatePoint(n.x, n.y, z0, nowSec);
      const liveZ = z0 - state.dropDistanceM * exaggeration + state.vibrationDisplacementM;

      // What this node's instruments actually report.
      const tel = telemetryById.get(n.id);
      const pAgg = packetAggregatesById.get(n.id);

      const isReporting = (tel !== undefined && tel.alive === 1) || (pAgg !== undefined && pAgg.last_alive === 1);

      const measuredStrainMmPerM =
        pAgg?.max_strain !== null && pAgg?.max_strain !== undefined && Number.isFinite(pAgg.max_strain)
          ? pAgg.max_strain / 1000.0
          : isReporting && tel?.strain !== null && tel?.strain !== undefined && Number.isFinite(tel.strain)
            ? tel.strain / 1000.0
            : null;

      const measuredTiltMmPerM =
        pAgg?.max_tilt_magnitude !== null && pAgg?.max_tilt_magnitude !== undefined && Number.isFinite(pAgg.max_tilt_magnitude)
          ? pAgg.max_tilt_magnitude / 1000.0
          : isReporting &&
            tel?.tilt_x !== null &&
            tel?.tilt_x !== undefined &&
            tel?.tilt_y !== null &&
            tel?.tilt_y !== undefined &&
            Number.isFinite(tel.tilt_x) &&
            Number.isFinite(tel.tilt_y)
            ? Math.hypot(tel.tilt_x, tel.tilt_y) / 1000.0
            : null;

      // Does this node's hardware include the channel at all? Decided by
      // tier, so it stays true regardless of whether a packet has arrived.
      const carriesStrain = TIER_CARRIES_STRAIN[n.tier];
      const carriesTilt = TIER_CARRIES_TILT[n.tier];

      return {
        ...n,
        z0,
        liveZ,
        state,
        tel,
        isReporting,
        serverState: (tel?.node_state || (pAgg as any)?.node_state) as string | undefined,
        carriesStrain,
        carriesTilt,
        // null means "this node cannot tell you"; only a node that CARRIES
        // the sensor falls back to the local estimate.
        strainMmPerM: carriesStrain
          ? measuredStrainMmPerM ?? state.tensileStrainMmPerM
          : null,
        tiltMmPerM: carriesTilt
          ? measuredTiltMmPerM ?? state.tiltMmPerM
          : null,
      };
    });
  }, [activeNodes, exaggeration, nowSec, telemetryById]);

  // Selected node
  const selectedNode = liveNodes.find((n) => n.id === selectedNodeId);

  // The mesh links drawn for the selected node.
  //
  // These are the node's COMMISSIONED parent and backup parent, read from
  // the DAG the server planned (MESH_UPGRADE_BRIEF.md section 4) — not a
  // proximity join. This previously drew a line to every node within 160 m,
  // which is wrong in both directions: it invented links between scouts that
  // never talk to each other, and it hid the anchor->gateway backbone hops,
  // which are ~1 km and so never qualified.
  //
  // Capacitated assignment means a scout's parent is NOT always its nearest
  // anchor — one whose nearest anchor is full falls to its next-nearest — so
  // proximity could not reproduce this even in principle.
  const meshLinks = useMemo(() => {
    if (!selectedNode || !showMeshTopology) return [];
    const byId = new Map(liveNodes.map((n) => [n.id, n]));

    return (
      [
        { id: selectedNode.parent_id, kind: "primary" as const },
        { id: selectedNode.backup_parent_id, kind: "backup" as const },
      ]
        .flatMap(({ id, kind }) => {
          if (id === null) return [];
          const target = byId.get(id);
          if (!target) return [];
          return [
            {
              key: `${selectedNode.id}-${kind}-${id}`,
              kind,
              targetX: target.x,
              targetY: target.y,
              targetZ: target.liveZ,
            },
          ];
        })
    );
  }, [selectedNode, liveNodes, showMeshTopology]);

  return (
    <group>
      {/* Commissioned mesh links: solid to the primary parent, faint to the
          pre-calculated backup the node fails over to. */}
      {selectedNode &&
        meshLinks.map((link) => (
          <line key={link.key}>
            <bufferGeometry
              attach="geometry"
              onUpdate={(self) => {
                const positions = new Float32Array([
                  selectedNode.x, selectedNode.liveZ + 2.0, selectedNode.y,
                  link.targetX, link.targetZ + 2.0, link.targetY,
                ]);
                self.setAttribute("position", new THREE.BufferAttribute(positions, 3));
              }}
            />
            <lineBasicMaterial
              attach="material"
              color="#8fa3ad"
              transparent
              opacity={link.kind === "primary" ? 0.85 : 0.3}
              linewidth={2}
            />
          </line>
        ))}

      {/* Sensor Station Markers */}
      {liveNodes.map((node) => {
        const isSelected = selectedNodeId === node.id;
        const currentElev = node.liveZ;
        const state = node.state;
        const finalDrop = state.dropDistanceM;
        const style = TIER_STYLE[node.tier] ?? TIER_STYLE["1A"];

        // Surface normal alignment
        const normalVec = new THREE.Vector3(
          state.surfaceNormal[0],
          state.surfaceNormal[2],
          state.surfaceNormal[1]
        ).normalize();

        const tiltQuat = new THREE.Quaternion().setFromUnitVectors(UP_VECTOR, normalVec);
        const euler = new THREE.Euler().setFromQuaternion(tiltQuat);

        // State color determination
        // Thresholds are in mm/m against the DGMS limits. The tilt tests used
        // to be in DEGREES (8 / 18), but real subsidence tilt peaks near
        // 0.28 deg, so those branches could never be reached and the node
        // colouring collapsed to drop-only.
        // Judged on the node's OWN measured strain and tilt (see liveNodes),
        // not on a browser estimate of them.
        //
        // Either may be null, meaning this tier carries no such sensor. A
        // null must never satisfy a threshold: an anchor with no strain
        const strainMmPerM = node.strainMmPerM;
        const tiltMmPerM = node.tiltMmPerM;

        // 1.2x Alert Radius check:
        // When a collapse is applied or perturbation is active with radius R,
        // any node within 1.2 * R is evaluated as affected and marked RED.
        // At the beginning (before collapse events), nodes are NOT called red based on data.
        const isInsideCollapseAlert = (() => {
          if (globalGeomechanics && Array.isArray(globalGeomechanics.interventions)) {
            for (const inter of globalGeomechanics.interventions) {
              const alertR = inter.radiusM * 1.2;
              if (Math.hypot(node.x - inter.cx, node.y - inter.cy) <= alertR) {
                return true;
              }
            }
          }
          if (Array.isArray(perturbations)) {
            for (const p of perturbations) {
              const alertR = (p.radius_m || 60) * 1.2;
              if (Math.hypot(node.x - p.cx, node.y - p.cy) <= alertR) {
                return true;
              }
            }
          }
          return false;
        })();

        let stateColor = STATE_COLORS.STABLE;
        if (node.serverState === "CRITICAL" || isInsideCollapseAlert) {
          stateColor = STATE_COLORS.CRITICAL;
        } else if (node.serverState === "WARNING") {
          stateColor = STATE_COLORS.TENSION;
        } else if (finalDrop > 0.05) {
          stateColor = STATE_COLORS.SETTLING;
        }

        // Single source for the badge text, so it can never disagree with the
        // beacon colour the way two parallel threshold chains did.
        const stateLabel = (Object.keys(STATE_COLORS) as SegmentState[]).find(
          (k) => STATE_COLORS[k] === stateColor
        ) ?? "STABLE";

        return (
          <group key={node.id} position={[node.x, currentElev, node.y]}>
            {/* Invisible Large Hitbox for Effortless Clicking. Scaled with
                the mast so a tall gateway is as easy to hit as a scout. */}
            <mesh
              position={[0, style.mastH * 0.75, 0]}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectNode(node.id);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "auto";
              }}
            >
              <cylinderGeometry args={[6.5, 6.5, style.mastH + 10.0, 12]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>

            {/* Sensor Instrument Station. Shape and height carry the TIER;
                colour is reserved for the state palette. */}
            <group rotation={euler}>
              {/* Tripod Anchor Base Pad */}
              <mesh position={[0, 0.5, 0]}>
                <cylinderGeometry args={[style.padR, style.padR * 1.25, 1.0, 8]} />
                <meshStandardMaterial
                  color="#5a5b5e"
                  roughness={0.6}
                  metalness={0.5}
                />
              </mesh>

              {/* Vertical Instrument Mast */}
              <mesh position={[0, style.mastH / 2 + 0.5, 0]}>
                <cylinderGeometry args={[0.6, 0.7, style.mastH, 8]} />
                <meshStandardMaterial
                  color="#a3a4a6"
                  roughness={0.4}
                  metalness={0.7}
                />
              </mesh>

              {/* Head. Scouts carry a solar panel; anchors a router drum;
                  boreholes a wellhead collar; the gateway a backhaul dish. */}
              {style.head === "solar" && (
                <mesh position={[0, style.mastH + 0.8, 0]}>
                  <cylinderGeometry args={[2.4, 2.2, 0.8, 12]} />
                  <meshStandardMaterial color="#313235" roughness={0.4} metalness={0.8} />
                </mesh>
              )}
              {style.head === "router" && (
                <>
                  <mesh position={[0, style.mastH + 0.9, 0]}>
                    <cylinderGeometry args={[2.0, 2.0, 1.8, 12]} />
                    <meshStandardMaterial color="#313235" roughness={0.4} metalness={0.8} />
                  </mesh>
                  {/* Whip antenna — an anchor is a router first. */}
                  <mesh position={[0, style.mastH + 3.4, 0]}>
                    <cylinderGeometry args={[0.16, 0.16, 3.2, 6]} />
                    <meshStandardMaterial color="#a3a4a6" roughness={0.3} metalness={0.9} />
                  </mesh>
                </>
              )}
              {style.head === "borehole" && (
                <>
                  {/* Wellhead collar at ground level: this tier's instrument
                      hangs DOWN the hole, not up the mast. */}
                  <mesh position={[0, 0.9, 0]}>
                    <cylinderGeometry args={[2.6, 2.6, 1.4, 12]} />
                    <meshStandardMaterial color="#4a4b4e" roughness={0.7} metalness={0.4} />
                  </mesh>
                  <mesh position={[0, style.mastH + 0.6, 0]}>
                    <boxGeometry args={[3.4, 1.2, 2.2]} />
                    <meshStandardMaterial color="#313235" roughness={0.4} metalness={0.8} />
                  </mesh>
                </>
              )}
              {style.head === "dish" && (
                <mesh position={[0, style.mastH + 1.4, 0]} rotation={[Math.PI / 3, 0, 0]}>
                  <sphereGeometry args={[3.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
                  <meshStandardMaterial
                    color="#c9cacc"
                    roughness={0.3}
                    metalness={0.7}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              )}

              {/* Active Beacon LED Head Sphere */}
              <mesh position={[0, style.beaconY, 0]}>
                <sphereGeometry args={[1.6, 16, 16]} />
                <meshStandardMaterial
                  color={stateColor}
                  emissive={stateColor}
                  emissiveIntensity={isSelected ? 3.0 : 0.9}
                  roughness={0.2}
                  metalness={0.5}
                />
              </mesh>

              {/* Active Selection Glow Ring & Vertical Pulse Beam */}
              {isSelected && (
                <>
                  <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[style.padR + 2.3, style.padR + 4.3, 32]} />
                    <meshBasicMaterial color="#8fa3ad" side={THREE.DoubleSide} transparent opacity={0.9} />
                  </mesh>
                  <mesh position={[0, style.mastH + 10.0, 0]}>
                    <cylinderGeometry args={[0.1, 0.8, 20.0, 8]} />
                    <meshBasicMaterial color="#8fa3ad" transparent opacity={0.35} />
                  </mesh>
                </>
              )}
            </group>

            {/* Rich 3D Floating Tag for Selected Node */}
            {isSelected && (
              <Html
                position={[0, 12.5, 0]}
                center
                distanceFactor={220}
                style={{ pointerEvents: "none" }}
              >
                <div
                  style={{
                    background: "rgba(6, 10, 20, 0.95)",
                    border: `1.5px solid ${stateColor}`,
                    borderRadius: "8px",
                    padding: "6px 10px",
                    color: "white",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "var(--fs-body)",
                    lineHeight: "1.3",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.8)",
                    whiteSpace: "nowrap",
                    display: "flex",
                    flexDirection: "column",
                    gap: "3px",
                    minWidth: "150px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{ fontWeight: 800, color: "#f7f7f7", fontSize: "12px" }}>
                      NODE #{String(node.id).padStart(2, "0")}{" "}
                      <span style={{ color: "#7fa0b5", fontSize: "var(--fs-label)" }}>
                        [{node.tier}] {node.role}
                      </span>
                    </span>
                    <span
                      style={{
                        background: `${stateColor}22`,
                        color: stateColor,
                        border: `1px solid ${stateColor}88`,
                        padding: "1px 5px",
                        borderRadius: "4px",
                        fontSize: "var(--fs-label)",
                        fontWeight: 800,
                      }}
                    >
                      {stateLabel}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "6px", color: "#a3a4a6", fontSize: "var(--fs-label)", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "3px" }}>
                    <span>X: {node.x >= 0 ? "+" : ""}{node.x.toFixed(0)}m</span>
                    <span>Y: {node.y >= 0 ? "+" : ""}{node.y.toFixed(0)}m</span>
                    <span>Z: +{currentElev.toFixed(1)}m</span>
                  </div>

                  {/* The same node's position in the geographic frame the
                      dashboard map draws in, projected through utils/geo (the
                      mirror of sandbox.geo). Shown next to the metres so the
                      two screens can be checked against each other directly:
                      this string should match the dashboard marker's popup. */}
                  <div style={{ color: "#7c7d80", fontSize: "var(--fs-label)", letterSpacing: "0.02em" }}>
                    {formatLatLon(...xyToLatLon(node.x, node.y))}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--fs-body)", fontWeight: 700 }}>
                    <span style={{ color: "#7c7d80" }}>SUBSIDENCE ΔZ:</span>
                    <span style={{ color: finalDrop > 0.01 ? "#c2603f" : "#7d9b7a" }}>
                      -{(finalDrop * 1000).toFixed(0)} mm
                    </span>
                  </div>

                  {/* A channel this tier does not carry reads "—", never a
                      number. Showing 0.00 mm/m for an anchor with no strain
                      gauge would be a fabricated reading, not a tidy default. */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--fs-label)" }}>
                    <span style={{ color: "#7c7d80" }}>STRAIN ε:</span>
                    {strainMmPerM === null ? (
                      <span style={{ color: "#5f6063" }}>— no gauge</span>
                    ) : (
                      <span style={{ color: Math.abs(strainMmPerM) > DGMS_TENSILE * 0.47 ? "#d9a25f" : "#7fa0b5" }}>
                        {strainMmPerM >= 0 ? "+" : ""}{strainMmPerM.toFixed(2)} mm/m
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--fs-label)" }}>
                    <span style={{ color: "#7c7d80" }}>TILT:</span>
                    {tiltMmPerM === null ? (
                      <span style={{ color: "#5f6063" }}>— no tiltmeter</span>
                    ) : (
                      <span style={{ color: tiltMmPerM > 4.0 ? "#d9a25f" : "#7fa0b5" }}>
                        {tiltMmPerM.toFixed(2)} mm/m
                      </span>
                    )}
                  </div>

                  {/* Mesh position: which cluster this node reports into, and
                      over how far a hop. Read from the commissioned DAG. */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--fs-label)" }}>
                    <span style={{ color: "#7c7d80" }}>UPLINK:</span>
                    <span style={{ color: "#8fa3ad" }}>
                      {node.parent_id === null
                        ? "SINK · no parent"
                        : `→ N-${String(node.parent_id).padStart(2, "0")}${
                            node.dist_to_parent_m !== null
                              ? ` · ${node.dist_to_parent_m.toFixed(0)}m`
                              : ""
                          }`}
                    </span>
                  </div>

                  {/* Provenance. Without this the operator cannot tell a real
                      instrument reading from the pre-tick local estimate, and
                      the two can legitimately differ. */}
                  <div style={{ fontSize: "var(--fs-label)", color: "#7c7d80", letterSpacing: "0.04em" }}>
                    {node.isReporting
                      ? `SENSOR #${node.id}${node.tel?.seq !== undefined ? ` · seq ${node.tel.seq}` : ""}`
                      : "NO TELEMETRY · local estimate"}
                  </div>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
};
