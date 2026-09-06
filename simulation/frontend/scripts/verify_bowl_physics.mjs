/**
 * Physics gates for the client-side collapse bowl (src/utils/geomechanicsEngine.ts).
 *
 * Run with:  npx vite-node scripts/verify_bowl_physics.mjs
 *
 * These lock down the invariants that a previous version of the engine broke
 * silently, in ways that looked like a rendering problem rather than a physics
 * one:
 *
 *  1. MASS CONSERVATION. The subsided volume divided by the extracted void
 *     volume must be the same number at every radius. The old profile used a
 *     1-D slab convolution (an erf pair) for what is a 2-D disc problem, and
 *     that ratio drifted 3.275 -> 1.271 across R = 40..150 m: a small failure
 *     invented three times the ground movement its void could account for.
 *     Every derived channel (tilt, curvature, strain, and therefore every DGMS
 *     threshold and every sensor reading) is a derivative of this profile, so
 *     the error propagated into all of them.
 *
 *  2. ANALYTIC DERIVATIVES. Tilt and curvature must come from differentiating
 *     under the integral, not from finite-differencing the drop field, for the
 *     same reason sandbox/surface.py convolves analytic derivative kernels:
 *     truncation error is indistinguishable from the small real strain signal
 *     the detector exists to find. Comparing against a finite difference here
 *     is a TEST of the analytic form, not how the engine computes it.
 *
 *  3. A USABLE RADIUS SLIDER. With the regional influence radius applied to a
 *     local cave-in, a 40 m void reached only 12% of its nominal magnitude, so
 *     the severity slider was very nearly inert.
 *
 *  4. BOUNDED SUPERPOSITION. Bowls accumulated without limit and were summed at
 *     every render vertex, so a long session drove the surface into a shape no
 *     single subsidence event could produce.
 */

import { bowlProfile, bowlProfileDerivative, bowlProfileSecondDerivative,
         S_MAX_FULL_M, CUMULATIVE_DEPTH_MAX_M,
         LiveGeomechanicsEngine } from '../src/utils/geomechanicsEngine.ts';
import { depthColor, heightColor, DEPTH_STOPS, HEIGHT_STOPS } from '../src/utils/hypsometry.ts';
import { SUBSIDENCE_EPS_M, SUBSIDENCE_FADE_M, SUBSIDENCE_SHADOW } from '../src/components/TerrainMesh.tsx';

let fail = 0;
const ok = (c, m) => { console.log((c?'  PASS  ':'  FAIL  ')+m); if(!c) fail++; };

console.log('\n=== MASS CONSERVATION: bowl volume / void volume must be ~1 at EVERY radius ===');
for (const R of [15,20,40,60,85,150,250]) {
  let vol=0; const N=4000, dmax=900, h=dmax/N;
  for(let i=0;i<=N;i++){const d=i*h; const w=(i===0||i===N)?1:(i%2?4:2);
    vol += w*bowlProfile(d,R)*2*Math.PI*d;}
  vol *= h/3;
  const ratio = vol/(Math.PI*R*R);
  ok(Math.abs(ratio-1)<0.01, `R=${String(R).padStart(3)}m  vol/void=${ratio.toFixed(4)}  centre=${bowlProfile(0,R).toFixed(4)}`);
}

console.log('\n=== DERIVATIVES are analytic and match finite differences ===');
for (const R of [20,40,85,150]) for (const d of [5,30,80,150]) {
  const h=0.05;
  const fd1=(bowlProfile(d+h,R)-bowlProfile(d-h,R))/(2*h);
  const fd2=(bowlProfile(d+h,R)-2*bowlProfile(d,R)+bowlProfile(d-h,R))/(h*h);
  const a1=bowlProfileDerivative(d,R), a2=bowlProfileSecondDerivative(d,R);
  // Relative error is meaningless where the bowl is genuinely flat (R >> R_CAVE
  // makes the centre flat-bottomed, so both analytic and FD are ~1e-10 noise).
  // Skip the comparison below an absolute floor rather than assert on noise.
  const FLOOR = 1e-7;
  if (Math.abs(fd1) < FLOOR && Math.abs(fd2) < FLOOR) {
    console.log(`  SKIP  R=${String(R).padStart(3)} d=${String(d).padStart(3)} bowl is flat here (|dS/dd|=${Math.abs(fd1).toExponential(1)})`);
  } else {
    const e1=Math.abs(a1-fd1)/(Math.abs(fd1)+1e-12), e2=Math.abs(a2-fd2)/(Math.abs(fd2)+1e-12);
    ok(e1<0.02&&e2<0.05, `R=${String(R).padStart(3)} d=${String(d).padStart(3)} d1err=${(e1*100).toFixed(3)}% d2err=${(e2*100).toFixed(3)}%`);
  }
}

console.log('\n=== RADIUS now materially changes depth (slider is not inert) ===');
const depths=[15,40,85,250].map(R=>bowlProfile(0,R)*S_MAX_FULL_M);
console.log(`   depth at severity ${S_MAX_FULL_M}m for R=15/40/85/250: `+depths.map(v=>v.toFixed(3)+'m').join('  '));
// Thresholds are fractions of the per-event ceiling, not absolute metres, so
// they keep testing the SHAPE of the profile if that ceiling is ever retuned.
ok(depths[0]<0.27*S_MAX_FULL_M, 'R=15m gives a shallow, tight crater');
ok(depths[3]>0.97*S_MAX_FULL_M, `R=250m reaches the full ${S_MAX_FULL_M}m ceiling`);
ok(depths[3]-depths[0]>0.66*S_MAX_FULL_M, 'slider spans a wide, usable depth range');

console.log('\n=== BOWL COUNT is bounded (terrain cannot go wild) ===');
const eng=new LiveGeomechanicsEngine();
for(let i=0;i<40;i++) eng.triggerCollapse(i*7,0,S_MAX_FULL_M,60,0,10,600);
ok(eng.interventions.length===LiveGeomechanicsEngine.MAX_ACTIVE_BOWLS,
   `40 triggers -> ${eng.interventions.length} active bowls (cap ${LiveGeomechanicsEngine.MAX_ACTIVE_BOWLS})`);

console.log('\n=== DEPTH CEILING holds under heavy superposition ===');
// Stacked events deepen the same hole past ONE event's ceiling, and are
// bounded only by the cumulative ceiling the depth ramp is normalised to.
const e2=new LiveGeomechanicsEngine();
for(let i=0;i<8;i++) e2.triggerCollapse(0,0,S_MAX_FULL_M,120,0,10,600);
const st=e2.evaluatePoint(0,0,200,1e6);
ok(st.dropDistanceM>S_MAX_FULL_M,
   `8 stacked bowls deepen past one event's ${S_MAX_FULL_M}m -> ${st.dropDistanceM.toFixed(4)}m`);
ok(st.dropDistanceM<=CUMULATIVE_DEPTH_MAX_M+1e-9,
   `8 stacked bowls stay under the cumulative ceiling -> ${st.dropDistanceM.toFixed(4)}m <= ${CUMULATIVE_DEPTH_MAX_M}m`);
// And the cumulative ceiling itself must actually bind under enough stacking.
const e3=new LiveGeomechanicsEngine();
for(let i=0;i<200;i++) e3.triggerCollapse(0,0,S_MAX_FULL_M,120,0,10,600);
const st3=e3.evaluatePoint(0,0,200,1e6);
ok(st3.dropDistanceM<=CUMULATIVE_DEPTH_MAX_M+1e-9,
   `heavy stacking clamps at the cumulative ceiling -> ${st3.dropDistanceM.toFixed(4)}m <= ${CUMULATIVE_DEPTH_MAX_M}m`);
ok(Number.isFinite(st.tensileStrainMmPerM), `strain stays finite: ${st.tensileStrainMmPerM.toExponential(3)} mm/m`);

// ---------------------------------------------------------------------------
// Colour: the height ramp, the depth ramp, and — the fix that actually
// matters — the RENDERED COMPOSITE the two produce together
// ---------------------------------------------------------------------------
// The bowl is shown by overlaying a depth ramp on a height-coloured base,
// because a full-depth 2.25 m collapse is 1.3% of this panel's 174 m of
// relief. Five previous fixes asserted only that the depth ramp itself was
// monotonic in lightness, re-ran that check, saw it pass, and shipped —
// while TerrainMesh actually blends the ramp OVER the terrain colour, and
// that composite was not monotonic: measured on the real panel DEM, the
// ground got BRIGHTER from 0 to ~0.125 m of subsidence (L* 74.7 -> 83.4)
// because the old depth ramp's lightest stop (L* 93.1) was lighter than the
// terrain it was blended over. So this section checks four things, and the
// fourth is the one that closes the bug for good: it rebuilds the exact
// composite TerrainMesh renders and asserts ITS lightness never rises.

const srgbToLinear = c => c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4;
const lightness = ([r,g,b]) => {
  const Y = srgbToLinear(r)*0.2126 + srgbToLinear(g)*0.7152 + srgbToLinear(b)*0.0722;
  return Y > 0.008856 ? 116*Math.cbrt(Y)-16 : 903.3*Y;
};
const toLab = ([r,g,b]) => {
  const [R,G,B]=[srgbToLinear(r),srgbToLinear(g),srgbToLinear(b)];
  const X=(R*0.4124+G*0.3576+B*0.1805)/0.95047, Y=R*0.2126+G*0.7152+B*0.0722,
        Z=(R*0.0193+G*0.1192+B*0.9505)/1.08883;
  const k=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;
  return [116*k(Y)-16, 500*(k(X)-k(Y)), 200*(k(Y)-k(Z))];
};
const deltaE = (a,b) => { const [A,B]=[toLab(a),toLab(b)];
  return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]); };
const lerpRGB = ([r0,g0,b0],[r1,g1,b1],t) =>
  [r0+(r1-r0)*t, g0+(g1-g0)*t, b0+(b1-b0)*t];

console.log('\n=== HEIGHT_STOPS: lightness strictly increases with elevation ===');
{
  let prevL = -Infinity, monotone = true, worst = '';
  for (const [t, hex] of HEIGHT_STOPS) {
    const L = lightness(heightColor(t));
    if (L < prevL - 0.01) { monotone = false; worst = `t=${t.toFixed(2)} (${hex}) fell to L*=${L.toFixed(1)}`; }
    prevL = L;
  }
  ok(monotone, `lightness rises monotonically across HEIGHT_STOPS ${monotone?'':'('+worst+')'}`);
}

console.log('\n=== DEPTH_STOPS: lightness strictly decreases with depth ===');
{
  let prevL = Infinity, monotone = true, worst = '';
  for (const [t, hex] of DEPTH_STOPS) {
    const L = lightness(depthColor(t));
    if (L > prevL + 0.01) { monotone = false; worst = `t=${t.toFixed(2)} (${hex}) rose to L*=${L.toFixed(1)}`; }
    prevL = L;
  }
  ok(monotone, `lightness falls monotonically across DEPTH_STOPS ${monotone?'':'('+worst+')'}`);
}

console.log('\n=== SHADOW SUFFICIENCY: excavation shadow must darken ramp entry to at least the darkest terrain it blends over ===');
// DEPTH_STOPS now enters at L* 58 (lighter than HEIGHT_STOPS' darkest stop,
// L* 46) because the extra range comes from chroma, not a lightness ceiling.
// The excavation shadow in TerrainMesh.tsx darkens the blended colour at
// entry to compensate. This asserts the shadow is strong enough: entry
// darkened by the full shadow strength (blend=1, t=0) must be no lighter
// than the darkest terrain the ramp could ever be blended over.
{
  const enteredL = lightness(depthColor(0).map(c => c * (1 - SUBSIDENCE_SHADOW)));
  const minHeightL = Math.min(...HEIGHT_STOPS.map(([t]) => lightness(heightColor(t))));
  console.log(`   shadowed entry L* = ${enteredL.toFixed(1)}   min L* over HEIGHT_STOPS = ${minHeightL.toFixed(1)}`);
  ok(enteredL <= minHeightL, `excavation shadow is sufficient: shadowed entry L*=${enteredL.toFixed(1)} <= darkest terrain L*=${minHeightL.toFixed(1)}`);
}

console.log('\n=== COMPOSITE SWEEP: rebuilds exactly what TerrainMesh renders, must never brighten as depth increases ===');
// SUBSIDENCE_EPS_M, SUBSIDENCE_FADE_M and SUBSIDENCE_SHADOW now come from
// TerrainMesh.tsx directly (imported above) rather than being hand-copied —
// a stale copy would mean this sweep validates a composite the app no longer
// renders, which is exactly the drift this file's own history warns about.

function compositeColor(hT, drop) {
  const base = heightColor(hT);
  if (drop <= SUBSIDENCE_EPS_M) return base;
  const t = Math.min(1, drop / CUMULATIVE_DEPTH_MAX_M);
  const ramp = depthColor(t);
  const blend = Math.min(1, drop / SUBSIDENCE_FADE_M);
  const blended = lerpRGB(base, ramp, blend);
  const shadow = 1.0 - SUBSIDENCE_SHADOW * blend * (1.0 - t);
  return blended.map(c => c * shadow);
}

{
  let violations = 0;
  let worst = '';
  for (let hi = 0; hi <= 20; hi++) {
    const hT = hi / 20;
    let prevL = -Infinity;
    for (let di = 0; di <= 250; di++) {
      // 0 .. CUMULATIVE_DEPTH_MAX_M in 251 samples, so the sweep covers the
      // full depth the mesh can actually render rather than stopping at one
      // event's ceiling and leaving the deep end of the ramp untested.
      const drop = (di / 250) * CUMULATIVE_DEPTH_MAX_M;
      const L = lightness(compositeColor(hT, drop));
      if (di > 0 && L > prevL + 0.01) {
        violations++;
        if (!worst) worst = `hT=${hT.toFixed(2)} drop=${drop.toFixed(2)}m: L* ${prevL.toFixed(1)} -> ${L.toFixed(1)}`;
      }
      prevL = L;
    }
  }
  console.log(`   composite lightness-increasing steps across 21 heights x 251 depths: ${violations}`);
  ok(violations === 0, `composite never brightens as depth increases ${violations===0?'':'(first violation: '+worst+')'}`);
}

console.log('\n=== The bowl is actually VISIBLE (this is the whole point) ===');
// A 0.10 m drop must still read as clearly distinct from undisturbed ground
// AT THE SAME TERRAIN HEIGHT — comparing against the bare ramp (as before)
// would miss a case where the height base swamps a shallow depth overlay.
{
  const hT = 0.5;
  const undisturbed = compositeColor(hT, 0);
  for (const drop of [0.10, 0.50, 2.25, 10.0, 50.0]) {
    const c = compositeColor(hT, drop);
    const dE = deltaE(undisturbed, c);
    ok(dE > 20, `a ${drop.toFixed(2)} m drop is clearly distinct at hT=${hT}: deltaE=${dE.toFixed(1)}`);
  }
}
// And confirm why the height ramp alone could never do this job: a full
// bowl at the panel median moves the height tint by almost nothing.
const relief = 174.1, medianT = (211.0-196.2)/relief;
const eBefore = heightColor(medianT);
const eAfter  = heightColor((211.0-S_MAX_FULL_M-196.2)/relief);
const eDelta  = deltaE(eBefore, eAfter);
console.log(`   height ramp across a FULL ${S_MAX_FULL_M} m bowl: deltaE=${eDelta.toFixed(2)} (below the 2.3 JND)`);
console.log(`   composite, same bowl at hT=0.5:       deltaE=${deltaE(compositeColor(0.5, 0), compositeColor(0.5, S_MAX_FULL_M)).toFixed(1)}`);
ok(eDelta < 2.3, 'confirms absolute height alone cannot show the bowl (deltaE below JND)');

console.log(fail===0?'\nALL CHECKS PASSED\n':`\n${fail} CHECK(S) FAILED\n`);
process.exit(fail?1:0);
