import React from "react";
import { Info, X } from "lucide-react";

/**
 * One explanation card, shown when the operator clicks an ℹ badge.
 *
 * `whatYouWillSee` is the field that matters most and the one the UI used to
 * be missing: a formula tells you what the model computes, but not what is
 * about to happen on your screen. Every intervention now answers that.
 */
export interface InfoItem {
  title: string;
  category: string;
  purpose: string;
  /** Plain-language description of the visible on-screen consequence. */
  whatYouWillSee?: string;
  formula?: string;
  dgmsStandard?: string;
  units?: string;
}

/**
 * The small circular ℹ badge that sits on a control.
 *
 * It stops propagation so clicking the badge explains the control instead of
 * firing it — the ribbon relied on that behaviour inline, and the inspector
 * panel had no badges at all until this was shared.
 */
export const InfoBadge: React.FC<{
  item: InfoItem;
  onOpen: (item: InfoItem) => void;
  className?: string;
}> = ({ item, onOpen, className = "simmine-info-icon" }) => (
  <div
    className={className}
    role="button"
    tabIndex={0}
    aria-label={`What does ${item.title} do?`}
    onClick={(e) => {
      e.stopPropagation();
      onOpen(item);
    }}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.stopPropagation();
        e.preventDefault();
        onOpen(item);
      }
    }}
  >
    ℹ
  </div>
);

/** Shared explanation dialog. Renders nothing when `item` is null. */
export const InfoModal: React.FC<{
  item: InfoItem | null;
  onClose: () => void;
}> = ({ item, onClose }) => {
  if (!item) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "460px",
          maxHeight: "82vh",
          overflowY: "auto",
          background: "var(--bg-raised)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          padding: "16px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
          fontFamily: "var(--font-mono)",
          color: "var(--text-primary)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Info size={16} color="var(--state-info)" />
            <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--state-info)" }}>{item.title}</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ fontSize: "var(--fs-label)", color: "var(--text-secondary)", marginBottom: "8px" }}>
          CATEGORY: <strong style={{ color: "var(--text-primary)" }}>{item.category}</strong>
        </div>

        <div
          style={{
            background: "rgba(0,0,0,0.3)",
            padding: "8px",
            borderRadius: "5px",
            marginBottom: "8px",
            fontSize: "var(--fs-body)",
            color: "var(--text-primary)",
            lineHeight: 1.5,
          }}
        >
          {item.purpose}
        </div>

        {item.whatYouWillSee && (
          <div style={{ marginBottom: "8px" }}>
            <div style={{ fontSize: "var(--fs-label)", color: "var(--state-active)", fontWeight: 800 }}>WHAT YOU WILL SEE:</div>
            <div
              style={{
                fontSize: "var(--fs-body)",
                color: "var(--state-active)",
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.25)",
                borderRadius: "4px",
                padding: "6px 8px",
                marginTop: "3px",
                lineHeight: 1.5,
              }}
            >
              {item.whatYouWillSee}
            </div>
          </div>
        )}

        {item.formula && (
          <div style={{ marginBottom: "8px" }}>
            <div style={{ fontSize: "var(--fs-label)", color: "var(--state-info-alt)", fontWeight: 800 }}>GOVERNING FORMULATION:</div>
            <code
              style={{
                fontSize: "var(--fs-label)",
                color: "var(--state-info-alt)",
                background: "rgba(0,0,0,0.4)",
                padding: "4px",
                display: "block",
                borderRadius: "4px",
              }}
            >
              {item.formula}
            </code>
          </div>
        )}

        {item.dgmsStandard && (
          <div style={{ marginBottom: "8px" }}>
            <div style={{ fontSize: "var(--fs-label)", color: "var(--state-warning)", fontWeight: 800 }}>DGMS SAFETY STANDARD:</div>
            <div style={{ fontSize: "var(--fs-label)", color: "var(--state-warning)" }}>{item.dgmsStandard}</div>
          </div>
        )}

        {item.units && (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-secondary)" }}>
            ENGINEERING UNITS: <strong style={{ color: "var(--text-primary)" }}>{item.units}</strong>
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            marginTop: "12px",
            width: "100%",
            background: "var(--bg-raised)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
            padding: "6px",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--fs-body)",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          GOT IT
        </button>
      </div>
    </div>
  );
};
