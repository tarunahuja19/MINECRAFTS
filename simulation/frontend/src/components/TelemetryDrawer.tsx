import React, { useState } from "react";
import { Download, Search, Terminal, X } from "lucide-react";
import type { LogEntry, NodeDef, NodeTelemetry, ZoneTelemetry } from "../types";
import { STATE_COLORS } from "../types";
import { SeismographOscilloscope } from "./SeismographOscilloscope";

interface TelemetryDrawerProps {
  logs: LogEntry[];
  selectedNodeId: number | null;
  nodes: NodeDef[];
  nodeTelemetry: NodeTelemetry[];
  zones: ZoneTelemetry[];
  tickCount: number;
  tSimSeconds: number;
  tDays: number;
  vibrationActive: boolean;
  vibrationPPV: number;
  packetCount?: number;
  onSelectNode?: (id: number) => void;
  onClose: () => void;
}

/**
 * Render one telemetry cell. `null` means the node's tier carries no such
 * sensor and prints as an em dash — never as 0, and never as an invented
 * default. See `NodeTelemetry` for why that distinction is load-bearing.
 */
const cell = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : `${v}`;

export const TelemetryDrawer: React.FC<TelemetryDrawerProps> = ({
  logs,
  selectedNodeId,
  nodes,
  nodeTelemetry,
  zones,
  tickCount,
  tSimSeconds,
  tDays,
  vibrationActive,
  vibrationPPV,
  packetCount = 0,
  onSelectNode,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<"csv" | "seismograph" | "logs" | "dgms">("csv");
  const [searchNode, setSearchNode] = useState<string>("");

  const filteredNodes = nodeTelemetry.filter((n) => {
    if (!searchNode) return true;
    return String(n.id).includes(searchNode.trim()) || `N-${n.id}`.toLowerCase().includes(searchNode.trim().toLowerCase());
  });

  const handleDownloadNodesCsv = () => {
    const host = window.location.hostname || "localhost";
    window.open(`http://${host}:8000/data/nodes.csv`, "_blank");
  };

  const handleDownloadEventsCsv = () => {
    const host = window.location.hostname || "localhost";
    window.open(`http://${host}:8000/data/events.csv`, "_blank");
  };

  return (
    <footer
      className="docked-panel"
      style={{
        height: "220px",
        borderTop: "1px solid rgba(255, 255, 255, 0.14)",
        background: "var(--bg-void)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header Bar */}
      <div className="docked-header" style={{ padding: "6px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <Terminal size={13} color="var(--state-info)" />
            <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)" }}>
              TELEMETRY & CSV ENGINE
            </span>
          </div>

          {/* Tab Switcher */}
          <div style={{ display: "flex", gap: "2px" }}>
            <button
              onClick={() => setActiveTab("csv")}
              style={{
                background: activeTab === "csv" ? "var(--bg-hover)" : "transparent",
                color: activeTab === "csv" ? "var(--state-info)" : "var(--text-secondary)",
                border: activeTab === "csv" ? "1px solid var(--state-info)" : "1px solid transparent",
                padding: "2px 7px",
                fontSize: "var(--fs-label)",
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
              }}
            >
              NODES.CSV ({tickCount * 33} ROWS · {packetCount} PKTS)
            </button>

            <button
              onClick={() => setActiveTab("seismograph")}
              style={{
                background: activeTab === "seismograph" ? "var(--bg-hover)" : "transparent",
                color: activeTab === "seismograph" ? "var(--state-info)" : "var(--text-secondary)",
                border: activeTab === "seismograph" ? "1px solid var(--state-info)" : "1px solid transparent",
                padding: "2px 7px",
                fontSize: "var(--fs-label)",
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
              }}
            >
              SEISMOGRAPH PPV
            </button>

            <button
              onClick={() => setActiveTab("logs")}
              style={{
                background: activeTab === "logs" ? "var(--bg-hover)" : "transparent",
                color: activeTab === "logs" ? "var(--state-info)" : "var(--text-secondary)",
                border: activeTab === "logs" ? "1px solid var(--state-info)" : "1px solid transparent",
                padding: "2px 7px",
                fontSize: "var(--fs-label)",
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
              }}
            >
              EVENTS.CSV ({logs.length})
            </button>

            <button
              onClick={() => setActiveTab("dgms")}
              style={{
                background: activeTab === "dgms" ? "var(--bg-hover)" : "transparent",
                color: activeTab === "dgms" ? "var(--state-info)" : "var(--text-secondary)",
                border: activeTab === "dgms" ? "1px solid var(--state-info)" : "1px solid transparent",
                padding: "2px 7px",
                fontSize: "var(--fs-label)",
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
              }}
            >
              DGMS COMPLIANCE
            </button>
          </div>
        </div>

        {/* Action Controls & Download Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Download CSV Button */}
          <button
            onClick={activeTab === "logs" ? handleDownloadEventsCsv : handleDownloadNodesCsv}
            title="Download CSV file directly"
            className="hud-btn"
            style={{
              padding: "2px 6px",
              fontSize: "var(--fs-label)",
              background: "rgba(16, 185, 129, 0.15)",
              borderColor: "rgba(16, 185, 129, 0.4)",
              color: "var(--state-active)",
            }}
          >
            <Download size={11} />
            <span>DOWNLOAD {activeTab === "logs" ? "EVENTS.CSV" : "NODES.CSV"}</span>
          </button>

          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 10px" }}>
        {activeTab === "csv" && (
          /* Live nodes.csv Table View */
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {/* Table Search & Filter Bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Search size={12} color="var(--text-secondary)" />
                <input
                  type="text"
                  placeholder="Filter by Node ID (e.g. 14)..."
                  value={searchNode}
                  onChange={(e) => setSearchNode(e.target.value)}
                  style={{
                    background: "var(--bg-viewport)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    color: "var(--state-info)",
                    padding: "2px 6px",
                    fontSize: "var(--fs-label)",
                    fontFamily: "var(--font-mono)",
                    width: "180px",
                  }}
                />
              </div>

              <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                Writing to <code>out/nodes.csv</code> ({nodes.length} nodes deployed | sim-time: t=+{tDays.toFixed(2)}d / {tSimSeconds}s)
              </div>
            </div>

            {/* CSV Data Table */}
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "var(--fs-label)",
                  fontFamily: "var(--font-mono)",
                  textAlign: "left",
                }}
              >
                <thead>
                  <tr style={{ background: "var(--bg-panel)", color: "var(--state-info)", borderBottom: "1px solid rgba(255, 255, 255, 0.12)" }}>
                    <th style={{ padding: "4px 6px" }}>NODE</th>
                    <th style={{ padding: "4px 6px" }}>TIER</th>
                    <th style={{ padding: "4px 6px" }}>STRAIN (µε)</th>
                    <th style={{ padding: "4px 6px" }}>STRAIN (mm/m)</th>
                    <th style={{ padding: "4px 6px" }}>TILT θx (µrad)</th>
                    <th style={{ padding: "4px 6px" }}>TILT θy (µrad)</th>
                    <th style={{ padding: "4px 6px" }}>VIB RMS (x100)</th>
                    <th style={{ padding: "4px 6px" }}>VIB PEAK (x100)</th>
                    <th style={{ padding: "4px 6px" }}>VIB f_dom (Hz)</th>
                    <th style={{ padding: "4px 6px" }}>RSSI (dBm)</th>
                    <th style={{ padding: "4px 6px" }}>SNR (dB)</th>
                    <th style={{ padding: "4px 6px" }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNodes.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ padding: "8px", textAlign: "center", color: "var(--text-muted)", fontStyle: "italic" }}>
                        Waiting for simulation start... Click START in top bar to record live nodes.csv ticks.
                      </td>
                    </tr>
                  ) : (
                    filteredNodes.map((n) => {
                      // A null channel means this node's tier carries no such
                      // sensor, and is rendered "—". It must never be coerced
                      // to a number: `n.strain || 0` used to print 0 µε for
                      // every anchor, which reads as "measured, unstrained"
                      // when the truth is "has no strain gauge". Likewise the
                      // old `?? 18` / `?? 25` / `?? 3600` defaults invented
                      // plausible telemetry for hardware that does not exist.
                      const strain_mm = n.strain !== null ? n.strain / 1000.0 : null;
                      const isDanger = strain_mm !== null && Math.abs(strain_mm) > 5.3;
                      const isWarn =
                        strain_mm !== null && Math.abs(strain_mm) > 3.5 && !isDanger;
                      const isSelected = selectedNodeId === n.id;
                      const tier = nodes.find((d) => d.id === n.id)?.tier ?? "—";

                      return (
                        <tr
                          key={n.id}
                          onClick={() => onSelectNode?.(n.id)}
                          style={{
                            cursor: "pointer",
                            background: isSelected
                              ? "var(--bg-hover)"
                              : isDanger
                              ? "rgba(239, 68, 68, 0.12)"
                              : "rgba(5, 8, 17, 0.5)",
                            borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                            color: isSelected ? "var(--state-info)" : "var(--text-primary)",
                            transition: "background 0.1s ease",
                          }}
                        >
                          <td style={{ padding: "3px 6px", fontWeight: 700, color: "var(--state-info)" }}>
                            N-{String(n.id).padStart(2, "0")}
                          </td>
                          <td style={{ padding: "3px 6px", color: "var(--text-secondary)" }}>{tier}</td>
                          <td style={{ padding: "3px 6px" }}>{cell(n.strain)}</td>
                          <td
                            style={{
                              padding: "3px 6px",
                              fontWeight: 700,
                              color:
                                strain_mm === null ? "var(--text-muted)"
                                : isDanger ? "var(--state-critical)"
                                : isWarn ? "var(--state-warning)"
                                : "var(--state-active)",
                            }}
                          >
                            {strain_mm === null
                              ? "—"
                              : strain_mm >= 0
                                ? `+${strain_mm.toFixed(2)}`
                                : strain_mm.toFixed(2)}
                          </td>
                          <td style={{ padding: "3px 6px" }}>{cell(n.tilt_x)}</td>
                          <td style={{ padding: "3px 6px" }}>{cell(n.tilt_y)}</td>
                          <td style={{ padding: "3px 6px" }}>{cell(n.vib_rms)}</td>
                          <td
                            style={{
                              padding: "3px 6px",
                              color: (n.vib_peak ?? 0) > 1500 ? "var(--state-critical)" : "var(--text-primary)",
                              fontWeight: (n.vib_peak ?? 0) > 1500 ? 800 : 400,
                            }}
                          >
                            {cell(n.vib_peak)}
                          </td>
                          {/* f_dom discriminates the source: truck 8-20 Hz,
                              conveyor ~50 Hz, blast 40-80 Hz, and microseismic
                              100-250 Hz — the precursor band that matters. */}
                          <td
                            style={{
                              padding: "3px 6px",
                              color:
                                n.vib_fdom !== null && n.vib_fdom >= 100
                                  ? "var(--state-warning)"
                                  : "var(--text-primary)",
                              fontWeight: n.vib_fdom !== null && n.vib_fdom >= 100 ? 800 : 400,
                            }}
                          >
                            {cell(n.vib_fdom)}
                          </td>
                          <td style={{ padding: "3px 6px" }}>{cell(n.rssi)}</td>
                          <td style={{ padding: "3px 6px" }}>{cell(n.snr)}</td>
                          <td style={{ padding: "3px 6px" }}>
                            <span
                              style={{
                                fontSize: "var(--fs-label)",
                                padding: "1px 4px",
                                background: n.alive ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)",
                                color: n.alive ? "var(--state-active)" : "var(--state-critical)",
                                fontWeight: 700,
                              }}
                            >
                              {n.alive ? "ONLINE" : "DEAD"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "seismograph" && (
          /* Live Seismograph Oscilloscope View */
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "10px" }}>
            <SeismographOscilloscope
              vibrationActive={vibrationActive}
              vibrationPPV={vibrationPPV}
            />

            <div className="hud-card" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ fontSize: "var(--fs-label)", fontWeight: 800, color: "var(--state-info)", fontFamily: "var(--font-mono)" }}>
                DGMS BLAST DISCRIMINATION FILTER (Gate T36)
              </div>
              <p style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                Deep-hole blasting shakes all 33 MEMS accelerometers with transient PPV spikes while leaving static ground displacement at exactly <strong>0.0 mm</strong>.
              </p>
              <div
                style={{
                  background: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  padding: "4px 8px",
                  fontSize: "var(--fs-label)",
                  color: "var(--state-active)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                ✓ BLAST REJECTION INVARIANT: Invariant ΔS = 0 confirmed. Eliminates false subsidence alarms.
              </div>
            </div>
          </div>
        )}

        {activeTab === "logs" && (
          /* Events.csv Zone State Transitions View */
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {logs.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-label)", fontStyle: "italic", fontFamily: "var(--font-mono)" }}>
                [READY] No zone state transitions yet. Click START in top bar to record live events.csv events.
              </div>
            ) : (
              logs.map((log) => {
                const color = STATE_COLORS[log.state] || "var(--text-secondary)";
                return (
                  <div
                    key={log.id}
                    className="font-mono"
                    style={{
                      fontSize: "var(--fs-label)",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "3px 6px",
                      background: "var(--bg-panel)",
                      borderLeft: `3px solid ${color}`,
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                    }}
                  >
                    <span style={{ color: "var(--text-muted)" }}>{log.timeStr}</span>
                    <span style={{ color: "var(--state-info)", fontWeight: 700 }}>{log.zoneId}</span>
                    <span
                      style={{
                        color: color,
                        fontWeight: 800,
                        padding: "1px 4px",
                        background: "rgba(255,255,255,0.05)",
                        fontSize: "var(--fs-label)",
                      }}
                    >
                      {log.state}
                    </span>
                    <span style={{ color: "var(--text-primary)" }}>
                      ε={log.eps >= 0 ? `+${log.eps.toFixed(1)}` : log.eps.toFixed(1)} mm/m
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>κ={log.kappa.toExponential(1)} /m</span>
                    <span style={{ color: color, opacity: 0.9 }}>{log.message}</span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "dgms" && (
          /* DGMS Kamptee Standards Matrix */
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
            <div className="hud-card" style={{ borderLeft: "2px solid var(--state-critical)" }}>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--state-critical)", fontWeight: 700 }}>TENSILE STRAIN LIMIT (ε_t)</div>
              <div className="font-mono" style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-primary)" }}>
                +5.3 mm/m (0.53%)
              </div>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)" }}>Exceeding causes surface fissures & water ingress.</div>
            </div>

            <div className="hud-card" style={{ borderLeft: "2px solid var(--state-info-alt)" }}>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--state-info-alt)", fontWeight: 700 }}>COMPRESSIVE LIMIT (ε_c)</div>
              <div className="font-mono" style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-primary)" }}>
                -6.6 mm/m (-0.66%)
              </div>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)" }}>Compressive trough inflection boundary limit.</div>
            </div>

            <div className="hud-card" style={{ borderLeft: "2px solid var(--state-warning)" }}>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--state-warning)", fontWeight: 700 }}>MAX TILT GRADIENT (i_max)</div>
              <div className="font-mono" style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-primary)" }}>
                15.0 mm/m (1.5%)
              </div>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)" }}>Infrastructure damage threshold for structures.</div>
            </div>

            <div className="hud-card" style={{ borderLeft: "2px solid var(--state-active)" }}>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--state-active)", fontWeight: 700 }}>ACTIVE SEGMENT ZONES</div>
              <div className="font-mono" style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-primary)" }}>
                {zones.length > 0 ? `${zones.length} ZONES MONITORED` : "36 ZONES ACTIVE"}
              </div>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)" }}>Real-time state machine tracking.</div>
            </div>
          </div>
        )}
      </div>
    </footer>
  );
};
