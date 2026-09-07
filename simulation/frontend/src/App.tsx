import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { GroundPhysicsModal, type InfoKey } from "./components/GroundPhysicsModal";
import { LiveMathModal } from "./components/LiveMathModal";
import { MineViewport, type MineViewportHandle } from "./components/MineViewport";
import { FALLBACK_NODES } from "./components/NodeMarkers";
import { MenuBar } from "./components/MenuBar";
import { RightInspectorPanel } from "./components/RightInspectorPanel";
import { TelemetryDrawer } from "./components/TelemetryDrawer";
import { globalGeomechanics, LiveGeomechanicsEngine } from "./utils/geomechanicsEngine";
import {
  DEFAULT_SPEED_MULTIPLIER,
  FIXED_SPEED_MULTIPLIER,
  eventPace,
  paceTimingSummary,
  type SpeedMultiplier,
} from "./interventions";
import { setGeoOrigin } from "./utils/geo";
import { classifyTerrainZone } from "./utils/proceduralTerrain";
import { sampleBaseGroundY, sampleSlopeDegrees } from "./utils/terrainSampler";
import type {
  InitPayload,
  NeighborDistance,
  PhysicalEventType,
  LiveMathEvaluation,
  LogEntry,
  NodeDef,
  NodeTelemetry,
  PacketAvailableNotification,
  Perturbation,
  SegmentState,
  SimulationPacket,
  TargetLocation,
  TickPayload,
  ZoneTelemetry,
} from "./types";

export const App: React.FC = () => {
  // Connection state
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  // The operator's run intent, readable from inside the WebSocket callbacks.
  // Those callbacks are created once, when the socket effect first runs, so
  // they close over the `isRunning` of that first render and would otherwise
  // always see `false`. Adding `isRunning` to the effect's dependency array
  // would fix the staleness but tear down and rebuild the socket on every
  // start and pause, which is worse. A ref is read at call time instead.
  const isRunningRef = useRef<boolean>(false);
  const viewportRef = useRef<MineViewportHandle | null>(null);

  // Mesh & Static Environment Data
  const [z0Mesh, setZ0Mesh] = useState<number[][]>([]);
  const [baseBowlMesh, setBaseBowlMesh] = useState<number[][]>([]);
  const [nodes, setNodes] = useState<NodeDef[]>([]);

  // Real DEM metadata (Adriyala panel), from the init payload — used to
  // recentre the terrain mesh onto the scene origin (see TerrainMesh).
  const [elevMinM, setElevMinM] = useState<number | undefined>(undefined);
  // The simulation window the server is actually running (constants.WINDOW_SIZE_M).
  // Defaulted, not left undefined, so the pre-connect view still draws.
  const [windowSizeM, setWindowSizeM] = useState<number>(600);
  const [elevMaxM, setElevMaxM] = useState<number | undefined>(undefined);

  // Live Simulation State
  const [tSimSeconds, setTSimSeconds] = useState<number>(0);
  const [tDays, setTDays] = useState<number>(0);
  const [timeScalar, setTimeScalar] = useState<number>(0);
  // The sim CLOCK is fixed (see FIXED_SPEED_MULTIPLIER); what the operator
  // picks is how fast a triggered EVENT plays out — 1x is 60 real seconds,
  // 5x is 12 s, 10x is 6 s.
  const speedMultiplier = FIXED_SPEED_MULTIPLIER;
  const [eventSpeed, setEventSpeed] = useState<SpeedMultiplier>(
    DEFAULT_SPEED_MULTIPLIER,
  );
  // Wall-clock ms at which the in-flight event finishes, or null when idle.
  // Two overlapping events would each be solving against a surface the other
  // is still moving — the drops superpose into a hole neither one asked for,
  // and the server has already been told a duration for the first. So the
  // intervention controls and the speed switch are locked until this clears.
  const [eventEndsAt, setEventEndsAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const eventInFlight = eventEndsAt !== null && nowMs < eventEndsAt;
  const [perturbations, setPerturbations] = useState<Perturbation[]>([]);
  const [nodeTelemetry, setNodeTelemetry] = useState<NodeTelemetry[]>([]);
  const [zoneTelemetry, setZoneTelemetry] = useState<ZoneTelemetry[]>([]);
  const [tickCount, setTickCount] = useState<number>(0);
  const [vibrationActive, setVibrationActive] = useState<boolean>(false);
  const [vibrationPPV, setVibrationPPV] = useState<number>(0);

  // 60-Second Standardized Simulation Packet State (§Phase 7)
  const [latestPacket, setLatestPacket] = useState<SimulationPacket | null>(null);
  const [packetCount, setPacketCount] = useState<number>(0);

  // Parameters & Target Location
  // Default pillar-failure drop, m. Must lie within S_MAX_FULL_M, the ceiling
  // for a SINGLE event; repeated events deepen the same hole further.
  const [dropMagnitude, setDropMagnitude] = useState<number>(0.75);
  const [targetLocation, setTargetLocation] = useState<TargetLocation>({
    x: 120,
    y: 80,
    label: "N-E Highland Ridge",
    elev: 46.2,
    slopeDeg: 12.4,
    zoneName: "TRANSITION_SLOPE",
  });
  const [collapseRadiusM, setCollapseRadiusM] = useState<number>(75);

  // Modals & Panels
  const [activeExplainerKey, setActiveExplainerKey] = useState<InfoKey | null>(null);
  const [isMathsModalOpen, setIsMathsModalOpen] = useState<boolean>(false);
  const [showConsole, setShowConsole] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSessionClosed, setIsSessionClosed] = useState<boolean>(false);

  // Visual Styling & Viewport Controls
  const [exaggeration, setExaggeration] = useState<number>(15.0);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [showMeshTopology, setShowMeshTopology] = useState<boolean>(false);

  // Structured Log Stream
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Compute 3D inter-node distance telemetry to nearest neighbor nodes
  const nodeNeighbors: NeighborDistance[] = useMemo(() => {
    if (selectedNodeId === null) return [];
    const activeNodes = nodes && nodes.length > 0 ? nodes : FALLBACK_NODES;
    const center = activeNodes.find((n) => n.id === selectedNodeId);
    if (!center) return [];

    const nowSec = performance.now() / 1000.0;
    // TRUE physical elevations — no vertical exaggeration. `exaggeration` is a
    // rendering-only multiplier (15x by default) that makes 0.5 m of
    // subsidence legible on screen; folding it in here and then labelling the
    // result "mm" reported baseline elongation 15x larger than the ground
    // actually moved. Exaggeration must never reach a reported number.
    const z0Center = sampleBaseGroundY(center.x, center.y);
    const dropCenter = globalGeomechanics.evaluatePoint(center.x, center.y, z0Center, nowSec).dropDistanceM;
    const liveCenterZ = z0Center - dropCenter;

    return activeNodes
      .filter((n) => n.id !== selectedNodeId)
      .map((nb) => {
        const z0Nb = sampleBaseGroundY(nb.x, nb.y);
        const dropNb = globalGeomechanics.evaluatePoint(nb.x, nb.y, z0Nb, nowSec).dropDistanceM;
        const liveNbZ = z0Nb - dropNb;

        const d0 = Math.hypot(nb.x - center.x, nb.y - center.y, z0Nb - z0Center);
        const dLive = Math.hypot(nb.x - center.x, nb.y - center.y, liveNbZ - liveCenterZ);
        const deltaMm = (dLive - d0) * 1000.0;

        return {
          id: nb.id,
          distM: dLive,
          deltaMm: Math.round(deltaMm * 10) / 10,
        };
      })
      .sort((a, b) => a.distM - b.distM)
      .slice(0, 5);
  }, [selectedNodeId, nodes, exaggeration, tSimSeconds]);

  // WebSocket Connection Lifecycle
  useEffect(() => {
    let reconnectTimeout: any;

    const connectWs = () => {
      const host = window.location.hostname || "localhost";
      const wsUrl = `ws://${host}:8000/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // Speed is fixed client-side, so tell the server immediately rather
        // than adopting whatever multiplier its session happened to default to.
        ws.send(JSON.stringify({ action: "set_speed", multiplier: FIXED_SPEED_MULTIPLIER }));

        // Re-arm a run that was in progress before the socket dropped. The
        // server's session survives a disconnect, but a *restarted* backend
        // comes back with `is_running = False`, and this is a reconnect path
        // as well as a first connect — so the client re-states its intent
        // rather than assuming the two sides still agree.
        if (isRunningRef.current) {
          ws.send(JSON.stringify({ action: "start" }));
        }

        // Recover latest simulation packet if available (§Phase 13 reconnect)
        fetch("/simulation/packets/latest")
          .then((res) => (res.ok ? res.json() : null))
          .then((pkt: SimulationPacket | null) => {
            if (pkt) {
              setLatestPacket(pkt);
              if (pkt.terrain?.changes && pkt.terrain.changes.length > 0) {
                setPerturbations(pkt.terrain.changes);
              }
            }
          })
          .catch(() => {});

        showToast("✓ CONNECTED TO ADRIYALA MINING SIMULATOR BACKEND");
      };

      ws.onclose = () => {
        // Losing the socket is not the operator pressing PAUSE. This used to
        // call `setIsRunning(false)`, so any transport blip silently disarmed
        // the run: the reconnect below restored the socket two seconds later,
        // but nothing restored the run state, and the UI sat on "Start" while
        // the operator had never stopped anything. `setIsConnected(false)`
        // already says the only thing a close actually tells us — that contact
        // was lost — and `onopen` re-arms the run once contact returns.
        setIsConnected(false);
        reconnectTimeout = setTimeout(connectWs, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle lightweight 60s packet available notification (§Phase 5 & Phase 6)
          const packetNotif =
            data.type === "packet_available"
              ? (data as PacketAvailableNotification)
              : data.packet_available
                ? (data.packet_available as PacketAvailableNotification)
                : null;

          if (packetNotif) {
            console.log(`[WS] packet ${packetNotif.packet_id} available notification received`);
            // Automatically pull packet without user click (§Phase 6)
            fetch(`/simulation/packets/${packetNotif.packet_id}`)
              .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
              })
              .then((pkt: SimulationPacket) => {
                console.log(`[FRONTEND] packet ${pkt.packet_id} fetched successfully`);
                setLatestPacket(pkt);
                setPacketCount((prev) => prev + 1);
                showToast(`📦 60s PACKET #${pkt.packet_id} SYNCHRONIZED`);

                // Update terrain if changed (§Phase 8)
                if (pkt.terrain?.changes && pkt.terrain.changes.length > 0) {
                  setPerturbations(pkt.terrain.changes);
                }

                // Update node telemetry from packet aggregates if available (§Phase 9)
                if (pkt.nodes && pkt.nodes.length > 0) {
                  setNodeTelemetry((prev) => {
                    const packetNodeMap = new Map(pkt.nodes.map((n) => [n.node_id, n]));
                    const baseList = prev && prev.length > 0 ? prev : (nodes && nodes.length > 0 ? nodes : FALLBACK_NODES);
                    return baseList.map((existing: any) => {
                      const pNode = packetNodeMap.get(existing.id);
                      if (!pNode) return existing;
                      return {
                        id: existing.id,
                        seq: pNode.aggregates?.last_seq ?? existing.seq,
                        tilt_x: pNode.aggregates?.max_tilt_x ?? existing.tilt_x,
                        tilt_y: pNode.aggregates?.max_tilt_y ?? existing.tilt_y,
                        strain: pNode.aggregates?.max_strain ?? existing.strain,
                        vib_rms: pNode.aggregates?.max_vib_rms ?? existing.vib_rms,
                        vib_peak: pNode.aggregates?.max_vib_peak ?? existing.vib_peak,
                        vib_fdom: pNode.last_reading?.vib_fdom ?? existing.vib_fdom,
                        rssi: pNode.last_reading?.rssi_dbm ?? existing.rssi,
                        snr: pNode.last_reading?.snr_db ?? existing.snr,
                        alive: pNode.aggregates?.last_alive ?? existing.alive ?? 1,
                      };
                    });
                  });
                }

                // Ingest packet events into structured logs (§Phase 7)
                if (pkt.events && pkt.events.length > 0) {
                  for (const ev of pkt.events) {
                    if (ev.kind === "zone_transition" && (ev.to === "CRITICAL" || ev.to === "FAILED")) {
                      setLogs((prev) => {
                        const newLog: LogEntry = {
                          id: `${ev.zone_id}-${ev.to}-${Date.now()}`,
                          timeStr: `pkt #${pkt.packet_id}`,
                          zoneId: ev.zone_id,
                          state: ev.to as SegmentState,
                          eps: 0,
                          kappa: 0,
                          message: `[PACKET #${pkt.packet_id}] ${ev.msg || `${ev.from}->${ev.to}`}`,
                          timestamp: new Date(),
                        };
                        return [newLog, ...prev.slice(0, 99)];
                      });
                    }
                  }
                }
              })
              .catch((err) => {
                console.warn(`[FRONTEND] Failed to fetch packet ${packetNotif.packet_id}:`, err);
              });

            if (data.type === "packet_available") {
              return;
            }
          }

          if (data.type === "init") {
            const init = data as InitPayload;
            // Adopt the server's site origin before anything is drawn, so the
            // 3D view projects metres against the same anchor the dashboard
            // map and the `nodes.lat`/`nodes.lon` columns use. Without this
            // the two screens can show the same node on different ground.
            setGeoOrigin(init.dem_lat, init.dem_lon, init.panel_bearing_deg);
            setZ0Mesh(init.z0_mesh);
            setBaseBowlMesh(init.base_bowl_mesh);
            setNodes(init.nodes);
            if (Number.isFinite(init.window_size_m)) setWindowSizeM(init.window_size_m);
            setElevMinM(init.elev_min_m);
            setElevMaxM(init.elev_max_m);
            return;
          }

          if (data.t_sim !== undefined) {
            const tick = data as TickPayload;
            setTSimSeconds(tick.t_sim);
            setTDays(tick.t_days);
            setTimeScalar(tick.time_scalar);
            setPerturbations(tick.perturbations || []);
            setNodeTelemetry(tick.nodes || []);
            setTickCount((prev) => prev + 1);

            const isVib = Boolean(tick.vibration_active);
            setVibrationActive(isVib);
            setVibrationPPV(tick.vibration_ppv || 0);

            if (tick.segments) {
              setZoneTelemetry(tick.segments);

              // Detect new warning or failure transitions
              for (const seg of tick.segments) {
                if (seg.state === "CRITICAL" || seg.state === "FAILED") {
                  setLogs((prev) => {
                    const alreadyPresent = prev.some((l) => l.zoneId === seg.id && l.state === seg.state);
                    if (!alreadyPresent) {
                      const newLog: LogEntry = {
                        id: `${seg.id}-${seg.state}-${Date.now()}`,
                        timeStr: `t=+${tick.t_days.toFixed(2)}d`,
                        zoneId: seg.id,
                        state: seg.state as SegmentState,
                        eps: seg.eps,
                        kappa: seg.kappa,
                        message:
                          seg.state === "CRITICAL"
                            ? `Pillar Yielding Warning: Strain ${seg.eps.toFixed(1)} mm/m exceeds yield limit!`
                            : `Dynamic Void Fall: Stratum shear complete. FoS < 1.0.`,
                        timestamp: new Date(),
                      };
                      return [newLog, ...prev.slice(0, 99)];
                    }
                    return prev;
                  });
                }
              }
            }
          }
        } catch (e) {
          console.error("WS Parse error", e);
        }
      };
    };

    connectWs();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) wsRef.current.close();
    };
  }, [showToast]);

  // Mirror the run state into the ref the socket callbacks read. Done in one
  // place rather than alongside each `setIsRunning` call, so a future writer
  // cannot forget to update the ref and silently reintroduce the stale-closure
  // bug this ref exists to avoid.
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  // Drive the countdown that releases the intervention lock. Only ticks while
  // an event is actually in flight, so an idle session does no timer work.
  useEffect(() => {
    if (eventEndsAt === null) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [eventEndsAt]);

  const sendWsAction = (payload: any) => {
    let sentViaWs = false;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(payload));
        sentViaWs = true;
      } catch (err) {
        console.warn("[App] WS send error:", err);
      }
    } else {
      console.warn("[App] WS not OPEN, state is:", wsRef.current?.readyState);
    }

    // Dual-channel reliability: also dispatch via HTTP POST /control
    if (payload && payload.action) {
      fetch("/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((err) => {
        if (!sentViaWs) {
          console.error("[App] Both WS and HTTP /control delivery failed:", err);
        }
      });
    }
  };

  const handleStart = () => {
    setIsRunning(true);
    sendWsAction({ action: "start" });
    showToast("▶ SIMULATION RUNNING (60s tick stream active)");
  };

  const handlePause = () => {
    setIsRunning(false);
    sendWsAction({ action: "pause" });
    showToast("⏸ SIMULATION PAUSED");
  };

  const handleCloseEverything = async () => {
    const confirmed = window.confirm(
      "STOP SIMULATION, WIPE DATABASE & CLOSE SESSION?\n\n" +
      "This will halt the simulation engine, wipe runtime tables in PostgreSQL, and close this session."
    );
    if (!confirmed) return;

    // 1. Send WS {action: "stop"} before reset so engine halts
    sendWsAction({ action: "stop" });
    setIsRunning(false);

    // Clear React state
    setTSimSeconds(0);
    setTDays(0);
    setTimeScalar(0);
    setPerturbations([]);
    setLogs([]);
    setSelectedNodeId(null);
    setNodeTelemetry([]);
    setZoneTelemetry([]);
    setTickCount(0);
    setVibrationActive(false);
    setVibrationPPV(0);
    setLatestPacket(null);
    setPacketCount(0);

    globalGeomechanics.reset();
    sendWsAction({ action: "reset" });

    // 2. Await database wipe before closing
    const host = window.location.hostname || "localhost";
    try {
      await fetch(`http://${host}:8080/api/system/reset`, { method: "POST" });
    } catch (e) {
      console.warn("Reset POST error:", e);
    }

    // 3. Attempt window.close()
    window.close();

    // 4. If window.close() does not take effect (e.g. user-opened browser tab), show full-screen overlay
    setIsSessionClosed(true);
  };

  // Trigger Ground Interventions
  const handleTriggerEvent = (type: PhysicalEventType, cx: number, cy: number, sev: number, rad: number) => {
    // Nothing is armed until the operator presses START. Before that the
    // panel was fully live: a cave-in fired into a stopped clock, so the
    // browser preview deformed the mesh while the server's two-phase failure
    // never advanced past t=0 — the bowl appeared without any of the zone
    // transitions that are supposed to precede it, and RESET was the only way
    // back. Refusing the trigger outright, rather than quietly queueing or
    // auto-starting it, keeps "what is on screen" equal to "what the
    // simulation has actually computed" at all times.
    //
    // STRESS is exempt because it *is* the start control (it calls
    // handleStart); gating it would make the button unable to do its one job.
    if (!isRunning && type !== "stress") {
      showToast("⏸ SIMULATION STOPPED — press START to arm interventions");
      return;
    }

    // One event at a time. Firing a second while the first is still moving the
    // ground superposes two solutions onto the same surface, and the server has
    // already been given a duration for the one in flight.
    if (eventInFlight && type !== "stress") {
      showToast("⏳ EVENT IN PROGRESS — wait for the ground to settle");
      return;
    }

    // The chosen speed drives both sides: `warning_hours`/`duration_hours` for
    // the server's two-phase failure, and an equivalent Knothe rate for the
    // browser preview, so the mesh and the telemetry finish together.
    const pace = eventPace(eventSpeed);
    const cPerDay = LiveGeomechanicsEngine.cPerDayForRealSeconds(
      pace.realSecondsToWatch, speedMultiplier,
    );
    const paceNote = ` [${pace.label}, ${paceTimingSummary(eventSpeed)}]`;

    // Arm the lock for everything except STRESS, which is the start control
    // rather than a ground event and moves nothing by itself.
    if (type !== "stress") {
      setNowMs(Date.now());
      setEventEndsAt(Date.now() + pace.realSecondsToWatch * 1000);
    }

    if (type === "collapse") {
      globalGeomechanics.triggerCollapse(
        cx, cy, sev, rad, performance.now() / 1000, speedMultiplier, cPerDay,
      );
      sendWsAction({
        action: "apply_collapse",
        cx,
        cy,
        radius_m: rad,
        magnitude_m: sev,
        duration_hours: pace.durationHours,
        warning_hours: pace.warningHours,
      });
      showToast(`💥 VOID ROOF CAVE-IN: ΔZ=${sev.toFixed(2)}m at (${cx.toFixed(0)}m, ${cy.toFixed(0)}m)${paceNote}`);
    } else if (type === "vibration") {
      setVibrationActive(true);
      setVibrationPPV(35.0);
      globalGeomechanics.triggerBlastVibration(35.0, 15.0);
      sendWsAction({
        action: "apply_vibration",
        magnitude_ppv: 35.0,
        duration_s: 60.0,
        note: "Heavy production blast shockwave",
      });
      showToast(`⚡ BLAST SHOCKWAVE: PPV=35.0 mm/s (0 mm static subsidence)`);
    } else if (type === "tilt") {
      // Tilt is dS/dx, so it is largest on the FLANK of a bowl rather than at
      // its centre. Offsetting the collapse by its own radius puts the target
      // on that flank, which is where the steepest ground gradient forms.
      // The old `cx + 30` was a fixed 30 m nudge unrelated to the bowl size,
      // so with a 75 m radius the target still sat near the flat bottom.
      const offset = rad;
      globalGeomechanics.triggerCollapse(
        cx + offset, cy, sev, rad, performance.now() / 1000, speedMultiplier, cPerDay,
      );
      sendWsAction({
        action: "apply_collapse",
        cx: cx + offset,
        cy,
        radius_m: rad,
        magnitude_m: sev,
        duration_hours: pace.durationHours,
        warning_hours: pace.warningHours,
      });
      showToast(
        `📐 SURFACE TILT: bowl centred ${offset.toFixed(0)} m off-target so the ` +
        `target sits on its flank (ΔZ=${sev.toFixed(2)} m, r=${rad.toFixed(0)} m)` + paceNote,
      );
    } else if (type === "stress") {
      handleStart();
      showToast(`⏳ EXTRACTION RUNNING: longwall face draw advancing`);
    }
  };

  // Terrain Click Handler for 3D Target Positioning
  const handleTerrainClick = (clickX: number, clickY: number) => {
    // Targeting is part of the armed state too: while stopped, a click on the
    // terrain must not move the crosshair or report an elevation/slope
    // reading, because no reading on this panel means anything before the
    // first tick has been computed.
    if (!isRunning) return;

    // Read the real DEM the viewport renders, not the retired procedural
    // hills, so the reported elevation and slope describe the ground the user
    // actually clicked on.
    const elev = sampleBaseGroundY(clickX, clickY);
    const slope = sampleSlopeDegrees(clickX, clickY);
    const zone = classifyTerrainZone(elev, slope);

    setTargetLocation({
      x: clickX,
      y: clickY,
      label: `Target (${clickX.toFixed(0)}m, ${clickY.toFixed(0)}m)`,
      elev,
      slopeDeg: slope,
      zoneName: zone,
    });
  };

  // Selecting a sensor node or a zone opens a panel of live readings, so it
  // is gated on the same rule as everything else: before START those fields
  // would show a stopped node's defaults (strain 0.00, tilt 0.00, the
  // hardware block's fallbacks) presented in exactly the format a real
  // measurement uses, which is worse than showing nothing. The camera and
  // orbit controls stay live throughout — looking around reads nothing.
  const handleSelectNode = (id: number | null) => {
    if (!isRunning) return;
    setSelectedNodeId(id === selectedNodeId ? null : id);
  };

  // Camera Presets
  const handleResetCamera = () => {
    if (viewportRef.current) {
      viewportRef.current.resetCamera();
      showToast("📷 CAMERA: Standard 1.2km Overview");
    }
  };

  const handleSelectCameraPreset = (preset: "overview" | "highland" | "pit" | "cutaway" | "topdown") => {
    if (viewportRef.current) {
      viewportRef.current.setCameraPreset(preset);
      showToast(`📷 CAMERA: Switched to ${preset.toUpperCase()}`);
    }
  };

  // Mathematical Inspector Data
  const liveMathData: LiveMathEvaluation = useMemo(() => {
    const cx = targetLocation.x;
    const cy = targetLocation.y;
    const dist = Math.hypot(cx, cy);
    const z0 = sampleBaseGroundY(cx, cy);
    const nowSec = performance.now() / 1000.0;
    const geo = globalGeomechanics.evaluatePoint(cx, cy, z0, nowSec);

    return {
      x: Math.round(cx * 10) / 10,
      y: Math.round(cy * 10) / 10,
      t_days: Math.round(tDays * 100) / 100,
      dist_from_center: Math.round(dist * 10) / 10,
      base_s_m: Math.round((geo.elevation - z0) * 1000) / 1000,
      collapse_delta_m: Math.round(geo.dropDistanceM * 1000) / 1000,
      total_s_m: Math.round(geo.dropDistanceM * 1000) / 1000,
      tilt_mm_m: Math.round(geo.tiltMmPerM * 100) / 100,
      curvature_per_m: geo.curvaturePerM,
      strain_mm_m: Math.round(geo.tensileStrainMmPerM * 100) / 100,
      time_factor: Math.round(timeScalar * 1000) / 1000,
    };
  }, [targetLocation, tDays, timeScalar, perturbations]);

  if (isSessionClosed) {
    return (
      <div style={{
        position: "fixed",
        inset: 0,
        background: "#070D12",
        color: "#E0E6ED",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999999,
        fontFamily: "monospace",
        textAlign: "center",
        padding: "24px"
      }}>
        <div style={{ fontSize: "28px", fontWeight: "bold", color: "#FF4444", marginBottom: "16px", letterSpacing: "0.05em" }}>
          SESSION CLOSED
        </div>
        <div style={{ fontSize: "14px", color: "#8BA0A8", maxWidth: "480px", lineHeight: "1.6" }}>
          Simulation has stopped and the database has been completely wiped to baseline.
          It is safe to close this browser tab.
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-viewport)", overflow: "hidden" }}>
      {/* 1. Single 34px menu bar (replaced the 5-tab, ~140px CAD ribbon). */}
      <MenuBar
        isConnected={isConnected}
        isRunning={isRunning}
        tDays={tDays}
        zones={zoneTelemetry}
        latestPacketId={latestPacket?.packet_id ?? null}
        onStart={handleStart}
        onPause={handlePause}
        onCloseEverything={handleCloseEverything}
        onOpenMathsModal={() => setIsMathsModalOpen(true)}
      />

      {/* 2. Main Work Area: Center 3D Viewport + Right-Side Docked Inspector Panel */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {/* Center 3D Simulation Viewport */}
        <div style={{ flex: 1, position: "relative", minHeight: 0, display: "flex", flexDirection: "column" }}>
          {/* Live Floating Toast */}
          {toastMessage && (
            <div
              style={{
                position: "absolute",
                top: "12px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 50,
                background: "var(--bg-raised)",
                border: "1px solid var(--border-strong)",
                color: "var(--text-primary)",
                padding: "6px 14px",
                fontSize: "var(--fs-body)",
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                pointerEvents: "none",
                borderRadius: "4px",
              }}
            >
              {toastMessage}
            </div>
          )}

          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            <MineViewport
              ref={viewportRef}
              z0Mesh={z0Mesh}
              baseBowlMesh={baseBowlMesh}
              elevMinM={elevMinM}
              windowSizeM={windowSizeM}
              elevMaxM={elevMaxM}
              timeScalar={timeScalar}
              perturbations={perturbations}
              latestPacket={latestPacket}
              nodes={nodes}
              nodeTelemetry={nodeTelemetry}
              exaggeration={exaggeration}
              selectedNodeId={selectedNodeId}
              targetLocation={targetLocation}
              collapseRadiusM={collapseRadiusM}
              showMeshTopology={showMeshTopology}
              vibrationActive={vibrationActive}
              onSelectNode={handleSelectNode}
              onTerrainClick={handleTerrainClick}
              wireframe={wireframe}
            />

            {/* Quick Floating Button to toggle Nodes Table if closed */}
            {!showConsole && (
              <button
                onClick={() => setShowConsole(true)}
                style={{
                  position: "absolute",
                  bottom: "12px",
                  left: "12px",
                  zIndex: 35,
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-strong)",
                  color: "var(--text-primary)",
                  borderRadius: "var(--radius-sm)",
                  padding: "5px 12px",
                  fontSize: "var(--fs-label)",
                  fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span style={{ color: "var(--state-info)" }}>📊</span>
                <span>OPEN NODES TABLE ({nodes.length} NODES)</span>
              </button>
            )}
          </div>

          {/* 3. Docked Bottom Nodes Stream Table */}
          {showConsole && (
            <TelemetryDrawer
              logs={logs}
              selectedNodeId={selectedNodeId}
              nodes={nodes}
              nodeTelemetry={nodeTelemetry}
              zones={zoneTelemetry}
              tickCount={tickCount}
              tSimSeconds={tSimSeconds}
              tDays={tDays}
              vibrationActive={vibrationActive}
              vibrationPPV={vibrationPPV}
              packetCount={packetCount}
              onSelectNode={handleSelectNode}
              onClose={() => setShowConsole(false)}
            />
          )}
        </div>

        {/* 4. Right-Side Docked Inspector Panel */}
        <RightInspectorPanel
          isRunning={isRunning}
          selectedNodeId={selectedNodeId}
          nodes={nodes && nodes.length > 0 ? nodes : FALLBACK_NODES}
          nodeTelemetry={nodeTelemetry}
          exaggeration={exaggeration}
          nodeNeighbors={nodeNeighbors}
          onSelectNode={handleSelectNode}
          onCenterCamera={(x, y, z) => {
            if (viewportRef.current) {
              viewportRef.current.focusOnPoint(x, y, z);
              showToast(`📷 [CAMERA] Centered on Node N-${String(selectedNodeId).padStart(2, "0")}`);
            }
          }}
          onTriggerEventAtNode={(x, y) => {
            handleTriggerEvent("collapse", x, y, dropMagnitude, collapseRadiusM);
          }}
          targetLocation={targetLocation}
          onSetTargetLocation={setTargetLocation}
          severity={dropMagnitude}
          onChangeSeverity={setDropMagnitude}
          radiusM={collapseRadiusM}
          onChangeRadius={setCollapseRadiusM}
          onTriggerEvent={handleTriggerEvent}
          eventSpeed={eventSpeed}
          onChangeEventSpeed={setEventSpeed}
          eventInFlight={eventInFlight}
          eventSecondsLeft={
            eventEndsAt === null ? 0 : Math.max(0, (eventEndsAt - nowMs) / 1000)
          }
          onChangeExaggeration={setExaggeration}
          wireframe={wireframe}
          onToggleWireframe={() => setWireframe(!wireframe)}
          showMeshTopology={showMeshTopology}
          onToggleMeshTopology={() => setShowMeshTopology(!showMeshTopology)}
          onResetCamera={handleResetCamera}
          onSelectCameraPreset={handleSelectCameraPreset}
        />
      </div>

      {/* Modal Dialogs */}
      <GroundPhysicsModal
        infoKey={activeExplainerKey}
        onClose={() => setActiveExplainerKey(null)}
      />

      <LiveMathModal
        isOpen={isMathsModalOpen}
        onClose={() => setIsMathsModalOpen(false)}
        mathData={liveMathData}
      />

    </div>
  );
};

export default App;
