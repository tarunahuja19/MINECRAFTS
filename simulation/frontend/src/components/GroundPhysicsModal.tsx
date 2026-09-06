import React from "react";
import { AlertOctagon, Flame, Radio, X, Zap } from "lucide-react";

export type InfoKey = "collapse" | "stress" | "tension" | "vibration";

interface GroundPhysicsModalProps {
  infoKey: InfoKey | null;
  onClose: () => void;
}

interface ExplainerContent {
  title: string;
  badge: string;
  color: string;
  icon: React.ReactNode;
  mechanism: string;
  equation: string;
  sensorImpact: string[];
  dgmsContext: string;
}

const EXPLAINERS: Record<InfoKey, ExplainerContent> = {
  collapse: {
    title: "Pillar Failure & Localized Dynamic Collapse",
    badge: "Discontinuous Event (Hours) · Gate T50",
    color: "var(--state-critical)",
    icon: <AlertOctagon size={20} color="var(--state-critical)" />,
    mechanism:
      "Simulates localized yielding and crushing of remnant coal pillars (Factor of Safety FoS < 1.0). The roof void breaches dynamically, causing localized step drops superimposed onto the regional Knothe subsidence bowl.",
    equation:
      "S_total(x,y,t) = S_knothe(x,y,t) + ΔS_step · exp(-((x-cx)² + (y-cy)²)/(2·r²))\nProgresses through a pre-collapse yielding phase (t_init to t_collapse) before sudden dynamic void collapse.",
    sensorImpact: [
      "Zones transition through CRITICAL (yielding warning) before FAILED (Gate T50).",
      "Strain gauges detect sharp localized tensile peaks (> 5.3 mm/m) along the perimeter.",
      "Tiltmeters register steep radial slope gradients (θx, θy) pointing inward.",
      "Extensometers record vertical step displacement of up to the step magnitude.",
    ],
    dgmsContext:
      "Mandated warning window: The simulator guarantees early detection of yielding before full void collapse, allowing miners to evacuate extraction zones.",
  },
  stress: {
    title: "Stress Extraction Ratio (Knothe Deepening)",
    badge: "Continuous Knothe Physics (Days)",
    color: "var(--state-warning)",
    icon: <Flame size={20} color="var(--state-warning)" />,
    mechanism:
      "Simulates increasing the extraction ratio or rate of coal seam extraction at the longwall face. Over simulated days, the continuous regional subsidence trough deepens progressively.",
    equation:
      "S(x,y,t) = S_max · (1 - exp(-c_knothe · t)) · [A(x,y) * k_infl(x,y)]\nWhere c_knothe = 0.04/day and radius of influence r = 197.4 m.",
    sensorImpact: [
      "Gradual increase in compressive strain at the center of the extraction panel.",
      "Steady increase in outward tilt along the inflection zone flanks.",
      "No sudden discontinuous step drops; smooth continuous displacement.",
    ],
    dgmsContext:
      "Monitored against maximum permissible subcritical subsidence limit of 2.25 m (Adriyala calculated peak = 1.997 m, Gate T47).",
  },
  tension: {
    title: "Induce Tensile Shear & Surface Fissuring",
    badge: "Aviershin Differential Relation",
    color: "var(--state-accent)",
    icon: <Zap size={20} color="var(--state-accent)" />,
    mechanism:
      "Forces a high-shear tensile strain concentration along the extraction panel boundary where the ground surface bends convexly over unmined coal pillars.",
    equation:
      "ε(x,y) = B_horiz · κ(x,y)\nWhere B_horiz = 67.8 m (horizontal displacement factor) and κ is ground curvature. Tensile limit = +5.3 mm/m (0.53%).",
    sensorImpact: [
      "Zone transitions into TENSION and CRITICAL state.",
      "Strain channels spike past the +5.3 mm/m DGMS threshold, predicting surface fissures.",
      "Tilt channels indicate convex inflection with steep curvature.",
    ],
    dgmsContext:
      "Kamptee Coalfield geological standard: Strains exceeding +5.3 mm/m result in open surface fractures and water ingress risks.",
  },
  vibration: {
    title: "Blast Vibration & Seismic Transient",
    badge: "Transient Signal (Gate T54 / was T36)",
    color: "var(--state-info)",
    icon: <Radio size={20} color="var(--state-info)" />,
    mechanism:
      "Simulates heavy deep-hole blasting or minor seismic tremors in neighboring strata. It generates a transient high-frequency acceleration spike across the sensor network without permanently deforming the ground.",
    equation:
      "Surface displacement delta = 0.0 mm (S_total is strictly invariant)\nTransient PPV spike injected on vibration RMS, peak, and dominant frequency channels.",
    sensorImpact: [
      "Vibration RMS (vib_rms_x100) and Peak PPV spike instantly to > 15-25 mm/s.",
      "Zero change to static tilt, strain, or extensometer baseline readings.",
      "Demonstrates high SNR detectability and noise rejection (Gate T48 / T54).",
    ],
    dgmsContext:
      "DGMS Circular 7 of 1997: Permissible peak particle velocity (PPV) limits for industrial buildings and surface structures.",
  },
};

export const GroundPhysicsModal: React.FC<GroundPhysicsModalProps> = ({ infoKey, onClose }) => {
  if (!infoKey) return null;
  const info = EXPLAINERS[infoKey];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(3, 5, 10, 0.85)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        className="hud-bracket-box"
        style={{
          width: "560px",
          maxWidth: "95vw",
          background: "var(--bg-primary)",
          border: `1px solid ${info.color}`,
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.7)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 14px",
            background: "var(--bg-raised)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {info.icon}
            <div>
              <h2 style={{ fontSize: "13px", fontWeight: 800, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                {info.title}
              </h2>
              <span
                className="font-mono"
                style={{ fontSize: "var(--fs-label)", color: info.color, fontWeight: 700 }}
              >
                {info.badge}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body Content */}
        <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Mechanism */}
          <div>
            <div style={{ fontSize: "var(--fs-label)", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "3px", fontFamily: "var(--font-mono)" }}>
              PHYSICAL PHENOMENON
            </div>
            <p style={{ fontSize: "var(--fs-body)", color: "var(--text-primary)", lineHeight: "1.5" }}>{info.mechanism}</p>
          </div>

          {/* Governing Equation */}
          <div
            style={{
              background: "var(--bg-void)",
              padding: "8px 10px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <div style={{ fontSize: "var(--fs-label)", fontWeight: 700, color: "var(--state-info)", marginBottom: "3px", fontFamily: "var(--font-mono)" }}>
              GOVERNING EQUATION & INVARIANT
            </div>
            <pre
              className="font-mono"
              style={{
                fontSize: "var(--fs-label)",
                color: "var(--text-primary)",
                whiteSpace: "pre-wrap",
                lineHeight: "1.4",
              }}
            >
              {info.equation}
            </pre>
          </div>

          {/* Sensor Telemetry Impact */}
          <div>
            <div style={{ fontSize: "var(--fs-label)", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>
              EXPECTED SENSOR NETWORK RESPONSE
            </div>
            <ul style={{ paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "3px" }}>
              {info.sensorImpact.map((item, idx) => (
                <li key={idx} style={{ fontSize: "var(--fs-body)", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* DGMS Standards */}
          <div
            style={{
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              padding: "6px 10px",
              fontSize: "var(--fs-label)",
              color: "var(--state-active)",
              lineHeight: "1.4",
              fontFamily: "var(--font-mono)",
            }}
          >
            <strong>REGULATORY BENCHMARK:</strong> {info.dgmsContext}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "8px 14px",
            background: "var(--bg-void)",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            className="hud-btn"
            style={{ padding: "4px 10px", fontSize: "var(--fs-label)" }}
          >
            CLOSE GUIDE
          </button>
        </div>
      </div>
    </div>
  );
};
