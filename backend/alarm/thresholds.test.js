'use strict';

// Loads the shared vector file (`config/threshold_vectors.json`) and
// asserts `classify`/`crackCategory` agree with it exactly. The same
// vectors drive `simulation/tests/test_thresholds.py`, so a change in
// either language's classify() that disagrees with the other shows up as
// a failure in one language's suite without needing to run both side by
// side.
//
// Run with: node --test backend/alarm/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { load, classify, crackCategory } = require('./thresholds');

const VECTORS_PATH = path.join(__dirname, '..', '..', 'config', 'threshold_vectors.json');
const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, 'utf8'));

for (const c of vectors.cases) {
  const freq = c.freq_hz;
  const label = `${c.condition}=${c.value}${freq !== undefined ? `@${freq}Hz` : ''}`;
  test(`classify vector: ${label}`, () => {
    const result = classify(c.condition, c.value, { freqHz: freq === undefined ? null : freq });
    assert.equal(result, c.expected);
  });
}

for (const c of vectors.crack_category_cases) {
  test(`crackCategory vector: width=${c.width_mm}`, () => {
    assert.equal(crackCategory(c.width_mm), c.expected);
  });
}

test('NaN value classifies as NORMAL', () => {
  assert.equal(classify('tilt_change', NaN), 'NORMAL');
});

test('every condition has a non-empty basis and description', () => {
  const conditions = load().conditions;
  for (const [name, spec] of Object.entries(conditions)) {
    assert.ok(spec.basis, `${name} has no basis`);
    assert.ok(spec.description, `${name} has no description`);
  }
});

for (const c of vectors.error_cases) {
  test(`${c.condition} is not classified by value (throws)`, () => {
    assert.throws(() => classify(c.condition, 1.0));
  });
}

test('unknown condition throws', () => {
  assert.throws(() => classify('not_a_real_condition', 1.0));
});
