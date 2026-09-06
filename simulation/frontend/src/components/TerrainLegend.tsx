import React, { useState } from "react";
import { HEIGHT_STOPS, RAMP_FLOOR, DEPTH_STOPS } from "../utils/hypsometry";
import { CUMULATIVE_DEPTH_MAX_M } from "../utils/geomechanicsEngine";
import { SUBSIDENCE_SHADOW, CONTOUR_INTERVAL_M } from "./TerrainMesh";

/**
 * Explains what the viewport's colours mean.
 *
 * One fused scale is painted onto the mesh: a height ramp everywhere, with a
 * depth ramp overlaid once the ground has moved. Without this, a violet patch
 * is ambiguous between "the bowl is deepening" and some other signal
 * entirely.
 */

interface TerrainLegendProps {
  /** Panel elevation extremes, m AMSL, from the server's DEM metadata. */
  elevMinM?: number;
  elevMaxM?: number;
}

const PANEL: React.CSSProperties = {
  position: "absolute",
  right: 12,
  bottom: 52,
  zIndex: 5,
  background: "var(--bg-panel)",
  border: "1px solid var(--border-color)",
  borderRadius: 2,
  padding: "6px 8px",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 10,
  color: "var(--text-primary)",
  minWidth: 168,
  // Capped so an expanded legend annotates the scene instead of replacing it.
  maxWidth: 340,
  maxHeight: "46vh",
  overflowY: "auto",
};

const TITLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.09em",
  color: "var(--text-secondary)",
  marginBottom: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  cursor: "pointer",
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Continuous bar built from the same stops the mesh shader interpolates. */
function RampBar({
  stops,
  from = 0,
  to = 1,
  shadow = false,
}: {
  stops: [number, string][];
  from?: number;
  to?: number;
  /** Apply the same excavation shadow TerrainMesh multiplies onto the depth
   *  ramp, so this bar shows the colour actually painted on the terrain
   *  rather than the brighter raw stop. Depth-only: HEIGHT_STOPS is never
   *  shadowed on the mesh, so it must not be shadowed here either. */
  shadow?: boolean;
}) {
  const span = to - from || 1;
  const css = stops
    .filter(([t]) => t >= from - 1e-9 && t <= to + 1e-9)
    .map(([t, c]) => {
      let color = c;
      if (shadow) {
        const [r, g, b] = hexToRgb(c);
        const k = 1 - SUBSIDENCE_SHADOW * (1 - t);
        color = rgbToHex(r * k, g * k, b * k);
      }
      return `${color} ${(((t - from) / span) * 100).toFixed(1)}%`;
    })
    .join(", ");
  return (
    <div
      style={{
        height: 9,
        borderRadius: 2,
        background: `linear-gradient(to right, ${css})`,
        border: "1px solid rgba(255,255,255,0.16)",
      }}
    />
  );
}

export const TerrainLegend: React.FC<TerrainLegendProps> = ({
  elevMinM,
  elevMaxM,
}) => {
  // Open by default. The depth scale needs to be readable at a glance —
  // a collapsed panel means the operator can't decode a colour on the bowl
  // without an extra click first, which defeats the point of the legend
  // existing at all. Still collapsible for when the scene needs the room.
  const [open, setOpen] = useState(true);

  const hasElev = elevMinM !== undefined && elevMaxM !== undefined;
  const mid = hasElev ? (elevMinM! + elevMaxM!) / 2 : undefined;

  const title = "TERRAIN: HEIGHT / DEPTH";

  return (
    <div style={PANEL}>
      <div style={TITLE} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span style={{ color: "var(--text-muted)" }}>{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <>
          {/* The mesh ramps from RAMP_FLOOR, not 0 — the panel is entirely
              above sea level, so the ramp's ocean end is never used. */}
          <RampBar stops={HEIGHT_STOPS} from={RAMP_FLOOR} to={1} />
          <div style={{ display: "flex", justifyContent: "space-between", color: "#a3a4a6", marginTop: 3 }}>
            <span>{hasElev ? `${elevMinM!.toFixed(0)} m` : "low"}</span>
            <span>{mid !== undefined ? `${mid.toFixed(0)} m` : ""}</span>
            <span>{hasElev ? `${elevMaxM!.toFixed(0)} m` : "high"}</span>
          </div>
          <div style={{ color: "#7c7d80", fontSize: 8.5, marginTop: 4, lineHeight: 1.35 }}>
            Equal-area ranked (each colour band covers equal ground area),
            shaded by Horn (1981) hillshade. m AMSL.
          </div>

          {/* Ground that has MOVED is drawn on a second, separate scale,
              overlaid once a bowl forms — otherwise a colour is ambiguous
              between "high ridge" and "deep bowl". */}
          <div style={{ marginTop: 7, fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: "#a3a4a6" }}>
            DEPTH vs ORIGINAL GROUND
          </div>
          <div style={{ marginTop: 4 }}>
            <RampBar stops={DEPTH_STOPS} shadow />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#a3a4a6", marginTop: 3 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
              <span key={frac}>{(frac * CUMULATIVE_DEPTH_MAX_M).toFixed(0)} m</span>
            ))}
          </div>
          <div style={{ color: "#7c7d80", fontSize: 8.5, marginTop: 4, lineHeight: 1.35 }}>
            How far the ground has carved in below where it started, not its
            height above sea level. Blue = just moved, red ={" "}
            {CUMULATIVE_DEPTH_MAX_M.toFixed(0)} m down. Carve-in is a fraction
            of this panel's {(
              (elevMaxM ?? 370) - (elevMinM ?? 196)
            ).toFixed(0)} m relief, so it needs its own scale to be visible at
            all. Dark rings are depth contours every{" "}
            {CONTOUR_INTERVAL_M.toFixed(0)} m — closely spaced rings mean a
            steep flank, wide spacing means a flat floor.
          </div>
        </>
      )}
    </div>
  );
};
