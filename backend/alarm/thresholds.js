'use strict';

// Single loader/classifier for `config/alarm-thresholds.json`, the one
// table every alarm consumer in this repo is meant to read (see DATA-365
// plan, Segment T). `simulation/sandbox/thresholds.py` implements the
// identical API in Python; the two are asserted against the same vector
// file, `config/threshold_vectors.json`, so a change to one language's
// rounding or boundary handling that disagrees with the other shows up as
// a test failure.
//
// This module does not decide which copy of a threshold constant is the
// canonical one elsewhere in the codebase (`node-sensors.js` etc. still
// carry their own numbers) -- that rewiring is later DATA-365 steps. This
// module only has to exist, load the shared file, and classify correctly
// against it.

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'config', 'alarm-thresholds.json');

// comms_stale and sensor_flatline are data-quality flags raised from packet
// cadence / flatline detection, not from a number compared against a limit.
// classify() has nothing to compare, so it throws rather than guessing a
// level -- documented here and kept identical in simulation/sandbox/thresholds.py.
const NON_VALUE_CONDITIONS = new Set(['comms_stale', 'sensor_flatline']);

const _cache = new Map();

// Load and cache the shared alarm-threshold table. The default path
// resolves to `config/alarm-thresholds.json` at the repo root, relative to
// this file. Repeated calls with the same (or default) path return the
// cached object; a different path gets its own cache entry, which is how
// tests point at fixture files.
function load(filePath) {
  const resolved = filePath ? path.resolve(filePath) : DEFAULT_PATH;
  if (!_cache.has(resolved)) {
    const raw = fs.readFileSync(resolved, 'utf8');
    _cache.set(resolved, JSON.parse(raw));
  }
  return _cache.get(resolved);
}

// Compare `value` against the three rungs in the given `direction`. A rung
// of null is skipped (some conditions, e.g. tilt_rate, have no CRITICAL
// rung at all). Reaching a threshold exactly counts as having crossed it --
// `value === limit` returns that limit's level.
function classifyNumeric(direction, value, advisory, warning, critical) {
  const rungs = [
    [critical, 'CRITICAL'],
    [warning, 'WARNING'],
    [advisory, 'ADVISORY'],
  ];
  if (direction === 'above') {
    for (const [limit, level] of rungs) {
      if (limit !== null && limit !== undefined && value >= limit) return level;
    }
    return 'NORMAL';
  }
  if (direction === 'below') {
    for (const [limit, level] of rungs) {
      if (limit !== null && limit !== undefined && value <= limit) return level;
    }
    return 'NORMAL';
  }
  throw new Error(`unknown direction: ${direction}`);
}

// Pick the DGMS frequency band for `freqHz`. `null`/`undefined` (dominant
// frequency not measured) uses the lowest-frequency band, which is also the
// strictest (lowest mm/s limit) -- the safe default when we don't know any
// better. A band's max_hz is exclusive (freqHz < max_hz), matching the DGMS
// table's own "< 8 Hz" / "> 25 Hz" wording -- a reading of exactly 8 Hz
// falls in the 8-25 Hz band, not the < 8 Hz one.
function ppvBand(spec, freqHz) {
  const bands = spec.limits_by_band;
  if (freqHz === null || freqHz === undefined) {
    return bands[0];
  }
  for (const band of bands) {
    if (band.max_hz === null || freqHz < band.max_hz) return band;
  }
  return bands[bands.length - 1];
}

// Classify `value` for `condition` into NORMAL/ADVISORY/WARNING/CRITICAL.
//
// `value` of null/undefined/NaN is always NORMAL -- a missing reading is a
// comms/sensor-fault concern, not itself an alarm value. `ctx.freqHz` only
// matters for `ppv`, which is banded by dominant vibration frequency (see
// `ppvBand`); it is ignored for every other condition.
//
// Throws for an unknown condition, and for `comms_stale`/`sensor_flatline`
// (see `NON_VALUE_CONDITIONS`).
function classify(condition, value, ctx = {}) {
  const freqHz = ctx.freqHz === undefined ? null : ctx.freqHz;
  const table = load();
  const conditions = table.conditions;
  if (!Object.prototype.hasOwnProperty.call(conditions, condition)) {
    throw new Error(`unknown alarm condition: ${condition}`);
  }
  if (NON_VALUE_CONDITIONS.has(condition)) {
    throw new Error(
      `${condition} is not classified by value; it is raised from packet ` +
        'cadence / flatline detection, not compared against a number'
    );
  }

  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'NORMAL';
  }

  const spec = conditions[condition];

  if (condition === 'ppv') {
    const band = ppvBand(spec, freqHz);
    const limit = band.limit;
    const { advisory, warning, critical } = spec.fractions;
    return classifyNumeric('above', value, advisory * limit, warning * limit, critical * limit);
  }

  return classifyNumeric(spec.direction, value, spec.advisory, spec.warning, spec.critical);
}

// Burland/BRE Digest 251 damage category (0..5) for a crack width in mm.
// Categories are ordered by ascending min_mm; the returned category is the
// highest one whose min_mm the width has reached (>=), matching the same
// "boundary counts as reached" rule classify() uses.
function crackCategory(widthMm) {
  const categories = load().conditions.crack_width.categories;
  let best = categories[0].cat;
  for (const cat of categories) {
    if (cat.min_mm !== null && widthMm >= cat.min_mm) best = cat.cat;
  }
  return best;
}

module.exports = { load, classify, crackCategory };
