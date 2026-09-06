import React, { useState, useEffect } from "react";
import { Camera, Crosshair, Flame, Waves, X } from "lucide-react";
import type { NeighborDistance, NodeDef, NodeTelemetry, PhysicalEventType, SegmentState, TargetLocation } from "../types";
import { STATE_COLORS } from "../types";
import { evaluateNaturalElevation } from "../utils/proceduralTerrain";
import { globalGeomechanics, S_MAX_FULL_M } from "../utils/geomechanicsEngine";
import { SPEED_MULTIPLIERS, type SpeedMultiplier } from "../interventions";
import { InfoModal, InfoBadge, type InfoItem } from "./InfoModal";
import { Field, Segmented } from "./Menu";
import { INTERVENTION_INFO, PACE_INFO } from "../interventions";

interface RightInspectorPanelProps {
  /** False until the operator presses START; disables every trigger. */
  isRunning: boolean;
  selectedNodeId: number | null;
  nodes: NodeDef[];
  nodeTelemetry: NodeTelemetry[];
  exaggeration: number;
  nodeNeighbors: NeighborDistance[];
  onSelectNode: (id: number | null) => void;
  onCenterCamera: (x: number, y: number, z: number) => void;
  onTriggerEventAtNode: (x: number, y: number) => void;

  // Targeting & Interventions when no node is selected
  targetLocation: TargetLocation;
  onSetTargetLocation: (loc: TargetLocation) => void;
  severity: number;
  onChangeSeverity: (val: number) => void;
  radiusM: number;
  onChangeRadius: (val: number) => void;
  onTriggerEvent: (type: PhysicalEventType, cx: number, cy: number, sev: number, rad: number) => void;
  /** How fast a triggered event plays out: 1x = 60 s, 5x = 12 s, 10x = 6 s. */
  eventSpeed: SpeedMultiplier;
  onChangeEventSpeed: (speed: SpeedMultiplier) => void;
  /** True while an event is still moving the ground. Locks every trigger and
   *  the speed switch, so two events cannot superpose onto one surface. */
  eventInFlight: boolean;
  /** Real seconds until the in-flight event finishes; 0 when idle. */
  eventSecondsLeft: number;

  // VIEW — camera and display settings, set once and left alone. Not a
  // reading, so it must render regardless of node selection or run state.
  onChangeExaggeration: (val: number) => void;
  wireframe: boolean;
  onToggleWireframe: () => void;
  showMeshTopology: boolean;
  onToggleMeshTopology: () => void;
  onResetCamera: () => void;
  onSelectCameraPreset: (preset: "overview" | "highland" | "pit" | "cutaway" | "topdown") => void;
}

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  isRunning,
  selectedNodeId,
  nodes,
  nodeTelemetry,
  exaggeration,
  nodeNeighbors,
  onSelectNode,
  onCenterCamera,
  onTriggerEventAtNode,
  targetLocation,
  onSetTargetLocation,
  severity,
  onChangeSeverity,
  radiusM,
  onChangeRadius,
  onTriggerEvent,
  eventSpeed,
  onChangeEventSpeed,
  eventInFlight,
  eventSecondsLeft,
  onChangeExaggeration,
  wireframe,
  onToggleWireframe,
  showMeshTopology,
  onToggleMeshTopology,
  onResetCamera,
  onSelectCameraPreset,
}) => {
  const [activeInfo, setActiveInfo] = useState<InfoItem | null>(null);
  const [remoteDetails, setRemoteDetails] = useState<any>(null);
  // Which variant the cave-in button fires. Defaults to the plain bowl, so
  // the common case needs no interaction with the preset row at all.
  const [collapsePreset, setCollapsePreset] = useState<PhysicalEventType>("collapse");
  // Collapsed by default, same spirit as TerrainLegend's own useState(false):
  // these are set-once controls (camera, wireframe, scale) and must not push
  // the live node readings off screen.
  const [viewOpen, setViewOpen] = useState(false);

  // Fetch this node's full channel set from the backend. Which channels
  // come back is decided by the node's tier, and absent ones are null.
  useEffect(() => {
    if (selectedNodeId === null) {
      setRemoteDetails(null);
      return;
    }

    let isMounted = true;
    const fetchTelemetry = async () => {
      try {
        const host = window.location.hostname || "localhost";
        const res = await fetch(`http://${host}:8000/nodes/${selectedNodeId}`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setRemoteDetails(data.telemetry);
        }
      } catch {
        // Fallback to local
      }
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedNodeId]);

  const selectedNode = selectedNodeId !== null ? nodes.find((n) => n.id === selectedNodeId) : null;
  const localTel = selectedNodeId !== null ? nodeTelemetry.find((t) => t.id === selectedNodeId) : null;

  // Derive coordinates and physics
  const x = selectedNode?.x ?? targetLocation.x;
  const yCoord = selectedNode?.y ?? targetLocation.y;
  const z0 = evaluateNaturalElevation(x, yCoord);
  const nowSec = performance.now() / 1000.0;
  const geo = globalGeomechanics.evaluatePoint(x, yCoord, z0, nowSec);

  const currentElev = z0 - geo.dropDistanceM * exaggeration + geo.vibrationDisplacementM;
  const totalDropMm = geo.dropDistanceM * 1000.0;
  const tiltMmPerM = Math.abs(geo.tiltMmPerM);
  const tiltDeg = geo.tiltDeg;
  // Strain is a per-TIER channel: only 1B carries a gauge. `null` here means
  // "this node has no strain gauge", not "zero strain", so it must not be
  // coerced into a number (MESH_UPGRADE_BRIEF.md's critical read rule).
  //
  // Where the selected node cannot measure strain, the panel falls back to
  // the local engine's MODELLED strain at that coordinate and says so — the
  // ground still has a strain, it is simply not being instrumented here.
  const measuredStrainUe =
    localTel && localTel.strain !== null ? localTel.strain : null;
  const strainIsMeasured = measuredStrainUe !== null;
  const strainUe = measuredStrainUe ?? geo.tensileStrainMmPerM * 1000.0;
  const strainMmPerM = strainUe / 1000.0;

  // Determine State
  let nodeState: SegmentState = "STABLE";
  if (Math.abs(strainMmPerM) > 5.3 || geo.dropDistanceM > 0.4) {
    nodeState = "FAILED";
  } else if (Math.abs(strainMmPerM) > 3.8 || geo.dropDistanceM > 0.15) {
    nodeState = "CRITICAL";
  } else if (Math.abs(strainMmPerM) > 2.0 || geo.dropDistanceM > 0.04) {
    nodeState = "TENSION";
  } else if (geo.dropDistanceM > 0.005) {
    nodeState = "SETTLING";
  }

  const stateColor = STATE_COLORS[nodeState];

  // Hardware channels.
  //
  // Every one of these may legitimately be absent, and absence is displayed
  // as "—" rather than substituted with a plausible-looking constant. The
  // previous defaults (3600 mV, 28.5 °C, -88 dBm, 2 hops) were indefensible
  // under the tier system: most nodes carry most of these, but a reader
  // could not tell a real 3600 mV from a node that had never reported.
  //
  // `??` is correct here and `||` would not be: 0 dBm and 0 hops are real
  // values that `||` would discard.
  const firstNumber = (...vals: (number | null | undefined)[]): number | null => {
    for (const v of vals) if (v !== null && v !== undefined) return v;
    return null;
  };

  const vbat = firstNumber(remoteDetails?.vbat_mv);
  const temp = firstNumber(remoteDetails?.temp_c);
  const rssi = firstNumber(remoteDetails?.rssi_dbm, localTel?.rssi);
  const snr = firstNumber(remoteDetails?.snr_db, localTel?.snr);
  const crack = firstNumber(remoteDetails?.crack_flags);
  const extDeltaMm = firstNumber(remoteDetails?.ext_delta_mm);

  // Hop count is static topology, so it comes from the commissioned DAG in
  // the node table rather than from a per-tick reading.
  const hops = selectedNode?.hop_count ?? null;

  /** Render a channel, or an explicit dash when the node does not report it. */
  const chan = (v: number | null, fmt: (n: number) => string): string =>
    v === null ? "—" : fmt(v);

  const strainRatio = Math.min(1.0, Math.abs(strainMmPerM) / 5.3);

  // "Stress Extraction" used to sit in this list; it called the same code path
  // as the START button while claiming to advance the longwall face, so it was
  // a duplicate wearing a misleading label. Removed.
  // Two PRIMARY actions, because there are only two things that can happen to
  // this ground: it sinks, or it shakes. Five buttons stood here before, but
  // four of them fired one kernel — INTERVENTION_INFO.pillar says so in as
  // many words ("a preset, not separate physics"), and strain/tilt are the
  // same collapse with its geometry solved backwards from a target reading.
  // Presenting four solvers as four phenomena is what made the panel read as
  // five near-identical rows, so the variants moved into COLLAPSE_PRESETS
  // below and the top level now shows the two that genuinely differ.
  //
  // Colours are the two hazard poles and are deliberately far apart in hue,
  // not the three desaturated blue-greys (var(--state-accent)/var(--state-info)/var(--state-info-alt)) that used
  // to sit here — those were distinct in hex and identical to the eye.
  const quickInterventions: { id: PhysicalEventType; label: string; icon: React.ReactNode; color: string }[] = [
    { id: "collapse", label: "Ground Cave-In", icon: <Flame size={13} color="var(--state-critical)" />, color: "var(--state-critical)" },
    { id: "vibration", label: "Blast Shockwave (0mm)", icon: <Waves size={13} color="var(--state-info)" />, color: "var(--state-info)" },
  ];

  // Variants of the cave-in kernel, selected before firing it. Both are the
  // same bowl asked for in a different way, which is why they belong under the
  // cave-in button rather than beside it:
  //   standard — the bowl as targeted, ΔZ and R straight off the sliders
  //   tilt     — fires the bowl one radius off-target so the marker sits on
  //              the flank, where dS/dx peaks; a bowl's floor has zero tilt
  //
  // PILLAR and STRAIN used to sit between these two and are gone, because
  // neither was distinguishable from STANDARD on screen — which is the only
  // thing a preset row can be for. PILLAR was literally STANDARD with
  // ΔZ x 1.15 and R x 1.10, a 15% change the severity slider already spans,
  // so it rendered as the same bowl. STRAIN solved for a deliberately
  // shallow, tight bowl whose own documentation called it "often barely
  // visible as a dip" — its entire payoff was a number in the telemetry, not
  // a visible geometry, so as a *cave-in type* it also read as no change.
  // STANDARD and TILT are kept because they differ where it shows: TILT
  // moves the bowl off the marker by its own radius.
  const collapsePresets: { id: PhysicalEventType; label: string; hint: string }[] = [
    { id: "collapse", label: "STANDARD", hint: "Bowl as targeted, straight off the sliders." },
    { id: "tilt", label: "TILT", hint: "Offset by one radius so the target lands on the steep flank." },
  ];

  // Camera presets, previously the View menu's "Camera" group.
  const cameraPresets: { id: "overview" | "highland" | "pit" | "cutaway" | "topdown"; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "topdown", label: "Top-down" },
    { id: "highland", label: "Highland" },
    { id: "pit", label: "Pit" },
    { id: "cutaway", label: "Cutaway" },
  ];

  return (
    <aside
      style={{
        width: "340px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        // Opaque, not a blurred glass sheet. The panel sits over a moving 3D
        // scene, so with backdrop-blur a reading's contrast depended on the
        // terrain behind it — the same number was legible over the dark sky
        // and washed out over a sunlit ridge.
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border-color)",
        fontFamily: "var(--font-mono, monospace)",
        color: "var(--text-primary)",
        userSelect: "none",
        overflowY: "auto",
        zIndex: 40,
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          padding: "10px 12px",
          background: "var(--bg-raised)",
          borderBottom: "1px solid var(--border-color)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: selectedNodeId !== null ? stateColor : "var(--state-info-alt)",
            }}
          />
          <div>
            <div style={{ fontSize: "var(--fs-body)", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.06em" }}>
              {selectedNodeId !== null ? `MONUMENT INSPECTOR` : `TARGETING & SECTOR CONTROLS`}
            </div>
            <div style={{ fontSize: "var(--fs-label)", color: "var(--text-muted)" }}>
              {selectedNodeId !== null ? `NODE #${String(selectedNodeId).padStart(2, "0")} [N-${String(selectedNodeId).padStart(2, "0")}]` : `ADRIYALA LONGWALL WORKINGS`}
            </div>
          </div>
        </div>

        {selectedNodeId !== null ? (
          <button
            onClick={() => onSelectNode(null)}
            title="Deselect Node"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-secondary)",
              cursor: "pointer",
              padding: "2px 6px",
              fontSize: "var(--fs-label)",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>DESELECT</span>
            <X size={12} />
          </button>
        ) : (
          <span
            style={{
              fontSize: "var(--fs-label)",
              padding: "2px 6px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(56, 189, 248, 0.15)",
              color: "var(--state-info-alt)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              fontWeight: 800,
            }}
          >
            {targetLocation.zoneName || "SURFACE"}
          </span>
        )}
      </div>

      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
        {/* ================= IF A NODE IS SELECTED: FULL TELEMETRY ================= */}
        {selectedNodeId !== null ? (
          <>
            <Field label="Risk Classification" value={nodeState} color={stateColor} />
            <Field
              label="Link"
              value={localTel?.alive ? "ONLINE" : "OFFLINE"}
              color={localTel?.alive ? "var(--state-active)" : "var(--state-critical)"}
            />
            <Field
              label="Total Drop ΔZ"
              value={`-${totalDropMm.toFixed(1)} mm`}
              color={totalDropMm > 10 ? "var(--state-critical)" : "var(--text-primary)"}
            />

            <div className="panel-section-title">Position</div>
            <div className="field-grid">
              <Field label="Easting X" value={`${x >= 0 ? "+" : ""}${x.toFixed(1)} m`} />
              <Field label="Northing Y" value={`${yCoord >= 0 ? "+" : ""}${yCoord.toFixed(1)} m`} />
              <Field label="Datum Z₀" value={`${z0.toFixed(2)} m`} />
              <Field label="Live Z" value={`${currentElev.toFixed(2)} m`} />
            </div>

            <div className="panel-section-title">Geomechanics</div>
            <Field
              label={
                strainIsMeasured
                  ? "Strain (limit 5.3 mm/m)"
                  : "Strain (modelled — no gauge here)"
              }
              value={`${strainMmPerM >= 0 ? "+" : ""}${strainMmPerM.toFixed(2)} mm/m`}
              color={
                !strainIsMeasured
                  ? "var(--text-secondary)"
                  : Math.abs(strainMmPerM) > 5.3
                    ? "var(--state-critical)"
                    : "var(--text-primary)"
              }
            />
            <div className="meter">
              <div
                className="meter-fill"
                style={{
                  width: `${strainRatio * 100}%`,
                  background:
                    strainRatio > 0.9 ? "var(--state-critical)"
                    : strainRatio > 0.6 ? "var(--state-warning)"
                    : "var(--state-active)",
                }}
              />
            </div>
            <div className="field-grid">
              <Field
                label="Tilt"
                value={`${tiltMmPerM.toFixed(2)} mm/m`}
                color={tiltMmPerM > 15 ? "var(--state-critical)" : "var(--text-primary)"}
              />
              <Field label="Slope" value={`${tiltDeg.toFixed(2)}°`} />
            </div>

            {/* Tier and mesh position. What a node IS decides what it can
                report, so it is stated before the channels themselves. */}
            <div className="panel-section-title">Node</div>
            <div className="field-grid">
              <Field label="Tier" value={selectedNode?.tier ?? "—"} />
              <Field label="Role" value={selectedNode?.role ?? "—"} />
              <Field
                label="Cluster"
                value={
                  selectedNode?.cluster_id != null
                    ? `N-${String(selectedNode.cluster_id).padStart(2, "0")}`
                    : "—"
                }
              />
              <Field label="Hops" value={chan(hops, (n) => `${n}`)} />
              <Field
                label="Parent"
                value={
                  selectedNode?.parent_id != null
                    ? `N-${String(selectedNode.parent_id).padStart(2, "0")}`
                    : "sink"
                }
              />
              <Field
                label="Backup"
                value={
                  selectedNode?.backup_parent_id != null
                    ? `N-${String(selectedNode.backup_parent_id).padStart(2, "0")}`
                    : "—"
                }
              />
            </div>

            <div className="panel-section-title">Hardware</div>
            <div className="field-grid">
              <Field label="Battery" value={chan(vbat, (n) => `${n} mV`)} />
              <Field label="Temperature" value={chan(temp, (n) => `${n.toFixed(1)} C`)} />
              <Field label="LoRa RSSI" value={chan(rssi, (n) => `${n} dBm`)} />
              <Field label="SNR" value={chan(snr, (n) => `${n.toFixed(1)} dB`)} />
              <Field label="TX Power" value={chan(selectedNode?.tx_dbm ?? null, (n) => `+${n} dBm`)} />
              <Field
                label="Extensometer"
                value={chan(extDeltaMm, (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)} mm`)}
                color={
                  extDeltaMm !== null && Math.abs(extDeltaMm) > 0.05
                    ? "var(--state-warning)"
                    : "var(--text-primary)"
                }
              />
            </div>
            <Field
              label="Crack Sensor"
              value={crack === null ? "—" : crack > 0 ? "ALERT" : "OK"}
              color={
                crack === null
                  ? "var(--text-secondary)"
                  : crack > 0
                    ? "var(--state-critical)"
                    : "var(--state-active)"
              }
            />

            <div className="panel-section-title">
              Baseline strain, nearest 3
            </div>
            {nodeNeighbors.length === 0 ? (
              <div className="menu-hint">No adjacent baseline neighbours within 340 m.</div>
            ) : (
              nodeNeighbors.slice(0, 3).map((nb) => (
                <div key={nb.id} className="nb-row">
                  <span style={{ color: "var(--state-info)" }}>N-{String(nb.id).padStart(2, "0")}</span>
                  <span style={{ color: "var(--text-secondary)" }}>{nb.distM.toFixed(1)} m</span>
                  <span
                    style={{
                      color: Math.abs(nb.deltaMm) > 5.0 ? "var(--state-critical)" : "var(--text-primary)",
                    }}
                  >
                    {nb.deltaMm >= 0 ? "+" : ""}{nb.deltaMm.toFixed(1)} mm
                  </span>
                </div>
              ))
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
              <button
                className="hud-btn"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => onCenterCamera(x, currentElev, yCoord)}
              >
                <Camera size={12} /> CENTRE
              </button>
              <button
                className="hud-btn hud-btn-danger"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={!isRunning || eventInFlight}
                onClick={() => onTriggerEventAtNode(x, yCoord)}
              >
                <Flame size={12} /> CAVE-IN
              </button>
            </div>
          </>
        ) : (
          /* ================= IF NO NODE SELECTED: TARGETING & SECTOR CONTROLS ================= */
          <>
            {/* Guide Banner */}
            <div
              style={{
                background: "rgba(56, 189, 248, 0.08)",
                border: "1px solid rgba(56, 189, 248, 0.2)",
                borderRadius: "var(--radius-sm)",
                padding: "8px 10px",
                fontSize: "var(--fs-label)",
                color: "var(--text-secondary)",
                lineHeight: "1.4",
              }}
            >
              💡 <strong>Node Telemetry Hint:</strong> Click any sensor monument on the 3D terrain canvas to inspect its tier, mesh uplink, and whichever channels its hardware actually carries.
            </div>

            {/* Aim Coordinates */}
            <div
              style={{
                background: "transparent",
                border: "none",
                borderTop: "1px solid var(--border-color)",
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <Crosshair size={12} color="var(--state-info-alt)" />
                  <span style={{ fontSize: "var(--fs-label)", fontWeight: 800, color: "var(--text-secondary)" }}>
                    AIM COORDINATES (CLICK TERRAIN)
                  </span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px" }}>
                <div>
                  <label style={{ fontSize: "var(--fs-label)", color: "var(--text-muted)" }}>X (m):</label>
                  <input
                    type="number"
                    value={Math.round(targetLocation.x)}
                    onChange={(e) =>
                      onSetTargetLocation({
                        ...targetLocation,
                        x: parseFloat(e.target.value) || 0,
                      })
                    }
                    style={{
                      width: "100%",
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--state-info-alt)",
                      padding: "4px 6px",
                      fontSize: "var(--fs-label)",
                      fontWeight: 800,
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "var(--fs-label)", color: "var(--text-muted)" }}>Y (m):</label>
                  <input
                    type="number"
                    value={Math.round(targetLocation.y)}
                    onChange={(e) =>
                      onSetTargetLocation({
                        ...targetLocation,
                        y: parseFloat(e.target.value) || 0,
                      })
                    }
                    style={{
                      width: "100%",
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--state-info-alt)",
                      padding: "4px 6px",
                      fontSize: "var(--fs-label)",
                      fontWeight: 800,
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "var(--fs-label)", color: "var(--text-muted)" }}>ELEVATION Z:</label>
                  <div
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text-primary)",
                      padding: "4px 6px",
                      fontSize: "var(--fs-label)",
                      fontWeight: 800,
                    }}
                  >
                    +{(targetLocation.elev ?? 42).toFixed(1)}m
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Ground Interventions */}
            <div
              style={{
                background: "transparent",
                border: "none",
                borderTop: "1px solid var(--border-color)",
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              }}
            >
              <span style={{ fontSize: "var(--fs-label)", fontWeight: 800, color: "var(--text-secondary)" }}>
                TRIGGER INTERVENTION AT TARGET
              </span>

              {/* Says why the controls below are inert, instead of leaving the
                  operator to press a live-looking button and get nothing. */}
              {!isRunning && (
                <div
                  style={{
                    fontSize: "var(--fs-label)",
                    fontWeight: 800,
                    color: "var(--state-warning)",
                    background: "rgba(217, 162, 95, 0.12)",
                    border: "1px solid rgba(217, 162, 95, 0.4)",
                    borderRadius: "var(--radius-sm)",
                    padding: "4px 6px",
                    lineHeight: 1.4,
                  }}
                >
                  SIMULATION STOPPED — press START to arm. Targeting and node
                  readings are disabled until the clock is running.
                </div>
              )}

              {/* Event speed. Locked mid-event: the server has already been
                  given a duration for the event in flight, so rescaling it
                  now would desync the mesh preview from the telemetry. */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)" }}>
                  SPEED:
                </span>
                <div style={{ display: "flex", gap: "3px", flex: 1 }}>
                  {SPEED_MULTIPLIERS.map((mult) => {
                    const active = eventSpeed === mult;
                    return (
                      <button
                        key={mult}
                        disabled={eventInFlight}
                        onClick={() => onChangeEventSpeed(mult)}
                        title={`Event plays out over ${(60 / mult).toFixed(0)} s`}
                        style={{
                          flex: 1,
                          padding: "3px 0",
                          fontSize: "var(--fs-label)",
                          fontWeight: 800,
                          fontFamily: "var(--font-mono, monospace)",
                          borderRadius: "var(--radius-sm)",
                          border: `1px solid ${active ? "var(--state-critical)" : "var(--border-color)"}`,
                          background: active ? "rgba(214, 90, 90, 0.16)" : "transparent",
                          color: active ? "var(--state-critical)" : "var(--text-secondary)",
                          opacity: eventInFlight ? 0.4 : 1,
                          cursor: eventInFlight ? "not-allowed" : "pointer",
                        }}
                      >
                        {mult}x
                      </button>
                    );
                  })}
                </div>
                <span style={{ fontSize: "var(--fs-label)", color: "var(--text-muted)" }}>
                  {(60 / eventSpeed).toFixed(0)}s
                </span>
              </div>

              {/* Says why the triggers are inert right now, rather than
                  leaving a live-looking button that does nothing. */}
              {eventInFlight && (
                <div
                  style={{
                    fontSize: "var(--fs-label)",
                    fontWeight: 800,
                    color: "var(--state-critical)",
                    background: "rgba(214, 90, 90, 0.12)",
                    border: "1px solid rgba(214, 90, 90, 0.4)",
                    borderRadius: "var(--radius-sm)",
                    padding: "4px 6px",
                    lineHeight: 1.4,
                  }}
                >
                  EVENT IN PROGRESS — {eventSecondsLeft.toFixed(1)}s remaining.
                  Triggers are locked until the ground settles.
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                {quickInterventions.map((ev) => (
                  <button
                    key={ev.id}
                    disabled={!isRunning || eventInFlight}
                    onClick={() =>
                      onTriggerEvent(
                        // The cave-in button fires whichever variant is armed
                        // in the preset row; every other primary fires itself.
                        ev.id === "collapse" ? collapsePreset : ev.id,
                        targetLocation.x,
                        targetLocation.y,
                        severity,
                        radiusM,
                      )
                    }
                    className="action-card-btn"
                    style={{
                      padding: "5px 8px",
                      opacity: isRunning && !eventInFlight ? 1 : 0.4,
                      cursor: isRunning && !eventInFlight ? "pointer" : "not-allowed",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "var(--radius-sm)",
                          background: `${ev.color}15`,
                          border: `1px solid ${ev.color}44`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {ev.icon}
                      </div>
                      <span style={{ fontSize: "var(--fs-body)", fontWeight: 700, color: "var(--text-primary)" }}>{ev.label}</span>
                    </div>
                    {/* Explains the control instead of firing it (the badge
                        stops propagation). These buttons had no explanation at
                        all before — the ribbon had them, this panel did not. */}
                    <InfoBadge
                      item={INTERVENTION_INFO[ev.id === "collapse" ? collapsePreset : ev.id]}
                      onOpen={setActiveInfo}
                      className="inspector-info-icon"
                    />
                  </button>
                ))}
              </div>

              {/* Cave-in variant, as a segmented control — the same affordance
                  the whole UI uses for "pick one". Pace is no longer a choice
                  here: every intervention now runs at the fixed 60 s pace
                  (see interventions.ts), so the badge just explains it. */}
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div className="panel-subsection-title">Cave-in type</div>
                  <InfoBadge item={PACE_INFO} onOpen={setActiveInfo} className="inspector-info-icon" />
                </div>
                <Segmented
                  value={collapsePreset}
                  onChange={setCollapsePreset}
                  options={collapsePresets.map((p) => ({
                    value: p.id, label: p.label, title: p.hint,
                  }))}
                />
              </div>

              {/* Sliders */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-label)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>SEVERITY (ΔZ):</span>
                    <strong style={{ color: "var(--state-critical)" }}>
                      {severity.toFixed(2)} m ({((severity / S_MAX_FULL_M) * 100).toFixed(0)}%)
                    </strong>
                  </div>
                  {/* Bounded by S_MAX_FULL_M, the deepest a SINGLE caving
                      event can sink the surface. Repeated events in the same
                      place keep deepening the hole up to the cumulative
                      CUMULATIVE_DEPTH_MAX_M ceiling, which the depth ramp is
                      keyed to. */}
                  <input
                    type="range"
                    min="0.05"
                    max={S_MAX_FULL_M}
                    step="0.05"
                    value={severity}
                    onChange={(e) => onChangeSeverity(parseFloat(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--state-critical)", cursor: "pointer" }}
                  />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-label)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>RADIUS (R):</span>
                    <strong style={{ color: "var(--state-info-alt)" }}>{radiusM.toFixed(0)} m</strong>
                  </div>
                  {/* Kept in step with the ribbon's copy of this slider
                      (OfficeRibbon.tsx): minimum 15 m, not 40 m, so the sharp
                      narrow-crater half of the range is reachable. */}
                  <input
                    type="range"
                    min="15"
                    max="250"
                    step="5"
                    value={radiusM}
                    onChange={(e) => onChangeRadius(parseFloat(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--state-info-alt)", cursor: "pointer" }}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* ================= VIEW: camera & display settings ================= */}
        {/* Always rendered, independent of node selection and run state —
            these are not readings, they configure how the scene is drawn. */}
        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 10, marginTop: 4 }}>
          <div
            className="panel-section-title"
            style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
            onClick={() => setViewOpen((o) => !o)}
          >
            <span>VIEW</span>
            <span style={{ color: "var(--text-muted)" }}>{viewOpen ? "▾" : "▸"}</span>
          </div>

          {viewOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: 8 }}>
              <div>
                <div className="panel-subsection-title">Camera</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {cameraPresets.map((p) => (
                    <button
                      key={p.id}
                      className="hud-btn"
                      style={{ flex: "1 0 auto", justifyContent: "center" }}
                      onClick={() => (p.id === "overview" ? onResetCamera() : onSelectCameraPreset(p.id))}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="panel-subsection-title">Overlays</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div className="menu-slider-row">
                    <span>Wireframe</span>
                    <button
                      className="hud-btn"
                      style={{ padding: "2px 8px" }}
                      onClick={onToggleWireframe}
                    >
                      {wireframe ? "on" : "off"}
                    </button>
                  </div>
                  <div className="menu-slider-row">
                    <span>Mesh topology</span>
                    <button
                      className="hud-btn"
                      style={{ padding: "2px 8px" }}
                      onClick={onToggleMeshTopology}
                    >
                      {showMeshTopology ? "on" : "off"}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="menu-slider-row">
                  <span>Exaggeration</span>
                  <strong>{exaggeration.toFixed(0)}×</strong>
                </div>
                <input
                  type="range" min="1" max="40" step="1" value={exaggeration}
                  onChange={(e) => onChangeExaggeration(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--state-info)" }}
                />
                <div className="menu-hint">
                  1× is true scale. Rendering only — it never reaches a reported number.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <InfoModal item={activeInfo} onClose={() => setActiveInfo(null)} />
    </aside>
  );
};
