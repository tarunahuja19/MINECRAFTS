/**
 * Single source of truth for the ground-intervention controls: how fast a
 * triggered event plays out, and what each control actually does.
 *
 * Both the ribbon (OfficeRibbon) and the docked inspector (RightInspectorPanel)
 * trigger the same interventions. They previously carried separate, drifting
 * copies of the explanations — and the inspector carried none at all — so the
 * text lives here and both read it.
 */

import type { PhysicalEventType } from "./types";
import type { InfoItem } from "./components/InfoModal";

// ---------------------------------------------------------------------------
// Simulation speed
// ---------------------------------------------------------------------------

/**
 * Fixed simulation speed: 1 real second = 10 simulated seconds.
 *
 * This used to be operator-selectable (1x / 10x / 500x / 2000x), but a
 * multiplier that silently rescales every duration on screen is very hard to
 * reason about — at 2000x a "4.8 hour" collapse was over in 9 seconds, so the
 * labels and the wall clock disagreed with each other. Fixing the speed means
 * one real second always means the same thing, and the only timing control
 * left is the intervention pace below, which says what it does in plain words.
 */
export const FIXED_SPEED_MULTIPLIER = 10.0;

/** Explanation for the speed readout. */
export const SPEED_INFO: InfoItem = {
  title: "Simulation Speed: fixed 10×",
  category: "Time Base",
  purpose:
    "The simulation clock runs 10× faster than real time: one second you wait " +
    "is ten seconds underground. A full 30-day subsidence campaign therefore " +
    "takes about 3.5 days of continuous running, and the mine's slow regional " +
    "settlement (Knothe c = 0.04/day, ~25 days to settle) is far too slow to " +
    "watch directly — which is exactly why interventions are triggered by hand.",
  whatYouWillSee:
    "The t = +N d clock in the title bar advances 10× faster than your own " +
    "watch. Nothing else changes. This is deliberately not adjustable: it used " +
    "to be switchable up to 2000×, which made every duration on screen mean " +
    "something different depending on a setting most people never noticed.",
  formula: "t_sim = t_real × 10",
  units: "1 real second = 10 simulated seconds",
};

// ---------------------------------------------------------------------------
// Intervention pace
// ---------------------------------------------------------------------------

/**
 * How long a cave-in takes to play out at 1x, in real seconds.
 *
 * Sixty seconds is the baseline because a collapse that snaps to its final
 * state gives the monitoring system nothing to observe: the zones jump
 * straight to FAILED, the strain precursors a predictor keys on exist for a
 * single tick or not at all, and an operator watching the screen sees a
 * result rather than an event. The whole value of the warning window is that
 * something *happens during* it.
 *
 * Sixty seconds is long enough that the sequence reads as a progression --
 * yielding, then the roof going -- the way a video does rather than a cut,
 * and long enough for the downstream predictor to accumulate a real run of
 * telemetry from the node field while the ground is still moving.
 */
export const EVENT_PACE_REAL_SECONDS = 60.0;

/**
 * Event speed multipliers: how much FASTER than the 1x baseline an event runs.
 *
 * A multiplier divides the wall-clock wait, so 1x is the full 60 s, 5x is
 * 12 s and 10x is 6 s. It compresses only the pacing — magnitudes, geometry
 * and strains are unchanged, so the same event is being watched either way,
 * just at a different playback rate.
 *
 * Only one event may be in flight at a time (see `eventInFlight` in App.tsx).
 * Changing the rate mid-event would rescale a collapse the server has already
 * been told the duration of, so the control is locked while one is running.
 */
export const SPEED_MULTIPLIERS = [1, 5, 10] as const;

export type SpeedMultiplier = (typeof SPEED_MULTIPLIERS)[number];

/** Default event speed: real time, the pace the physics notes are written for. */
export const DEFAULT_SPEED_MULTIPLIER: SpeedMultiplier = 1;

export interface PacePreset {
  label: string;
  /** Real seconds the operator waits for the whole event to finish. */
  realSecondsToWatch: number;
  /** Sim-hours of pre-collapse yielding (the DGMS warning window). */
  warningHours: number;
  /** Sim-hours the roof takes to drop. */
  durationHours: number;
}

/**
 * Convert "seconds the operator waits" into the sim-hours the server needs.
 *
 * The server advances sim-time at FIXED_SPEED_MULTIPLIER, so a duration
 * expressed in sim-hours takes `hours * 3600 / speed` real seconds to play
 * out. Deriving the preset through this function rather than hand-typing
 * sim-hours is what keeps the advertised wait honest: hand-picked values of
 * 1.25 h / 2.5 h looked reasonable but actually took 22 real minutes.
 *
 * The split is one third yielding, two thirds collapse, so the warning window
 * is always a visible fraction of the event rather than a fixed epsilon.
 * `warningHours` must stay strictly positive: PillarFailure.__post_init__
 * (sandbox/collapse.py) rejects t_collapse <= t_init, the invariant that
 * guarantees a zone goes CRITICAL before FAILED (Gate T50).
 */
function paceHours(realSeconds: number): { warningHours: number; durationHours: number } {
  const totalSimHours = (realSeconds * FIXED_SPEED_MULTIPLIER) / 3600.0;
  return {
    warningHours: totalSimHours / 3.0,
    durationHours: (totalSimHours * 2.0) / 3.0,
  };
}

/**
 * The pace an intervention runs at, for a given speed multiplier.
 *
 * The magnitudes, geometry and strains are all true physical values; it is
 * only the wall-clock pacing that is compressed. A real rapid roof fall takes
 * roughly 4.8 hours underground.
 */
export function eventPace(speed: SpeedMultiplier): PacePreset {
  const realSeconds = EVENT_PACE_REAL_SECONDS / speed;
  return {
    label: `${speed}x`,
    realSecondsToWatch: realSeconds,
    ...paceHours(realSeconds),
  };
}

/** Explanation for the pace, shown beside the intervention controls. */
export const PACE_INFO: InfoItem = {
  title: "Event Speed: 1x / 5x / 10x",
  category: "Event Timing",
  purpose:
    "Every triggered intervention plays out over about 60 real seconds at 1x " +
    "instead of snapping to its final state. A failure has two phases: a " +
    "yielding phase where the pillar cracks and strain climbs but the ground " +
    "has barely moved, then the collapse itself where the roof drops. Both " +
    "are stretched across the event so each is actually observable. 5x and " +
    "10x compress that same event into 12 s and 6 s when you do not want to " +
    "wait through it.",
  whatYouWillSee:
    "The bowl deepens gradually rather than appearing at once, and the " +
    "affected zones step through SETTLING → TENSION → CRITICAL before they " +
    "read FAILED. That warning window is the whole point: it is what a real " +
    "monitoring system would be giving you to evacuate on, and what a " +
    "predictor has to work with while the ground is still moving. At 10x the " +
    "same sequence happens, just six times faster. Only one event runs at a " +
    "time — the controls lock while one is in flight, because two overlapping " +
    "events would each be solving against a surface the other is still moving.",
  formula: "S(t) = S_max · ½(1 − cos(π · t / duration))   [raised cosine]",
  dgmsStandard:
    "Gate T50: a zone must always be observed CRITICAL before FAILED. Every " +
    "speed keeps that transition intact; 1x gives it the widest window.",
  units: "1x = 60 real seconds · 5x = 12 s · 10x = 6 s",
};

/** Human-readable timing line, used in captions and toasts. */
export function paceTimingSummary(speed: SpeedMultiplier): string {
  return `~${(EVENT_PACE_REAL_SECONDS / speed).toFixed(0)}s`;
}

// ---------------------------------------------------------------------------
// What each intervention does
// ---------------------------------------------------------------------------

/**
 * Explanations for every intervention button, keyed by the event they fire.
 *
 * Each one answers the question the old tooltips did not: what changes on
 * screen when I press this, and how is it different from the button next to it.
 */
export const INTERVENTION_INFO: Record<PhysicalEventType, InfoItem> = {
  collapse: {
    title: "Void Roof Cave-In",
    category: "Dynamic Collapse",
    purpose:
      "The headline event. The roof over a mined-out void shears and falls, " +
      "and the ground above sinks into a bowl centred on your target. This is " +
      "the intervention the other ground events are variations of.",
    whatYouWillSee:
      "A circular dip opens at the target marker and deepens to the severity " +
      "you set. The terrain recolours as it drops, sensor nodes inside the " +
      "bowl start reporting subsidence in mm, and the zones around the rim go " +
      "TENSION then CRITICAL as the ground there is stretched. The steepest " +
      "ground is on the rim, not at the centre — the middle drops almost flat.",
    formula: "S(r) = ΔZ · exp(−r² / 2R²)   ·   ½(1 − cos(π t / duration))",
    dgmsStandard: "Gate T50: the zone visits CRITICAL before FAILED, giving a warning window.",
    units: "Drop ΔZ in metres, capped at 5 m for a single event; repeated events deepen the same hole to 50 m",
  },
  tilt: {
    title: "Surface Tilt / Shear",
    category: "Slope Rotation",
    purpose:
      "Tilt is the ground's gradient, dS/dx, so it is steepest on the FLANK of " +
      "a bowl and near zero at the bottom. To put maximum tilt on your target " +
      "this deliberately fires the collapse off to one side, so the target " +
      "sits on the slope rather than in the middle.",
    whatYouWillSee:
      "The bowl appears offset from your marker by its own radius — that is " +
      "intentional, not a targeting error. The target ends up on the steep " +
      "flank, where tilt readings are highest. Structures care about tilt far " +
      "more than depth: uniform settlement is survivable, differential is not.",
    formula: "i = −∂S/∂x,  θ = arctan(i)",
    dgmsStandard: "Max allowable surface tilt: 15.0 mm/m",
    units: "mm/m, or µrad",
  },
  vibration: {
    title: "Blast Shockwave",
    category: "Seismic PPV Transient",
    purpose:
      "A production blast. This is the one intervention that does NOT subside " +
      "the ground: it is a transient elastic wave that shakes the surface and " +
      "then passes, leaving the terrain exactly where it was.",
    whatYouWillSee:
      "A ripple crosses the terrain and the seismograph trace in the telemetry " +
      "drawer kicks hard, then decays over about a minute. Watch the " +
      "subsidence readings while it happens — they do not change. That is the " +
      "point: shaking is not sinking, and the model keeps the two separate.",
    formula: "Gate T54 invariant: static displacement ΔZ = 0 mm during vibration.",
    dgmsStandard: "DGMS blast vibration threshold: 10–25 mm/s PPV. This fires at 35 mm/s.",
    units: "Peak Particle Velocity, mm/s",
  },
  stress: {
    title: "Stress Extraction",
    category: "Continuous Mining",
    purpose: "Advances the longwall extraction face draw along the panel axis.",
    whatYouWillSee: "",
    formula: "w(t) = 1 − exp(−c · t), c = 0.040/d",
  },
};
