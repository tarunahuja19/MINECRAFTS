import React from "react";

/**
 * Small shared UI primitives.
 *
 * This file used to hold desktop-style MENU primitives — MenuButton,
 * MenuItem, MenuLabel, MenuSep — which drove the top bar's Interventions,
 * View and Data dropdowns. Those menus are gone: the interventions and view
 * settings live in the right-hand inspector next to the readings they act
 * on, the exports live in the footer, and the top bar is run controls and
 * status only. Nothing opened a menu any more, so the primitives that
 * existed to build one were deleted with them.
 *
 * What is left is the two controls that outlived the menus and are used
 * throughout the inspector: a joined single-choice `Segmented`, and `Field`
 * for a labelled read-only value.
 */


/**
 * Joined single-choice control, as in the reference's AERIAL|TACTICAL and
 * SPLIT|ALARM DETAIL|NODE SENSORS. One lit segment, shared borders, square.
 * Replaces four different "this one is selected" treatments used elsewhere.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string; sub?: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          disabled={disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`segmented-item ${value === o.value ? "segmented-item-on" : ""}`}
        >
          <span>{o.label}</span>
          {o.sub && <span className="segmented-sub">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The reference's core readout: a small muted uppercase label with the value
 * on its own line beneath, left-aligned. Replaces the label-left/value-right
 * rows this panel used, which forced both halves to compete for one line and
 * made a column of readings impossible to scan.
 */
export const Field: React.FC<{
  label: string;
  value: React.ReactNode;
  color?: string;
  mono?: boolean;
}> = ({ label, value, color, mono = true }) => (
  <div className="field">
    <div className="field-label">{label}</div>
    <div
      className="field-value"
      style={{ color: color ?? "var(--text-primary)", fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)" }}
    >
      {value}
    </div>
  </div>
);
