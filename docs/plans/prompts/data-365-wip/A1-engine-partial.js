'use strict';

// Pure ISA-18.2-style alarm lifecycle state machine (DATA-365, Segment A,
// step A1). No DB, no network, no timers -- every function that needs the
// current time takes it as an argument. The caller (A2) is responsible for
// persistence, wiring and time.
//
// The 24 h median filter on tilt/strain (`lifecycle.median_filter_h` in
// `config/alarm-thresholds.json`) is applied UPSTREAM by the caller before
// `ingest()` is called. This module assumes every value it sees is already
// filtered; it does not re-filter or smooth anything itself.
//
// One record per `${node_id}:${condition}` key. A record's lifecycle:
//   NORMAL -> UNACK_ACTIVE -> ACK_ACTIVE -> UNACK_RTN -> NORMAL (deleted)
// with UNACK_ACTIVE -> UNACK_RTN -> NORMAL (deleted) also possible if the
// operator never acks. Records that fully return to NORMAL are removed
// from the internal map; `records()` therefore only ever needs to return
// "everything left in the map", since nothing NORMAL stays in it.

const { load, classify, limitFor } = require('./thresholds');

// Sample.values field -> alarm-thresholds.json condition name.
// `ppv_freq_hz` is context for `ppv`, not a condition of its own, so it has
// no entry here.
const VALUE_TO_CONDITION = {
  tilt_change: 'tilt_change',
  strain_tensile: 'strain_tensile',
  strain_compressive: 'strain_compressive',
  tilt_rate: 'tilt_rate',
  crack_width: 'crack_width',
  ppv: 'ppv',
  pore_pressure_rise: 'pore_pressure_rise',
  battery_v: 'battery_low',
};

// comms_stale has no reading to average a cadence from until at least one
// gap has been observed for a node; this is the fallback used until then.
const DEFAULT_CADENCE_MS = 3600000;

// How many recent inter-sample gaps we keep per node to compute a median
// cadence. Old gaps age out so a node's cadence can drift (e.g. a
// maintenance window) without permanently skewing the stale check.
const MAX_GAP_SAMPLES = 8;

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function createEngine({ thresholds = load(), now = 0 } = {}) {
  const RANK = {};
  thresholds.levels.forEach((level, i) => {
    RANK[level] = i;
  });
  const ON_DELAY = thresholds.lifecycle.on_delay_samples;
  const DEADBAND_FRAC = thresholds.lifecycle.deadband_frac;
  const LATCH_SET = new Set(thresholds.lifecycle.latch);
  const STALE_AFTER_CADENCES = thresholds.conditions.comms_stale.stale_after_cadences;

  // Mutable engine state. All of it is plain-JSON-serialisable so
  // snapshot()/restore() can hand it to A2 for persistence untouched.
  let currentTime = now;
  let recordsMap = new Map(); // key -> record
  let shelves = new Map(); // key -> { until_ms, reason, operator }
  let nodeTiming = new Map(); // node_id -> { lastSampleTime, gaps: [] }
  let pending = new Map(); // key -> { upCount, downCount } (on-delay counters)

  function getPending(key) {
    let p = pending.get(key);
    if (!p) {
      p = { upCount: 0, downCount: 0 };
      pending.set(key, p);
    }
    return p;
  }

  function resetPending(key) {
    pending.delete(key);
  }

  function isShelved(key) {
    const s = shelves.get(key);
    return !!s && currentTime < s.until_ms;
  }

  // Create (raise) or bump the priority of (escalate) the record at `key`.
  // Also used to reactivate a record that was sitting in UNACK_RTN when the
  // condition became active again -- the record already exists, so this
  // takes the "escalate" branch even when the new level equals the old one
  // is handled by the caller before reaching here (see processSample).
  function raiseOrEscalate(key, node_id, condition, rawLevel, value, t_ms, ctx) {
    const limit = limitFor(condition, rawLevel, ctx);
    const record = recordsMap.get(key);
    if (!record) {
      const created = {
        key,
        node_id,
        condition,
        priority: rawLevel,
        state: 'UNACK_ACTIVE',
        value,
        limit,
        t_raised: t_ms,
        t_escalated: null,
        t_ack: null,
        ack_by: null,
        t_rtn: null,
        shelved_until: null,
        history: [{ t_ms, from: 'NORMAL', to: rawLevel, value }],
      };
      recordsMap.set(key, created);
      return { type: 'raised', record: created };
    }
    const oldPriority = record.priority;
    record.priority = rawLevel;
    record.limit = limit;
    record.value = value;
    record.state = 'UNACK_ACTIVE';
    record.t_escalated = t_ms;
    record.t_rtn = null;
    record.history.push({ t_ms, from: oldPriority, to: rawLevel, value });
    return { type: 'escalated', record };
  }

  // Move the record at `key` down to `rawLevel` (a lower rank than its
  // current priority). rawLevel === 'NORMAL' either returns it to
  // UNACK_RTN (unacked -- stays visible) or clears it outright (acked).
  function deescalate(key, rawLevel, value, t_ms, ctx) {
    const record = recordsMap.get(key);
    const oldPriority = record.priority;
    if (rawLevel === 'NORMAL') {
      if (record.state === 'UNACK_RTN') {
        // Already sitting in RTN; a further drop is not a new transition.
        record.value = value;
        return null;
      }
      if (record.state === 'ACK_ACTIVE') {
        record.history.push({ t_ms, from: oldPriority, to: 'NORMAL', value });
        const cleared = { ...record, priority: 'NORMAL', state: 'NORMAL', value, t_rtn: t_ms };
        recordsMap.delete(key);
        return { type: 'cleared', record: cleared };
      }
      // UNACK_ACTIVE -> unacked return-to-normal: stays visible.
      record.state = 'UNACK_RTN';
      record.t_rtn = t_ms;
      record.value = value;
      record.history.push({ t_ms, from: oldPriority, to: 'NORMAL', value });
      return { type: 'rtn', record };
    }
    // Partial de-escalation: still abnormal, just a lower rung.
    record.priority = rawLevel;
    record.limit = limitFor(record.condition, rawLevel, ctx);
    record.value = value;
    record.history.push({ t_ms, from: oldPriority, to: rawLevel, value });
    return { type: 'deescalated', record };
  }

  // Run one (node, condition) value through the lifecycle and return a
  // change event, or null if nothing changed.
  function processSample(key, node_id, condition, value, t_ms, ctx) {
    if (isShelved(key)) {
      const record = recordsMap.get(key);
      if (record) record.value = value;
      return null;
    }

    const rawLevel = classify(condition, value, ctx);
    const record = recordsMap.get(key);
    const currentPriority = record ? record.priority : 'NORMAL';
    const currentRank = RANK[currentPriority];
    const rawRank = RANK[rawLevel];

    // CRITICAL is latched while unacked: freeze priority/state, but still
    // surface the live value.
    if (record && LATCH_SET.has(record.priority) && record.state === 'UNACK_ACTIVE') {
      record.value = value;
      resetPending(key);
      return null;
    }

    // A record parked in UNACK_RTN whose condition re-triggers at exactly
    // its old priority (no rank change, so the generic ">" branch below
    // never fires) needs to come back to life. This is a simplification:
    // unlike a fresh raise, reactivation at the same level is immediate,
    // not on-delay-confirmed -- an edge case outside this step's test list,
    // but one the state machine must not leave stuck in UNACK_RTN forever.
    if (record && record.state === 'UNACK_RTN' && rawRank === currentRank) {
      record.state = 'UNACK_ACTIVE';
      record.t_raised = t_ms;
      record.t_rtn = null;
      record.value = value;
      record.history.push({ t_ms, from: 'NORMAL', to: rawLevel, value });
      resetPending(key);
      return { type: 'raised', record };
    }

    if (rawRank === currentRank) {
      resetPending(key);
      if (record) record.value = value;
      return null;
    }

    if (rawRank > currentRank) {
      const p = getPending(key);
      p.upCount += 1;
      p.downCount = 0;
      if (p.upCount < ON_DELAY) return null;
      resetPending(key);
      return raiseOrEscalate(key, node_id, condition, rawLevel, value, t_ms, ctx);
    }

    // rawRank < currentRank: candidate to leave currentPriority. The
    // deadband is checked against the limit of the level being LEFT, not
    // the level being entered -- that is what gives it hysteresis at the
    // boundary regardless of how far below the value has fallen.
    const boundary = limitFor(condition, currentPriority, ctx);
    const direction = thresholds.conditions[condition].direction;
    const deadbandOk =
      boundary === null
        ? true
        : direction === 'below'
        ? value > boundary * (1 + DEADBAND_FRAC)
        : value < boundary * (1 - DEADBAND_FRAC);
    const p = getPending(key);
    p.upCount = 0;
    if (!deadbandOk) {
      p.downCount = 0;
      if (record) record.value = value;
      return null;
    }
    p.downCount += 1;
    if (p.downCount < ON_DELAY) {
      if (record) record.value = value;
      return null;
    }
    resetPending(key);
    return deescalate(key, rawLevel, value, t_ms, ctx);
  }

  function ingest(sample) {
    const { node_id, t_ms, values } = sample;
    currentTime = t_ms;
    const events = [];

    // Cadence tracking for comms_stale, and RTN of any stale flag this
    // node already carries -- any packet at all means comms are back.
    let timing = nodeTiming.get(node_id);
    if (!timing) {
      timing = { lastSampleTime: t_ms, gaps: [] };
      nodeTiming.set(node_id, timing);
    } else {
      const gap = t_ms - timing.lastSampleTime;
      if (gap > 0) {
        timing.gaps.push(gap);
        if (timing.gaps.length > MAX_GAP_SAMPLES) timing.gaps.shift();
      }
      timing.lastSampleTime = t_ms;
    }

    const staleKey = `${node_id}:comms_stale`;
    const staleRecord = recordsMap.get(staleKey);
    if (staleRecord) {
      if (staleRecord.state === 'UNACK_ACTIVE') {
        staleRecord.state = 'UNACK_RTN';
        staleRecord.t_rtn = t_ms;
        staleRecord.history.push({ t_ms, from: staleRecord.priority, to: 'NORMAL', value: null });
        events.push({ type: 'rtn', record: staleRecord });
      } else if (staleRecord.state === 'ACK_ACTIVE') {
        const cleared = { ...staleRecord, priority: 'NORMAL', state: 'NORMAL', t_rtn: t_ms };
        recordsMap.delete(staleKey);
        events.push({ type: 'cleared', record: cleared });
      }
      // UNACK_RTN already -- idempotent, no event.
    }

    if (values) {
      for (const [field, condition] of Object.entries(VALUE_TO_CONDITION)) {
        const value = values[field];
        if (value === null || value === undefined || Number.isNaN(value)) continue;
        const ctx = condition === 'ppv' ? { freqHz: values.ppv_freq_hz } : {};
        const key = `${node_id}:${condition}`;
        const ev = processSample(key, node_id, condition, value, t_ms, ctx);
        if (ev) events.push(ev);
      }
    }

    return events;
  }

  function tick(t_ms) {
    currentTime = t_ms;
    const events = [];

    for (const [key, s] of Array.from(shelves.entries())) {
      if (t_ms < s.until_ms) continue;
      shelves.delete(key);
      const record = recordsMap.get(key);
      if (record) record.shelved_until = null;
      events.push({ type: 'unshelved', record: record || { key, shelved_until: null } });
    }

    for (const [node_id, timing] of nodeTiming) {
      const key = `${node_id}:comms_stale`;
      if (isShelved(key)) continue;
      if (recordsMap.has(key)) continue; // already flagged -- idempotent
      const cadence = timing.gaps.length > 0 ? median(timing.gaps) : DEFAULT_CADENCE_MS;
      const staleThreshold = STALE_AFTER_CADENCES * cadence;
      if (t_ms - timing.lastSampleTime < staleThreshold) continue;
      const record = {
        key,
        node_id,
        condition: 'comms_stale',
        priority: 'ADVISORY',
        state: 'UNACK_ACTIVE',
        value: null,
        limit: null,
        t_raised: t_ms,
        t_escalated: null,
        t_ack: null,
        ack_by: null,
        t_rtn: null,
        shelved_until: null,
        history: [{ t_ms, from: 'NORMAL', to: 'ADVISORY', value: null }],
      };
      recordsMap.set(key, record);
      events.push({ type: 'stale', record });
    }

    return events;
  }

  function ack(key, { operator, t_ms }) {
    currentTime = t_ms;
    const record = recordsMap.get(key);
    if (!record) return null;
    if (record.state === 'UNACK_ACTIVE') {
      record.state = 'ACK_ACTIVE';
      record.t_ack = t_ms;
      record.ack_by = operator;
      return { type: 'acked', record };
    }
    if (record.state === 'UNACK_RTN') {
      const cleared = { ...record, state: 'NORMAL', priority: 'NORMAL', t_ack: t_ms, ack_by: operator };
      recordsMap.delete(key);
      return { type: 'cleared', record: cleared };
    }
    return null; // already ACK_ACTIVE -- idempotent
  }

  function shelve(key, { operator, t_ms, until_ms, reason }) {
    currentTime = t_ms;
    shelves.set(key, { until_ms, reason, operator });
    const record = recordsMap.get(key);
    if (record) record.shelved_until = until_ms;
    return { type: 'shelved', record: record || { key, shelved_until: until_ms, reason, operator } };
  }

  function unshelve(key, { operator, t_ms }) {
    currentTime = t_ms;
    shelves.delete(key);
    const record = recordsMap.get(key);
    if (record) record.shelved_until = null;
    return { type: 'unshelved', record: record || { key, shelved_until: null, operator } };
  }

  function records() {
    return Array.from(recordsMap.values());
  }

  function nodeState(node_id) {
    let bestRank = 0;
    let best = 'NORMAL';
    for (const record of recordsMap.values()) {
      if (record.node_id !== node_id) continue;
      if (isShelved(record.key)) continue;
      const r = RANK[record.priority];
      if (r > bestRank) {
        bestRank = r;
        best = record.priority;
      }
    }
    return best;
  }

  function snapshot() {
    return {
      currentTime,
      records: Array.from(recordsMap.entries()).map(([k, v]) => [
        k,
        { ...v, history: v.history.map((h) => ({ ...h })) },
      ]),
      shelves: Array.from(shelves.entries()).map(([k, v]) => [k, { ...v }]),
      nodeTiming: Array.from(nodeTiming.entries()).map(([k, v]) => [
        k,
        { lastSampleTime: v.lastSampleTime, gaps: [...v.gaps] },
      ]),
      pending: Array.from(pending.entries()).map(([k, v]) => [k, { ...v }]),
    };
  }

  function restore(snap) {
    currentTime = snap.currentTime;
    recordsMap = new Map(
      snap.records.map(([k, v]) => [k, { ...v, history: v.history.map((h) => ({ ...h })) }])
    );
    shelves = new Map(snap.shelves.map(([k, v]) => [k, { ...v }]));
    nodeTiming = new Map(
      snap.nodeTiming.map(([k, v]) => [k, { lastSampleTime: v.lastSampleTime, gaps: [...v.gaps] }])
    );
    pending = new Map(snap.pending.map(([k, v]) => [k, { ...v }]));
  }

  return { ingest, tick, ack, shelve, unshelve, records, nodeState, snapshot, restore };
}

module.exports = { createEngine };
