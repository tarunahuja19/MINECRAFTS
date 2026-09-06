import React, { useState } from "react";
import { Calculator, Pause, Play, RotateCcw } from "lucide-react";
import type { SegmentState, ZoneTelemetry } from "../types";
import { InfoModal, type InfoItem } from "./InfoModal";
import { SPEED_INFO } from "../interventions";

/**
 * The application's entire top chrome, in one 34px bar.
 *
 * WHAT THIS REPLACES AND WHY
 * ---------------------------------------------------------------------
 * `OfficeRibbon` was a five-tab CAD ribbon: a titlebar, a tab strip, and a
 * 78px toolbar of bordered groups, each group captioned underneath
 * ("EXECUTION", "TIME BASE", "PARAMETERS", "SURFACE SHADING MODE"). Three
 * stacked strips of chrome, ~140px, before any of the mine was drawn.
 *
 * It also showed every control the app has, permanently. A ribbon tab is a
 * commitment to filling a wide toolbar, so controls that are set once and
 * left alone — vertical scale, camera presets, CSV exports — occupied the
 * same prominence as START. That is the clutter: not any single control,
 * but the absence of any ranking between them.
 *
 * This bar carries run controls and status only — the things that are used
 * constantly or must be readable at a glance: START/PAUSE, RESET, the
 * clock, connection state, DGMS state. Everything that is set once and left
 * alone (camera presets, shading, scale) lives in the right-hand inspector
 * panel instead, and the CSV exports live on the drawer that shows the very
 * rows they download — so none of it competes with the controls that matter
 * every second the simulation runs.
 *
 * FORMULAS sits here because the 34px footer that used to hold it was
 * otherwise entirely duplicated chrome: its connection dot, node count and
 * `t = +X d` all appear in this bar or the drawer already, and both its CSV
 * buttons are on the drawer. One unique control did not justify a permanent
 * strip across the window, so the strip went and the control moved.
 */

interface MenuBarProps {
  isConnected: boolean;
  isRunning: boolean;
  tDays: number;
  zones: ZoneTelemetry[];
  latestPacketId?: number | null;
  onStart: () => void;
  onPause: () => void;
  onFullMasterReset: () => void;
  onOpenMathsModal: () => void;
}

/**
 * Master switch for the full-bleed DGMS evacuation bar.
 *
 * The bar is deliberately kept in this file rather than deleted: it is the
 * one loud element the UI has, and it is wanted back the moment this
 * display is used for an actual advisory. It is off because this build is
 * driven as a demonstration, where a CRITICAL/FAILED zone is the expected
 * outcome of the operator's own intervention rather than news — a
 * full-width pulsing red bar on every triggered collapse is noise, and it
 * shifts the whole viewport down by 30px each time it appears.
 *
 * Flip to `true` to restore it. Nothing else needs changing: `hasAlert`
 * still computes the real breach state, and the inline "DGMS TENSION /
 * NORMAL" readout below still reports it.
 */
const SHOW_EVACUATION_ALARM_BAR = false;

export const MenuBar: React.FC<MenuBarProps> = ({
  isConnected,
  isRunning,
  tDays,
  zones,
  latestPacketId,
  onStart,
  onPause,
  onFullMasterReset,
  onOpenMathsModal,
}) => {
  const [activeInfo, setActiveInfo] = useState<InfoItem | null>(null);

  const counts: Record<SegmentState, number> = {
    STABLE: 0, SETTLING: 0, TENSION: 0, CRITICAL: 0, FAILED: 0,
  };
  for (const z of zones) if (counts[z.state] !== undefined) counts[z.state]++;
  const hasBreach = counts.CRITICAL > 0 || counts.FAILED > 0;
  const hasAlert = SHOW_EVACUATION_ALARM_BAR && hasBreach;
  const hasWarning = counts.TENSION > 0;

  // Worst-first, so the bar names the zones that matter rather than the
  // first three the array happens to hold.
  const breachedZones = zones
    .filter((z) => z.state === "FAILED" || z.state === "CRITICAL")
    .sort((a, b) => (a.state === "FAILED" ? 0 : 1) - (b.state === "FAILED" ? 0 : 1))
    .slice(0, 3)
    .map((z) => z.id);

  const info = (item: InfoItem) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveInfo(item);
  };

  return (
    <>
      {/* ALARM BAR — the one loud element, present only on a real breach. */}
      {hasAlert && (
        <div className="alarm-bar">
          <span className="alarm-chip">DGMS EVACUATION ADVISORY</span>
          <span>
            {counts.FAILED > 0 && `${counts.FAILED} FAILED`}
            {counts.FAILED > 0 && counts.CRITICAL > 0 && " · "}
            {counts.CRITICAL > 0 && `${counts.CRITICAL} CRITICAL`}
          </span>
          {breachedZones.length > 0 && (
            <span style={{ opacity: 0.85 }}>{breachedZones.join(", ")}</span>
          )}
        </div>
      )}

      <div className="menu-bar">
        {/* ---- Run controls. The only always-visible actions. ---- */}
        <button
          onClick={isRunning ? onPause : onStart}
          className="bar-item"
          style={{ color: isRunning ? "var(--state-warning)" : "var(--state-active)" }}
        >
          {isRunning ? <Pause size={12} /> : <Play size={12} />}
          <span>{isRunning ? "Pause" : "Start"}</span>
        </button>

        <button onClick={onFullMasterReset} className="bar-item">
          <RotateCcw size={12} />
          <span>Reset</span>
        </button>

        <div className="bar-sep" />

        {/* ---- Right-aligned status. Read, never clicked. ---- */}
        <div style={{ flex: 1 }} />

        <div className="bar-status">
          <span
            className="status-dot"
            style={{ background: isConnected ? "var(--state-active)" : "var(--state-critical)" }}
          />
          <span>{isConnected ? "ONLINE" : "OFFLINE"}</span>
        </div>

        <div className="bar-sep" />

        <button className="bar-item" onClick={info(SPEED_INFO)} title="Fixed 10x time base">
          <span style={{ color: "var(--text-muted)" }}>10×</span>
        </button>

        <div className="bar-status" style={{ color: "var(--text-primary)" }}>
          t = +{tDays.toFixed(2)} d
        </div>

        {latestPacketId !== undefined && latestPacketId !== null && (
          <>
            <div className="bar-sep" />
            <div
              className="bar-status"
              style={{ color: "var(--state-info-alt)", fontWeight: 500 }}
              title="Latest 60-second synchronized simulation packet"
            >
              PKT #{latestPacketId}
            </div>
          </>
        )}

        <div className="bar-sep" />
        <div
          className="bar-status"
          style={{
            color: hasBreach
              ? "var(--state-critical)"
              : hasWarning
                ? "var(--state-warning)"
                : "var(--state-active)",
          }}
        >
          DGMS {hasBreach ? "BREACH" : hasWarning ? "TENSION" : "NORMAL"}
        </div>

        <div className="bar-sep" />

        <button
          className="bar-item"
          onClick={onOpenMathsModal}
          title="View Knothe, Bals, Aviershin, and Hall closed-form formulas"
        >
          <Calculator size={12} />
          <span>Formulas</span>
        </button>
      </div>

      <InfoModal item={activeInfo} onClose={() => setActiveInfo(null)} />
    </>
  );
};
