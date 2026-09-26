'use strict';

/**
 * dashboard_electron/test/verify_forge_close.js
 *
 * Focused regression test for the FORGE selection lifecycle (no browser
 * needed — the REAL renderer sources run in a vm context with a stub DOM):
 *
 *  1. Embed slot identity: the SIM iframe URL carries slot=sim and the FORGE
 *     iframe URL carries slot=forge (the App suppresses packet-sync toasts
 *     in the forge slot only).
 *  2. Zero nodes = no selection: a 0-node SIM record keeps the gate banner up
 *     ("Select nodes on the MAP tab first (SIM box tool)"), RUN disabled, and
 *     shows NO number on the SIM / SEND badges.
 *  3. CLOSE releases the SIM-channel selection: badges drop their counts, the
 *     gate returns, the dashboard closes. The 3D channel is untouched.
 *  4. Static pin: App.tsx gates the SYNCHRONIZED toast on slot !== 'forge'.
 *
 * Run with:  node test/verify_forge_close.js   (from dashboard_electron/)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RENDERER = path.join(__dirname, '..', 'renderer', 'js');
const INDEX_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
const APP_TSX = path.join(__dirname, '..', '..', 'simulation', 'frontend', 'src', 'App.tsx');

function load(rel) {
  return fs.readFileSync(path.join(RENDERER, rel), 'utf8');
}

// --- Minimal DOM stub -------------------------------------------------------
function makeEl(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    title: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    value: '',
    src: '',
    id: '',
    contentWindow: { postMessage() {} },
    parentNode: null,
    firstChild: null,
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) {
      c.parentNode = this;
      this.children.push(c);
      if (!this.firstChild) this.firstChild = c;
      return c;
    },
    insertBefore(c) { return this.appendChild(c); },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      return c;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    click() {},
    getBoundingClientRect() { return { left: 0, top: 0 }; },
  };
}

const registry = {};
const STYLE_IDS = new Set(['sim-select-styles', 'send-to-sim-styles', 'sim-dark-viewport-style']);

const documentStub = {
  readyState: 'complete',
  getElementById(id) {
    // Style-injection guards must miss so injectors run (duplicates harmless).
    if (STYLE_IDS.has(id)) return null;
    if (!registry[id]) {
      registry[id] = makeEl('div');
      registry[id].id = id;
    }
    return registry[id];
  },
  createElement(tag) { return makeEl(tag); },
  head: makeEl('head'),
  addEventListener() {},
  removeEventListener() {},
  querySelector(sel) {
    // The LAB badge element; the MAP tab button is absent (no tab switching).
    if (sel === '#sim-left .panel-badge') {
      if (!registry[sel]) registry[sel] = makeEl('span');
      return registry[sel];
    }
    return null;
  },
  querySelectorAll() { return []; },
};

const windowStub = {
  location: { hostname: '127.0.0.1' },
  addEventListener() {},
  removeEventListener() {},
  __simSandboxSession: null,
  __simSandboxPayload: null,
};

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  window: windowStub,
  document: documentStub,
  // No backend in this test: every fetch (lab :8010, snapshots) fails fast.
  fetch: () => Promise.reject(new Error('no lab in unit test')),
  fakeMap: {
    doubleClickZoom: { disable() {} },
    getContainer: () => makeEl('div'),
    dragging: { enabled: () => false, disable() {}, enable() {} },
  },
};
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
for (const rel of [
  'data/event-bus.js',
  'map/selection-store.js',
  'sim/sim-embed.js',
  'map/send-to-sim.js',
  'map/sim-select.js',
  'sim/sim-tab.js',
]) {
  vm.runInContext(load(rel), ctx, { filename: rel });
}

function run(expr) {
  return vm.runInContext(expr, ctx, { filename: 'test-expr.js' });
}
function el(id) {
  return documentStub.getElementById(id);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let pass = 0;
function check(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then(
        () => { pass++; console.log('  PASS  ' + name); },
        (e) => { console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); process.exitCode = 1; },
      );
    }
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    console.error('  FAIL  ' + name + '\n        ' + (e && e.message));
    process.exitCode = 1;
  }
  return Promise.resolve();
}

async function main() {
  console.log('\n=== FORGE SELECTION LIFECYCLE ===\n');

  // Boot the real modules against the stub DOM. sim-tab init is skipped on
  // purpose (it fetches live services); the exported gate/session functions
  // under test are exercised directly.
  run('simEmbed.init(); sendToSim.init(); simSelect.init(fakeMap);');
  await sleep(20); // let send-to-sim's deferred auto-init settle

  await check('forge iframe URL carries slot=forge; sim carries slot=sim', () => {
    const srcs = run(`(function () {
      simEmbed.ensureLoaded('forge',
        { south: 18.64, north: 18.65, west: 79.57, east: 79.58,
          nodes: [{ node_id: 'N01' }], label: 'probe' }, 12);
      simEmbed.ensureLoaded('sim');
      return [simEmbed.getSlotInfo('forge').src, simEmbed.getSlotInfo('sim').src];
    })()`);
    assert.ok(srcs[0].includes('slot=forge'), 'forge src: ' + srcs[0]);
    assert.ok(srcs[0].includes('nodes=1'), 'forge src keeps allowlist: ' + srcs[0]);
    assert.ok(srcs[1].includes('slot=sim'), 'sim src: ' + srcs[1]);
  });

  await check('fresh state: gate up, RUN disabled, no badge numbers', async () => {
    run('selectionStore.clear(); simTab.updateGateState();');
    await sleep(30); // badge updaters defer one tick on clear
    assert.strictEqual(el('sim-gate-banner').style.display, 'flex');
    // Gate wording lives in index.html (also pinned by acceptance_s3 CHECK 1).
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    assert.ok(html.includes('Select nodes on the MAP tab first (SIM box tool)'));
    assert.strictEqual(el('btn-sim-run-scenario').disabled, true);
    assert.strictEqual(el('sim-select-badge').style.display, 'none');
    assert.strictEqual(el('send-to-sim-badge').style.display, 'none');
    assert.strictEqual(el('btn-send-to-sim').disabled, true);
    assert.notStrictEqual(el('forge-right').style.display, 'none', 'forge-right visible on fresh state');
  });

  await check('0-node selection: still gated, still no numbers', async () => {
    run(`selectionStore.set({ id: 'CUSTOM',
      bounds: [[18.64, 79.57], [18.65, 79.58]], nodeCount: 0, nodes: [] }, 'sim');
      simTab.updateGateState();`);
    await sleep(30);
    assert.strictEqual(el('sim-gate-banner').style.display, 'flex');
    assert.strictEqual(el('btn-sim-run-scenario').disabled, true);
    assert.strictEqual(el('sim-select-badge').style.display, 'none');
    assert.strictEqual(el('send-to-sim-badge').style.display, 'none');
    assert.strictEqual(el('btn-send-to-sim').disabled, true);
    assert.ok(el('sim-region-readout').textContent.includes('No region'));
  });

  await check('N-node selection: ungated, badges show the count', async () => {
    run(`selectionStore.set({ type: 'polygon', nodes: ['N01', 'N02', 'N03', 'N04'],
      sectorId: 'C4', bounds: [[18.642, 79.571], [18.645, 79.574]] }, 'sim');
      simTab.updateGateState();`);
    await sleep(30);
    assert.strictEqual(el('sim-gate-banner').style.display, 'none');
    assert.strictEqual(el('btn-sim-run-scenario').disabled, false);
    assert.strictEqual(el('sim-select-badge').style.display, 'inline-block');
    assert.strictEqual(el('sim-select-badge').textContent, '4');
    assert.strictEqual(el('send-to-sim-badge').style.display, 'inline-block');
    assert.strictEqual(el('send-to-sim-badge').textContent, '4');
    assert.strictEqual(el('btn-send-to-sim').disabled, false);
  });

  await check('session opens the dashboard, CLOSE releases everything', async () => {
    // A 3D-channel selection on the side: close must not touch it.
    run(`selectionStore.set({ type: 'polygon', nodes: ['N05', 'N06'],
      bounds: [[18.643, 79.572], [18.646, 79.575]] }, '3d');`);
    const payload = {
      id: 'CUSTOM', name: 'probe', nodeCount: 2,
      bounds: [[18.642, 79.571], [18.645, 79.574]],
      nodes: [{ node_id: 'N01' }, { node_id: 'N02' }],
    };
    await run('simTab.handleSandboxCreate(' + JSON.stringify(payload) + ')');
    assert.ok(run('simTab.getSandboxSession() && simTab.getSandboxSession().id'), 'session exists');
    assert.strictEqual(el('forge-right').style.display, '');
    assert.ok(el('sim-session-chip-container').innerHTML.includes('SANDBOX'));
    assert.strictEqual(el('btn-sim-close-session').disabled, false);

    // Detail card labels clone MEMBERSHIP, not mere session existence: a
    // health dot outside the selection must read MONITORED, never ISOLATED.
    run('simTab.selectNode("N01")');
    assert.ok(el('sim-active-node-detail-container').innerHTML.includes('(CLONED)'));
    assert.ok(el('sim-active-node-detail-container').innerHTML.includes('ISOLATED'));
    run('simTab.selectNode("N31")');
    assert.ok(el('sim-active-node-detail-container').innerHTML.includes('MONITORED'));
    assert.ok(!el('sim-active-node-detail-container').innerHTML.includes('CLONED'));

    run('simTab.closeSandboxSession();');
    await sleep(50); // badge updaters defer one tick on clear
    assert.strictEqual(run('simTab.getSandboxSession()'), null);
    assert.strictEqual(run('selectionStore.has("sim")'), false);
    assert.strictEqual(run('selectionStore.has("3d")'), true);
    assert.notStrictEqual(el('forge-right').style.display, 'none', 'forge-right dashboard stays visible after close');
    assert.strictEqual(el('sim-session-chip-container').innerHTML, '');
    assert.strictEqual(el('sim-gate-banner').style.display, 'flex');
    assert.strictEqual(el('btn-sim-run-scenario').disabled, true);
    assert.ok(el('sim-region-readout').textContent.includes('No region'));
    assert.strictEqual(el('sim-select-badge').style.display, 'none');
    assert.strictEqual(el('send-to-sim-badge').style.display, 'none');
    assert.strictEqual(el('btn-send-to-sim').disabled, true);
    assert.strictEqual(el('sim-nodes-count-badge').textContent, '0 CLONED');
    assert.ok(el('sim-inspector-body').innerHTML.includes('No nodes in active sandbox session'));
    run('simTab.selectNode("N01")');
    assert.ok(el('sim-active-node-detail-container').innerHTML.includes('MONITORED'),
      'no session => MONITORED');

    // Camera & selection reset contract (prevents view lock on forge close)
    const forgeSlot = run('simEmbed.getSlotInfo("forge")');
    assert.strictEqual(forgeSlot.clip, null, 'forge clip cleared on close');
    assert.strictEqual(forgeSlot.nodes, null, 'forge nodes cleared on close');
    assert.strictEqual(forgeSlot.label, null, 'forge label cleared on close');
    const cmds = run('simEmbed.getCommands("forge")');
    assert.ok(cmds.includes('recenter'), 'CLOSE posts recenter to reset camera to district overview');
  });

  await check('App.tsx: packet SYNCHRONIZED toast gated on slot (static pin)', () => {
    const appSrc = fs.readFileSync(APP_TSX, 'utf8');
    const toastIdx = appSrc.indexOf('SYNCHRONIZED');
    assert.ok(toastIdx > 0, 'SYNCHRONIZED toast text present');
    const windowBefore = appSrc.slice(Math.max(0, toastIdx - 800), toastIdx);
    assert.ok(/!== ['"]forge['"]/.test(windowBefore),
      'toast preceded by a !== \'forge\' slot guard');
  });

  console.log(process.exitCode ? `\n${pass} CHECK(S) PASSED, FAILURES ABOVE\n`
    : `\nALL ${pass} CHECKS PASSED\n`);
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
