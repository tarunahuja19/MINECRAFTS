import React from "react";
import { Calculator, CheckCircle2, Sigma, X } from "lucide-react";
import type { LiveMathEvaluation } from "../types";

interface LiveMathModalProps {
  isOpen: boolean;
  onClose: () => void;
  mathData: LiveMathEvaluation;
}

export const LiveMathModal: React.FC<LiveMathModalProps> = ({
  isOpen,
  onClose,
  mathData,
}) => {
  if (!isOpen) return null;

  const {
    x,
    y,
    t_days,
    dist_from_center,
    base_s_m,
    collapse_delta_m,
    total_s_m,
    tilt_mm_m,
    curvature_per_m,
    strain_mm_m,
    time_factor,
  } = mathData;

  const isTensileDanger = strain_mm_m > 5.3;
  const isTensileWarn = strain_mm_m > 4.0 && !isTensileDanger;
  const isComprDanger = strain_mm_m < -6.6;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(3, 5, 10, 0.88)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 110,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        className="hud-bracket-box"
        style={{
          width: "680px",
          maxWidth: "96vw",
          maxHeight: "92vh",
          background: "var(--bg-primary)",
          border: "1px solid var(--state-info)",
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.7)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            background: "var(--bg-raised)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Calculator size={18} color="var(--state-info)" />
            <div>
              <h2 style={{ fontSize: "14px", fontWeight: 800, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                LIVE GEOTECHNICAL MATHEMATICS INSPECTOR
              </h2>
              <span className="font-mono" style={{ fontSize: "var(--fs-label)", color: "var(--state-info)" }}>
                Knothe Influence Convolution & Aviershin Derivative Formulation
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
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Active Target Header Card */}
          <div className="hud-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)", fontWeight: 700 }}>EVALUATION TARGET COORDINATES</div>
              <div className="font-mono" style={{ fontSize: "14px", fontWeight: 800, color: "var(--state-info)", marginTop: "2px" }}>
                X: {x.toFixed(1)} m | Y: {y.toFixed(1)} m (Distance from Center: {dist_from_center.toFixed(1)} m)
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)", fontWeight: 700 }}>SIMULATED TIME</div>
              <div className="font-mono" style={{ fontSize: "13px", fontWeight: 800, color: "var(--state-warning)" }}>
                t = +{t_days.toFixed(2)} days (s(t) = {time_factor.toFixed(4)})
              </div>
            </div>
          </div>

          {/* Equation 1: Knothe Time & Spatial Influence Function */}
          <div className="hud-card">
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <Sigma size={14} color="var(--state-info)" />
              <span style={{ fontSize: "var(--fs-body)", fontWeight: 800, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                1. Continuous Knothe Subsidence Bowl S(x, y, t)
              </span>
            </div>
            <pre className="font-mono" style={{ fontSize: "var(--fs-label)", color: "var(--state-info-alt)", background: "var(--bg-viewport)", padding: "8px", lineHeight: "1.5" }}>
              {"S_knothe(x,y,t) = a · m · [1 - exp(-c · t)] · ∬ (1/r²)·exp(-π·((x-ξ)²+(y-η)²)/r²) dξ dη\n"}
              {"Where: a=0.75, m=3.0m, H=375m, tanβ=1.9 -> r = H/tanβ = 197.4m, c = 0.04 day⁻¹"}
            </pre>
            <div className="font-mono" style={{ fontSize: "var(--fs-body)", color: "var(--text-primary)", marginTop: "6px" }}>
              <strong>Evaluated Value:</strong> S_knothe = {base_s_m.toFixed(4)} m
            </div>
          </div>

          {/* Equation 2: Discontinuous Pillar Failure Delta */}
          <div className="hud-card">
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <Sigma size={14} color="var(--state-critical)" />
              <span style={{ fontSize: "var(--fs-body)", fontWeight: 800, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                2. Discontinuous Collapse Step ΔS_step (Pillar Failure FoS &lt; 1)
              </span>
            </div>
            <pre className="font-mono" style={{ fontSize: "var(--fs-label)", color: "var(--state-critical)", background: "var(--bg-viewport)", padding: "8px", lineHeight: "1.5" }}>
              {"ΔS_step(x,y,t) = ΔS_mag · f_time(t) · exp(-((x-cx)² + (y-cy)²)/(2·r_step²))\n"}
              {"Superimposed localized void breach over hours (Gate T37 / T50)"}
            </pre>
            <div className="font-mono" style={{ fontSize: "var(--fs-body)", color: "var(--text-primary)", marginTop: "6px" }}>
              <strong>Evaluated Value:</strong> ΔS_step = {collapse_delta_m.toFixed(4)} m | <strong>Total S = {(total_s_m).toFixed(4)} m</strong>
            </div>
          </div>

          {/* Equation 3: Aviershin Differential Relations (Tilt, Curvature, Strain) */}
          <div className="hud-card">
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <Sigma size={14} color="var(--state-accent)" />
              <span style={{ fontSize: "var(--fs-body)", fontWeight: 800, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                3. Aviershin Differential Relations (Tilt, Curvature, Horizontal Strain)
              </span>
            </div>
            <pre className="font-mono" style={{ fontSize: "var(--fs-label)", color: "var(--state-accent)", background: "var(--bg-viewport)", padding: "8px", lineHeight: "1.5" }}>
              {"Tilt θ(x,y)       = |∇S| = √[(∂S/∂x)² + (∂S/∂y)²]\n"}
              {"Curvature κ(x,y)  = ∇²S = -(∂²S/∂x² + ∂²S/∂y²)\n"}
              {"Strain ε(x,y)     = B_horiz · κ(x,y)   [where B_horiz = 0.35 · r = 69.1 m]"}
            </pre>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginTop: "8px" }}>
              <div style={{ background: "var(--bg-viewport)", padding: "6px 8px" }}>
                <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)" }}>TILT GRADIENT (θ)</div>
                <div className="font-mono" style={{ fontSize: "12px", fontWeight: 800, color: "var(--state-warning)" }}>
                  {tilt_mm_m.toFixed(2)} mm/m
                </div>
              </div>

              <div style={{ background: "var(--bg-viewport)", padding: "6px 8px" }}>
                <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)" }}>CURVATURE (κ)</div>
                <div className="font-mono" style={{ fontSize: "12px", fontWeight: 800, color: "var(--state-info-alt)" }}>
                  {curvature_per_m.toExponential(2)} /m
                </div>
              </div>

              <div style={{ background: "var(--bg-viewport)", padding: "6px 8px" }}>
                <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)" }}>HORIZONTAL STRAIN (ε)</div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: "12px",
                    fontWeight: 800,
                    color: isTensileDanger ? "var(--state-critical)" : isTensileWarn ? "var(--state-warning)" : "var(--state-active)",
                  }}
                >
                  {strain_mm_m >= 0 ? `+${strain_mm_m.toFixed(2)}` : strain_mm_m.toFixed(2)} mm/m
                </div>
              </div>
            </div>
          </div>

          {/* DGMS Standards Verification Box */}
          <div
            className="hud-card"
            style={{
              borderLeft: isTensileDanger
                ? "3px solid var(--state-critical)"
                : isTensileWarn
                ? "3px solid var(--state-warning)"
                : "3px solid var(--state-active)",
              background: isTensileDanger
                ? "rgba(239, 68, 68, 0.1)"
                : "rgba(16, 185, 129, 0.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <CheckCircle2 size={14} color={isTensileDanger ? "var(--state-critical)" : "var(--state-active)"} />
              <strong style={{ fontSize: "var(--fs-body)", color: isTensileDanger ? "var(--state-critical)" : "var(--state-active)", fontFamily: "var(--font-mono)" }}>
                DGMS KAMPTEE COALFIELD CRITICAL LIMIT ASSESSMENT:
              </strong>
            </div>
            <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)", marginTop: "4px", lineHeight: "1.4" }}>
              {isTensileDanger ? (
                <span style={{ color: "var(--state-critical)", fontWeight: 700 }}>
                  CRITICAL: Tensile strain ({strain_mm_m.toFixed(2)} mm/m) exceeds the permissible DGMS threshold (+5.3 mm/m). Surface fissure inception and shear fracture predicted!
                </span>
              ) : isComprDanger ? (
                <span style={{ color: "var(--state-info-alt)", fontWeight: 700 }}>
                  COMPRESSIVE ALERT: Compressive strain ({strain_mm_m.toFixed(2)} mm/m) exceeds -6.6 mm/m trough inflection threshold.
                </span>
              ) : (
                <span>
                  NORMAL / STABLE: Ground deformation is within safe geological tolerance (Tensile limit: +5.3 mm/m, Compressive limit: -6.6 mm/m).
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 16px",
            background: "var(--bg-void)",
            borderTop: "1px solid rgba(255, 255, 255, 0.1)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button onClick={onClose} className="hud-btn" style={{ padding: "5px 12px" }}>
            CLOSE INSPECTOR
          </button>
        </div>
      </div>
    </div>
  );
};
