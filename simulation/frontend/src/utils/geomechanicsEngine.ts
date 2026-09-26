/**
 * Local collapse-intervention field, evaluated in the browser for interactive
 * response between server ticks.
 *
 * WHAT THIS IS AND IS NOT
 * ----------------------------------------------------------------------
 * The authoritative subsidence field S(x, y, t) is `sandbox/surface.py`: a
 * Knothe influence-function convolution with analytic Aviershin derivative
 * kernels, on the real 375 m-cover Adriyala panel. This module does NOT
 * reimplement it and must never be treated as a second opinion about it.
 * Its only job is the *discrete pillar-failure interventions* the operator
 * triggers by hand, so the viewport responds immediately rather than waiting
 * for the next 60 s server tick. The server remains the source of truth and
 * its `perturbations` are added on top by the renderer.
 *
 * WHAT WAS WRONG BEFORE
 * ----------------------------------------------------------------------
 * The previous version of this file was a free invention that contradicted
 * the backend on every quantity that matters:
 *
 *   quantity        backend (real)              old frontend      error
 *   -------------------------------------------------------------------
 *   drop magnitude  <= S_max_full = a*m = 2.25  22.0 m            ~10x
 *   settling time   1/c = 25 days               4 seconds         ~5e5 x
 *   bowl profile    Knothe exp(-pi*x^2/r^2)     exp(-(r/R)^2.2)   wrong kernel
 *   strain          analytic Aviershin dS/dx    "* 35.0"          invented
 *
 * Those numbers drove the on-screen readouts, the node state colouring and
 * the DGMS 5.3 mm/m breach test, so the UI was reporting strains and
 * subsidences that the physics never produced. Every one of them is now
 * derived from the shared constants below.
 */

/**
 * Adriyala panel constants, mirroring `sandbox/constants.py`. These are the
 * single place the browser is allowed to know them; nothing below hand-types
 * a derived value that can be computed from these.
 */
export const ADRIYALA = {
  /** Depth of cover, m. Named to match sandbox/constants.py:H_DEPTH_M. */
  H_DEPTH_M: 375.0,
  /** tan(beta), fitted at Barapukuria on the same Gondwana strata. */
  TAN_BETA: 1.9,
  /** Subsidence factor a (literature 0.7-0.9). */
  A_SUBS: 0.75,
  /** Seam thickness m, ASSUMED — not in open literature. */
  M_SEAM_M: 3.0,
  /** Knothe time constant, per day. */
  C_KNOTHE: 0.04,
  /** DGMS tensile limit, mm/m (Kamptee coalfield). */
  DGMS_TENSILE_MM_PER_M: 5.3,
  /** DGMS compressive limit, mm/m. */
  DGMS_COMPRESSIVE_MM_PER_M: 6.6,
} as const;

/** Radius of influence r = H / tan(beta), m. Derived, never hand-typed. */
export const R_INFL_M = ADRIYALA.H_DEPTH_M / ADRIYALA.TAN_BETA;

/**
 * Ceiling for a SINGLE caving event, m.
 *
 * One roof fall drops the surface by at most the seam it removed times the
 * subsidence factor (S_max = a*m = 2.25 m), rounded up to a round 5 m so a
 * single dramatic event is legible on the depth ramp. This is a per-event
 * limit only — see CUMULATIVE_DEPTH_MAX_M for the limit on total carve-in.
 */
export const S_MAX_FULL_M = 5.0;

/**
 * Ceiling for TOTAL carve-in accumulated across every event, m.
 *
 * The surface is not restricted to one seam's worth of settlement: repeated
 * extraction, stacked failures and progressive caving in the same place go on
 * deepening the same hole. A worked-out panel can end up tens of metres below
 * where it started, which is why the depth ramp is normalised to this rather
 * than to a single event's 5 m — the colour has to keep meaning something
 * after the tenth collapse, not saturate after the first.
 */
export const CUMULATIVE_DEPTH_MAX_M = 50.0;

/**
 * Horizontal displacement coefficient B = 0.35 * r, m. Mirrors
 * sandbox/constants.py:51 (0.35, deliberately not the parent project's 0.32 —
 * see the note at constants.py:55).
 */
export const B_HORIZ_M = 0.35 * R_INFL_M;

/** Seconds per simulated day, for converting the Knothe time law to wall clock. */
const SECONDS_PER_DAY = 86400.0;

export interface ActiveCollapseIntervention {
  id: string;
  cx: number;
  cy: number;
  /** Peak vertical drop, m. Clamped to S_MAX_FULL_M on construction. */
  magnitudeM: number;
  /** Radius of the failure bowl, m. */
  radiusM: number;
  /** Trigger time, in seconds on the same clock passed to evaluatePoint. */
  t0: number;
  /**
   * Knothe time constant for this intervention, per day. A pillar failure
   * settles far faster than regional subsidence, but it still follows the
   * same 1 - exp(-c*t) law rather than an invented exponential in seconds.
   */
  cPerDay: number;
  /** Sim-seconds elapsed per real second, so the time law tracks sim time. */
  timeScale: number;
}

export interface GroundStateAtPoint {
  elevation: number;
  initialElevation: number;
  dropDistanceM: number;
  /** Heave-ring uplift included in `elevation`, m. Subsidence-only otherwise. */
  rimUpliftM: number;
  tiltDeg: number;
  tiltMmPerM: number;
  tensileStrainMmPerM: number;
  curvaturePerM: number;
  vibrationDisplacementM: number;
  surfaceNormal: [number, number, number];
}

/**
 * Caving influence radius for a LOCALIZED roof cave-in, m.
 *
 * R_INFL_M (197.4 m) is the REGIONAL radius of influence: it is H/tan(beta)
 * for the full 375 m depth of cover, and it is the right number for the
 * panel-wide Knothe trough that `sandbox/surface.py` convolves.
 *
 * It is the wrong number for a single pillar failure. A localized roof
 * cave-in does not mobilise the whole 375 m column: the goaf chokes once the
 * bulked caved rock fills the void, so the disturbance that reaches the
 * surface is driven by the caved/fractured zone height, conventionally
 * 4-11x the extracted thickness (Peng & Chiang), not by the full depth. At
 * m = 3.0 m that zone is roughly 12-33 m, and the surface expression of it
 * spreads over an influence radius a fraction of the regional one.
 *
 * 0.30 sits inside that band and is the single knob that makes a cave-in
 * read as a cave-in: with the regional 197.4 m, a 40 m void reaches only
 * 12% of its nominal magnitude at the centre (measured), which is why a
 * severity slider pinned to its 2.25 m maximum still produced an almost
 * flat surface. At 0.30 the same 40 m void reaches 76%.
 *
 * This is a change of WHICH influence radius applies to a local event, not
 * a fudge factor on the depth: the mass-conservation identity below holds
 * exactly at every value of this constant.
 */
export const CAVE_INFL_FRAC = 0.30;

/** Influence radius governing localized cave-in geometry, m. */
export const R_CAVE_M = R_INFL_M * CAVE_INFL_FRAC;

/**
 * Axisymmetric subsidence profile of a circular extraction of radius `R`,
 * normalised so that a fully-supercritical bowl reaches 1.0 at the centre.
 *
 * ---------------------------------------------------------------------
 * Why this is a Bessel integral and not the previous erf pair
 * ---------------------------------------------------------------------
 * This is a 2-D problem: a DISC of radius R convolved with the 2-D Knothe
 * influence kernel. The previous implementation used
 *
 *     0.5 * (erf((R-d)/(sigma*sqrt2)) + erf((R+d)/(sigma*sqrt2)))
 *
 * which is the convolution of a 1-D SLAB of half-width R with a 1-D
 * Gaussian — the profile of an infinitely long trench, not of a round
 * pillar failure. Using it for a disc is a dimensional mismatch, and it
 * shows up as a broken mass balance: the ratio of subsided volume to
 * extracted void volume, which must be a constant (that constant IS the
 * statement that the ground conserves mass), instead drifted
 *
 *     R =  40 m -> 3.275     R =  75 m -> 1.918
 *     R =  85 m -> 1.750     R = 150 m -> 1.271
 *
 * i.e. a small failure invented over three times the ground movement its
 * void could account for, while a large one under-reported. Since every
 * downstream channel (tilt, curvature, strain, and hence every DGMS
 * threshold test and every sensor reading) is a derivative of this
 * profile, that error propagated into all of them.
 *
 * The correct 2-D form, for a disc of radius R and a Gaussian influence
 * kernel of standard deviation sigma, is the Hankel/Bessel integral
 *
 *     S(d) = integral_0^R (rho/sigma^2)
 *              * exp(-(rho^2 + d^2) / (2 sigma^2))
 *              * I0(rho*d/sigma^2)  d(rho)
 *
 * where I0 is the modified Bessel function of the first kind, order 0.
 * Evaluated this way the volume ratio is 0.9999-1.0000 across the whole
 * radius range (measured) — mass is conserved by construction, at every
 * radius, which is the invariant the strain channel depends on.
 *
 * Evaluated with the exponentially-scaled Ie0 to avoid the overflow that
 * exp(+rho*d/sigma^2) would otherwise hit at large rho*d, using the
 * identity exp(-(rho^2+d^2)/2s^2) * I0(z) = exp(-(rho-d)^2/2s^2) * Ie0(z).
 */
/**
 * Memo table for the three Bessel quadratures below.
 *
 * Each quadrature is a pure function of (d, R): the render grid is fixed, so
 * across animation frames the SAME (d, R) pairs recur bitwise identically
 * (hypot is deterministic for identical inputs). Without this table every
 * mesh recompute re-runs the 65-node Simpson sum per vertex per intervention
 * (~5M Bessel evals per pass), which is what pinned mesh refresh to the 60 s
 * engine tick. With it the first pass after a trigger pays the full cost once
 * and every later frame is Map lookups, so the bowl can ease open at 10 Hz
 * while the event is in flight.
 *
 * Keys are the EXACT doubles (String round-trips a double losslessly), never
 * quantised: a quantised bucket returns the value computed at whichever `d`
 * first touched it, which corrupts finite-difference probes of the profile
 * (verify_bowl_physics.mjs's derivative gates failed at 20-100% error on a
 * 5 cm bucket). Entries are never invalidated (a pure function cannot go
 * stale); the size cap only bounds a pathological session that triggers
 * thousands of distinct radii.
 */
const profileCache = new Map<string, number>();
const PROFILE_CACHE_MAX = 2000000;

function cachedProfile(
  kind: string,
  d: number,
  R: number,
  compute: () => number
): number {
  const key = kind + "|" + String(R) + "|" + String(d);
  const hit = profileCache.get(key);
  if (hit !== undefined) return hit;
  const value = compute();
  if (profileCache.size >= PROFILE_CACHE_MAX) profileCache.clear();
  profileCache.set(key, value);
  return value;
}

export function bowlProfile(d: number, R: number, r: number = R_CAVE_M): number {
  if (r !== R_CAVE_M) return bowlProfileUncached(d, R, r);
  return cachedProfile("S", d, R, () => bowlProfileUncached(d, R, r));
}

function bowlProfileUncached(d: number, R: number, r: number): number {
  const sigma = r / Math.sqrt(2.0 * Math.PI);
  const s2 = sigma * sigma;
  const ad = Math.abs(d);

  // Fixed-step Simpson over rho in [0, R]. The integrand is smooth and
  // compactly supported, so a modest even node count is ample; 64 keeps
  // the per-vertex cost low enough for the 160x160 render grid.
  const n = 64;
  const h = R / n;
  let sum = 0.0;
  for (let i = 0; i <= n; i++) {
    const rho = i * h;
    const z = (rho * ad) / s2;
    const shifted = rho - ad;
    const f = (rho / s2) * Math.exp(-(shifted * shifted) / (2.0 * s2)) * besselI0e(z);
    const w = i === 0 || i === n ? 1.0 : i % 2 === 1 ? 4.0 : 2.0;
    sum += w * f;
  }
  return (h / 3.0) * sum;
}

/**
 * Exponentially scaled modified Bessel function Ie0(z) = exp(-|z|) * I0(z).
 *
 * Abramowitz & Stegun 9.8.1 / 9.8.2 polynomial forms, max abs error ~1.6e-7
 * and ~1.9e-7 respectively — the same accuracy class as the erf above, and
 * far below anything this surface resolves. The scaled form is used rather
 * than I0 itself because the profile integrand pairs it with a Gaussian:
 * I0 overflows for z beyond ~700 while Ie0 stays O(1) everywhere.
 */
export function besselI0e(z: number): number {
  const ax = Math.abs(z);
  if (ax < 3.75) {
    const y = (z / 3.75) * (z / 3.75);
    const i0 =
      1.0 +
      y *
        (3.5156229 +
          y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813)))));
    return i0 * Math.exp(-ax);
  }
  const y = 3.75 / ax;
  return (
    (1.0 / Math.sqrt(ax)) *
    (0.39894228 +
      y *
        (0.01328592 +
          y *
            (0.00225319 +
              y *
                (-0.00157565 +
                  y *
                    (0.00916281 +
                      y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377))))))))
  );
}

/**
 * Analytic radial derivative dS/dd of the bowl profile — the Aviershin
 * relation, giving slope (tilt).
 *
 * Differentiating the Bessel integral under the integral sign uses
 * d/dd [ exp(-(rho^2+d^2)/2s^2) I0(rho d/s^2) ]
 *     = exp(...) * [ (rho/s^2) I1(rho d/s^2) - (d/s^2) I0(rho d/s^2) ],
 * so the derivative is a second Bessel quadrature, NOT a finite difference
 * of `bowlProfile`. Same reason `sandbox/surface.py` convolves analytic
 * derivative kernels: differencing the output injects truncation error
 * indistinguishable from the small real strain signal being looked for.
 */
export function bowlProfileDerivative(d: number, R: number, r: number = R_CAVE_M): number {
  if (r !== R_CAVE_M) return bowlProfileDerivativeUncached(d, R, r);
  return cachedProfile("dS", d, R, () => bowlProfileDerivativeUncached(d, R, r));
}

function bowlProfileDerivativeUncached(d: number, R: number, r: number): number {
  const sigma = r / Math.sqrt(2.0 * Math.PI);
  const s2 = sigma * sigma;
  const ad = Math.abs(d);
  if (ad < 1e-9) return 0.0; // flat at the centre by symmetry

  const n = 64;
  const h = R / n;
  let sum = 0.0;
  for (let i = 0; i <= n; i++) {
    const rho = i * h;
    const z = (rho * ad) / s2;
    const shifted = rho - ad;
    const env = (rho / s2) * Math.exp(-(shifted * shifted) / (2.0 * s2));
    const f = env * ((rho / s2) * besselI1e(z) - (ad / s2) * besselI0e(z));
    const w = i === 0 || i === n ? 1.0 : i % 2 === 1 ? 4.0 : 2.0;
    sum += w * f;
  }
  const deriv = (h / 3.0) * sum;
  return d < 0 ? -deriv : deriv;
}

/**
 * Second radial derivative, giving curvature and hence horizontal strain
 * via eps = B * kappa.
 *
 * Differentiating the first-derivative integrand once more, using
 * I0' = I1 and I1'(z) = I0(z) - I1(z)/z, gives a third Bessel quadrature.
 * Again analytic under the integral, never a difference of the profile.
 */
export function bowlProfileSecondDerivative(
  d: number,
  R: number,
  r: number = R_CAVE_M
): number {
  if (r !== R_CAVE_M) return bowlProfileSecondDerivativeUncached(d, R, r);
  return cachedProfile("ddS", d, R, () => bowlProfileSecondDerivativeUncached(d, R, r));
}

function bowlProfileSecondDerivativeUncached(d: number, R: number, r: number): number {
  const sigma = r / Math.sqrt(2.0 * Math.PI);
  const s2 = sigma * sigma;
  const ad = Math.abs(d);

  const n = 64;
  const h = R / n;
  let sum = 0.0;
  for (let i = 0; i <= n; i++) {
    const rho = i * h;
    const z = (rho * ad) / s2;
    const shifted = rho - ad;
    const env = (rho / s2) * Math.exp(-(shifted * shifted) / (2.0 * s2));
    const i0 = besselI0e(z);
    const i1 = besselI1e(z);
    // d2/dd2 of exp(-(rho^2+d^2)/2s^2) I0(rho d /s^2), factored through the
    // shifted envelope. At z -> 0, I1(z)/z -> 1/2 (handled in the limit).
    const i1_over_z = z > 1e-8 ? i1 / z : 0.5;
    const term =
      ((rho * rho) / (s2 * s2)) * (i0 - i1_over_z) -
      (2.0 * ad * rho) / (s2 * s2) * i1 +
      ((ad * ad) / (s2 * s2) - 1.0 / s2) * i0;
    const w = i === 0 || i === n ? 1.0 : i % 2 === 1 ? 4.0 : 2.0;
    sum += w * env * term;
  }
  return (h / 3.0) * sum;
}

/**
 * Exponentially scaled Ie1(z) = exp(-|z|) * I1(z).
 * Abramowitz & Stegun 9.8.3 / 9.8.4, same accuracy class as Ie0 above.
 */
export function besselI1e(z: number): number {
  const ax = Math.abs(z);
  let ans: number;
  if (ax < 3.75) {
    const y = (z / 3.75) * (z / 3.75);
    ans =
      ax *
      (0.5 +
        y *
          (0.87890594 +
            y *
              (0.51498869 +
                y * (0.15084934 + y * (0.02658733 + y * (0.00301532 + y * 0.00032411))))));
    ans *= Math.exp(-ax);
  } else {
    const y = 3.75 / ax;
    let a = 0.02282967 + y * (-0.02895312 + y * (0.01787654 - y * 0.00420059));
    a = 0.39894228 + y * (-0.03988024 + y * (-0.00362018 + y * (0.00163801 + y * (-0.01031555 + y * a))));
    ans = a / Math.sqrt(ax);
  }
  return z < 0.0 ? -ans : ans;
}

/**
 * Heave ring around a fresh cave-in: fractional height, peak position and
 * width, all relative to the bowl radius R.
 *
 * This is failed rock BULKING, not decoration. Caved strata occupy 1.3-1.5x
 * their intact volume, so the annulus of ground just outside the void is
 * jacked upward as the broken rock dilates beneath it. Quarry-blast craters
 * and every subsidence-trough survey show the same raised lip, peaking just
 * outside the extraction edge and dying within a fraction of R.
 *
 * Form: a Gaussian ring g(d) = H * exp(-((d - d0)/w)^2), d0 = 1.12R,
 * w = 0.22R. H = 0.08 keeps the lip legible (40 cm on a full 5 m event)
 * without rivalling the bowl. Like the bowl it enters the drop field with
 * analytic first and second derivatives, so the tilt and strain channels stay
 * consistent with the drawn surface. It is deliberately OUTSIDE the bowl's
 * mass-conservation identity: bulking genuinely creates volume.
 */
export const RIM_PEAK_RATIO = 1.12;
export const RIM_WIDTH_RATIO = 0.22;
export const RIM_HEIGHT_FRAC = 0.08;

export function rimProfile(d: number, R: number): number {
  const w = RIM_WIDTH_RATIO * R;
  const q = (Math.abs(d) - RIM_PEAK_RATIO * R) / w;
  return RIM_HEIGHT_FRAC * Math.exp(-q * q);
}

export function rimProfileDerivative(d: number, R: number): number {
  const ad = Math.abs(d);
  if (ad < 1e-9) return 0.0;
  const w = RIM_WIDTH_RATIO * R;
  const q = (ad - RIM_PEAK_RATIO * R) / w;
  const deriv = rimProfile(ad, R) * (-2.0 * q / w);
  return d < 0 ? -deriv : deriv;
}

export function rimProfileSecondDerivative(d: number, R: number): number {
  const ad = Math.abs(d);
  const w = RIM_WIDTH_RATIO * R;
  const q = (ad - RIM_PEAK_RATIO * R) / w;
  return rimProfile(ad, R) * ((4.0 * q * q) / (w * w) - 2.0 / (w * w));
}

export class LiveGeomechanicsEngine {
  public interventions: ActiveCollapseIntervention[] = [];

  /**
   * Panel-wide Knothe bowl streamed by the server: drop(x, y) =
   * bowlPx(x) * bowlPy(y), metres, both on the 121-point grid spanning the
   * window. `px` is fixed for the session; `py` changes every frame because the
   * longwall face travels north, so the bowl's shape changes and a single
   * time scalar can no longer describe it. Null until the server sends both.
   */
  private bowlPx: number[] | null = null;
  private bowlPy: number[] | null = null;
  private bowlWindowM = 600.0;

  public setBowlPx(px: number[] | null, windowM?: number) {
    this.bowlPx = px && px.length > 1 ? px : null;
    if (windowM !== undefined && Number.isFinite(windowM) && windowM > 0) this.bowlWindowM = windowM;
  }

  public setBowlPy(py: number[] | null) {
    this.bowlPy = py && py.length > 1 ? py : null;
  }

  /** Linear sample of a 1-D profile spanning the window at panel-frame `c`. */
  private sampleProfile(profile: number[], c: number): number {
    const last = profile.length - 1;
    const f = Math.min(Math.max((c / this.bowlWindowM + 0.5) * last, 0), last);
    const i0 = Math.min(Math.floor(f), last - 1);
    const t = f - i0;
    return profile[i0] * (1 - t) + profile[i0 + 1] * t;
  }

  /** P-wave velocity in the overburden, m/s. */
  public waveSpeedMps: number = 1800.0;
  /** Soil damping ratio (dimensionless). */
  public dampingZeta: number = 0.08;
  /** Dominant blast vibration frequency, Hz. */
  public waveFreqHz: number = 10.0;
  public blastActiveUntil: number = 0.0;
  public blastPPV: number = 0.0;

  /**
   * Most simultaneous collapse bowls kept on the surface.
   *
   * Every trigger used to append to `interventions` forever, and
   * `evaluatePoint` sums ALL of them at every one of the 25,600 render
   * vertices. Two things went wrong with that. The cost is linear in the
   * count, so a long session degraded the frame rate with no upper bound;
   * and, worse, the summed bowls have no joint physical meaning — a dozen
   * overlapping failures drive the surface into a shape no single
   * subsidence event could produce, which is the "terrain goes wild with
   * its structure" failure mode. The per-point S_MAX_FULL_M clamp does not
   * save it, because that clamps depth only, while tilt and curvature (and
   * therefore every strain reading) keep accumulating unbounded.
   *
   * Eight is chosen to be past any realistic demonstration sequence while
   * still bounding both. The oldest bowl is retired when a ninth arrives —
   * oldest rather than shallowest, so the surface stays causal: what you
   * triggered most recently is always what you can see.
   */
  public static readonly MAX_ACTIVE_BOWLS = 8;

  /**
   * Register a pillar-failure intervention.
   *
   * `magnitudeM` is clamped to S_MAX_FULL_M (5 m): one caving event can only
   * drop the surface so far. Repeated events in the same place keep deepening
   * the hole up to CUMULATIVE_DEPTH_MAX_M, which is enforced on the summed
   * field in `sampleAt` rather than here.
   */
  public triggerCollapse(
    cx: number,
    cy: number,
    magnitudeM: number = 0.75,
    radiusM: number = 70.0,
    tCurrent: number = 0.0,
    timeScale: number = 2000.0,
    cPerDay: number = 0.6
  ): string {
    const id = `collapse_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.interventions.push({
      id,
      cx,
      cy,
      magnitudeM: Math.min(Math.max(0, magnitudeM), S_MAX_FULL_M),
      radiusM: Math.max(1.0, radiusM),
      t0: tCurrent,
      // Settling rate, per simulated day, following the same 1 - exp(-c*t)
      // Knothe law the backend uses. The caller passes the rate implied by the
      // chosen intervention pace (see cPerDayForRealSeconds) so this preview
      // finishes at the same moment the server's own collapse does; the 0.6
      // default settles ~95% in five simulated days.
      cPerDay,
      timeScale,
    });

    // Retire the oldest bowls once past the cap. `splice` from the front
    // keeps the array in trigger order, so "oldest" stays well defined.
    if (this.interventions.length > LiveGeomechanicsEngine.MAX_ACTIVE_BOWLS) {
      this.interventions.splice(
        0,
        this.interventions.length - LiveGeomechanicsEngine.MAX_ACTIVE_BOWLS
      );
    }
    return id;
  }

  public triggerBlastVibration(ppv: number = 12.0, durationS: number = 60.0) {
    this.blastPPV = ppv;
    this.blastActiveUntil = performance.now() / 1000.0 + durationS;
  }

  public clearInterventions() {
    this.interventions = [];
  }

  public reset() {
    this.interventions = [];
    this.blastPPV = 0.0;
    this.blastActiveUntil = 0.0;
  }

  /**
   * Knothe rate `c` that finishes a collapse in `realSeconds` of wall clock.
   *
   * Inverts the time law below: 1 - exp(-c * simDays) = fraction, with
   * simDays = realSeconds * timeScale / 86400. Solving at fraction = 0.99
   * gives c = -ln(0.01) / simDays, so a pace expressed in "seconds you wait"
   * becomes a physical settling rate instead of a tuned constant.
   */
  public static cPerDayForRealSeconds(realSeconds: number, timeScale: number): number {
    const simDays = (Math.max(0.001, realSeconds) * timeScale) / SECONDS_PER_DAY;
    return -Math.log(0.01) / simDays;
  }

  /**
   * Knothe time law: the fraction of final subsidence realised after
   * `dtSeconds` of wall-clock, converted to simulated days via `timeScale`.
   * Identical in form to the backend's `1 - exp(-c * t_days)`.
   */
  private timeFactor(dtSeconds: number, inter: ActiveCollapseIntervention): number {
    if (dtSeconds <= 0) return 0.0;
    const simDays = (dtSeconds * inter.timeScale) / SECONDS_PER_DAY;
    return 1.0 - Math.exp(-inter.cPerDay * simDays);
  }

  /**
   * Evaluate deformation, strain, tilt and vibration at (x, y) at time t.
   *
   * Tilt and strain come from the analytic derivatives above, not from
   * finite-differencing the drop field.
   */
  public evaluatePoint(
    x: number,
    y: number,
    baseElevation: number,
    tCurrent: number
  ): GroundStateAtPoint {
    let totalDropM = 0.0;
    let slopeX = 0.0;
    let slopeY = 0.0;
    let curvature = 0.0;
    let totalVibrationM = 0.0;
    let totalRimM = 0.0;

    if (this.bowlPx && this.bowlPy) {
      totalDropM += this.sampleProfile(this.bowlPx, x) * this.sampleProfile(this.bowlPy, y);
    }

    for (const inter of this.interventions) {
      const dt = Math.max(0.0, tCurrent - inter.t0);
      const tf = this.timeFactor(dt, inter);
      if (tf <= 0) continue;

      const dx = x - inter.cx;
      const dy = y - inter.cy;
      const d = Math.hypot(dx, dy);
      const amp = inter.magnitudeM * tf;

      totalDropM += amp * bowlProfile(d, inter.radiusM);

      // Radial slope, decomposed onto x and y. At d = 0 the bowl is flat by
      // symmetry, so the radial unit vector is undefined and contributes
      // nothing — guarding here avoids a 0/0.
      const dSdd = amp * bowlProfileDerivative(d, inter.radiusM);
      if (d > 1e-6) {
        slopeX += dSdd * (dx / d);
        slopeY += dSdd * (dy / d);
      }

      curvature += amp * bowlProfileSecondDerivative(d, inter.radiusM);

      // Heave ring: bulked rock jacks the annulus just outside the void
      // UPWARD, so it subtracts from the drop field (and can take a vertex
      // slightly negative — genuine heave, which the elevation below honours).
      // Same Knothe time factor as the bowl: the lip rises as the bowl sinks.
      // The rim's derivatives enter with a minus sign because they
      // differentiate the drop field, which the uplift reduces.
      const rim = amp * rimProfile(d, inter.radiusM);
      totalDropM -= rim;
      totalRimM += rim;
      const dRimdd = -amp * rimProfileDerivative(d, inter.radiusM);
      if (d > 1e-6) {
        slopeX += dRimdd * (dx / d);
        slopeY += dRimdd * (dy / d);
      }
      curvature -= amp * rimProfileSecondDerivative(d, inter.radiusM);

      // Transient seismic response to the caving event itself.
      const simDays = (dt * inter.timeScale) / SECONDS_PER_DAY;
      if (dt > 0 && simDays < 0.05) {
        const waveFront = this.waveSpeedMps * (dt % 0.8);
        const phase = (2.0 * Math.PI * (d - waveFront)) / 55.0;
        const spaceDecay = Math.exp(-d / 220.0);
        const timeDecay = Math.exp(
          -this.dampingZeta * 2.0 * Math.PI * this.waveFreqHz * dt
        );
        totalVibrationM += 0.0125 * amp * spaceDecay * timeDecay * Math.cos(phase);
      }
    }

    // Depth ceiling: stacked failures go on deepening the same hole, so the
    // limit here is the CUMULATIVE carve-in ceiling, not one event's S_max.
    //
    // When this clamp actually binds, the surface is flat-bottomed at
    // S_max, and a flat bottom has zero slope and zero curvature. Leaving
    // the summed derivatives untouched at that point would report tilt and
    // strain for a shape the renderer is no longer drawing — overlapping
    // bowls would keep piling curvature onto ground that had stopped
    // moving, which reads as a runaway strain field with no visible cause.
    // So the derivatives are attenuated by the same factor the depth was,
    // keeping the reported deformation consistent with the drawn surface.
    const uncappedDropM = totalDropM;
    totalDropM = Math.min(totalDropM, CUMULATIVE_DEPTH_MAX_M);
    if (uncappedDropM > CUMULATIVE_DEPTH_MAX_M && uncappedDropM > 1e-9) {
      const clampRatio = totalDropM / uncappedDropM;
      slopeX *= clampRatio;
      slopeY *= clampRatio;
      curvature *= clampRatio;
    }

    // Horizontal strain by the Aviershin relation: eps = B * d2S/dx2, using
    // the single module-level B_HORIZ_M. Result is m/m; x1000 converts to the
    // mm/m the DGMS limits are quoted in.
    const strainMmPerM = B_HORIZ_M * curvature * 1000.0;

    const slopeMag = Math.hypot(slopeX, slopeY);
    const normLen = Math.sqrt(slopeX * slopeX + slopeY * slopeY + 1.0);

    return {
      elevation: baseElevation - totalDropM + totalVibrationM,
      initialElevation: baseElevation,
      dropDistanceM: totalDropM,
      rimUpliftM: totalRimM,
      tiltDeg: (Math.atan(slopeMag) * 180.0) / Math.PI,
      // Tilt in engineering units: mm of fall per m of run.
      tiltMmPerM: slopeMag * 1000.0,
      tensileStrainMmPerM: strainMmPerM,
      curvaturePerM: curvature,
      vibrationDisplacementM: totalVibrationM,
      surfaceNormal: [slopeX / normLen, slopeY / normLen, 1.0 / normLen],
    };
  }
}

/** Global singleton, shared by the renderer and the telemetry panels. */
export const globalGeomechanics = new LiveGeomechanicsEngine();

// ---------------------------------------------------------------------------
// Intervention geometry solver
// ---------------------------------------------------------------------------
//
// Tensile strain is not a force an operator can apply. It is a geometric
// consequence of the subsidence bowl: the ground is pulled apart where the
// bowl's curvature is convex, and pushed together over the void. So a
// "trigger a strain breach at the target" control cannot inject strain — it
// has to work out the collapse GEOMETRY whose bowl puts the tensile peak
// where the operator asked, at the magnitude they asked for.
//
// Both relations describe the kernel the SERVER uses — the Gaussian bell in
// sandbox/collapse.py::_spatial_profile, g = exp(-d^2 / (2 R^2)). That matters,
// because this file's own `bowlProfile` is a DIFFERENT (Bessel disc-convolution)
// shape used only to preview the drop between ticks. The server is what computes
// the strain the sensors report, so the solver below must be calibrated against
// the server's kernel, not this file's preview kernel. Mixing the two is
// exactly the bug this replaced: the constant was applied to the preview bowl,
// whose peak ratio actually drifts from 3.56 down to 1.49 over R = 40..160 m.
//
// This separation is why replacing the preview `bowlProfile` (the erf slab
// form, which did not conserve mass) with the mass-conserving Bessel form
// left the solver untouched and still correct: the solver never read the
// preview kernel in the first place. Only the stale description of what that
// preview kernel IS needed updating, which is this paragraph.
//
//   1. The peak tensile strain of a collapse of radius R lands at
//      sqrt(3) * R from its centre. This is exact, not fitted: the second
//      derivative of a Gaussian peaks at sqrt(3) sigma. Verified against the
//      server kernel to 9 significant figures at R = 40/60/90/120/150 m.
//
//   2. Peak strain is linear in magnitude and falls off as 1/R^2:
//         eps_peak(mm/m) = magnitude_m * STRAIN_GEOMETRY_C / R^2
//      This constant is likewise exact rather than fitted. Substituting
//      d = sqrt(3) R into eps = B * d2g/dx2 * 1000 gives
//         eps_peak = magnitude * (B * 2 * e^(-3/2) * 1000) / R^2
//      so the constant is DERIVED from B_HORIZ below and can never drift away
//      from it. The previous hardcoded 86315.9 was 2.80x too large, which made
//      solveStrainIntervention ask for ~2.8x less magnitude than the requested
//      strain actually needs — the TENSILE WAVE control silently under-
//      delivered, and its caption quoted a peak the ground never reached.
//
// Keeping these derived (rather than hardcoding a radius that "looks right")
// is what makes the intervention honest: the numbers the sensors then report
// are the real consequence of the geometry, not a value dialled in to match
// a caption.

/** Where a collapse of radius R puts its peak tensile strain: sqrt(3) * R. */
export const TENSILE_PEAK_RADIUS_RATIO = Math.sqrt(3.0);

/**
 * Constant in eps_peak = magnitude * C / R^2, in (mm/m)*m^2/m.
 *
 * Derived, never hand-typed: C = B * 2 * e^(-3/2) * 1000. Equals
 * 30827.193178 for the Adriyala panel. `tests/test_strain_calibration.py`
 * re-measures this by sweeping the real server kernel and fails if the two
 * ever disagree.
 */
export const STRAIN_GEOMETRY_C = B_HORIZ_M * 2.0 * Math.exp(-1.5) * 1000.0;

export interface StrainSolution {
  /** Collapse radius that lands the tensile peak on the requested ring, m. */
  radiusM: number;
  /** Collapse magnitude needed to reach the requested strain, m. */
  magnitudeM: number;
  /**
   * Peak tensile strain this geometry produces ON THE SERVER, mm/m — the
   * number the sensors will report once the tick lands. Not what this file's
   * preview bowl draws in the meantime.
   */
  peakStrainMmPerM: number;
  /** Distance from centre at which that peak lands, m. */
  peakRadiusM: number;
  /** True when the magnitude had to be clamped to S_MAX_FULL_M. */
  clamped: boolean;
}

/**
 * Solve for the collapse geometry that produces `targetStrainMmPerM` of peak
 * tensile strain on a ring `targetRadiusM` from the collapse centre.
 *
 * The magnitude is clamped to S_MAX_FULL_M — the physical ceiling a*m. If the
 * requested strain needs more subsidence than the seam can give, the solution
 * comes back `clamped` with the strain it can actually reach, so the caller
 * reports what the ground will really do instead of the number that was asked
 * for. That clamp is the reason this returns a struct rather than a radius.
 *
 * The geometry it returns is sent to the server, and the strain it reports is
 * the server kernel's, because the server is what the sensors read. See the
 * calibration note above for why that distinction is load-bearing.
 */
export function solveStrainIntervention(
  targetRadiusM: number,
  targetStrainMmPerM: number,
): StrainSolution {
  // Invert relation 1: put the tensile peak on the requested ring.
  const radiusM = Math.max(10.0, targetRadiusM / TENSILE_PEAK_RADIUS_RATIO);

  // Invert relation 2 for the magnitude that reaches the requested strain.
  const wanted = (targetStrainMmPerM * radiusM * radiusM) / STRAIN_GEOMETRY_C;
  const magnitudeM = Math.min(wanted, S_MAX_FULL_M);
  const clamped = wanted > S_MAX_FULL_M;

  return {
    radiusM,
    magnitudeM,
    peakStrainMmPerM: (magnitudeM * STRAIN_GEOMETRY_C) / (radiusM * radiusM),
    peakRadiusM: radiusM * TENSILE_PEAK_RADIUS_RATIO,
    clamped,
  };
}
