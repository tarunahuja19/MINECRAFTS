'use strict';

/**
 * dashboard_electron/test/verify_forge_isolation.js
 *
 * FORGE is a private playground: it may read the live system but must never
 * write to it. Static pins (no browser needed):
 *
 *  1. The FORGE dashboard modules (sim-tab.js, sim-embed.js) never address the
 *     live engine (:8000) or the backend (:8080). Their only server is the
 *     Scenario Lab (:8010).
 *  2. App.tsx routes every engine write through guards on `engineReadOnly`
 *     (derived from isEngineReadOnly(embedParams)): sendWsAction, the on-connect
 *     set_speed / start, close-everything, and the embed auto-start.
 *  3. No raw ws.send / fetch("/control") in App.tsx outside those guards.
 *
 * The rule itself (forge slot => read-only) is exercised by
 * simulation/frontend/scripts/verify_embed_slot.mjs.
 *
 * Run with:  node test/verify_forge_isolation.js   (from dashboard_electron/)
 */

const fs = require('fs');
const path = require('path');

const SIM_JS = path.join(__dirname, '..', 'renderer', 'js', 'sim');
const APP_TSX = path.join(__dirname, '..', '..', 'simulation', 'frontend', 'src', 'App.tsx');

let fail = 0;
function ok(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) fail++;
}

// Strip // and /* */ comments so a doc comment mentioning a port is not a hit.
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

console.log('\n=== 1. FORGE dashboard modules never address the live system ===');
// sim-embed.js must have no :8000, no :8080, and no /control
const embedSrc = code(fs.readFileSync(path.join(SIM_JS, 'sim-embed.js'), 'utf8'));
ok(!/:8000\b/.test(embedSrc), 'sim-embed.js has no :8000 (engine) address');
ok(!/:8080\b/.test(embedSrc), 'sim-embed.js has no :8080 (backend) address');
ok(!/\/control\b/.test(embedSrc), 'sim-embed.js has no /control call');

// sim-tab.js must have no :8000, no /control, and its only :8080 access is read-only GET /api/simulation/status
const simSrc = code(fs.readFileSync(path.join(SIM_JS, 'sim-tab.js'), 'utf8'));
ok(!/:8000\b/.test(simSrc), 'sim-tab.js has no :8000 (engine) address');
ok(!/\/control\b/.test(simSrc), 'sim-tab.js has no /control call');

// Check that any path attached to :8080 or /api/simulation/ is strictly /api/simulation/status
const simApiPaths = (simSrc.match(/\/api\/simulation\/[a-zA-Z0-9_\/-]+/g) || []);
const invalidSimApiPaths = simApiPaths.filter(p => p !== '/api/simulation/status');
ok(simApiPaths.length > 0 && invalidSimApiPaths.length === 0,
  'sim-tab.js backend :8080 path is strictly /api/simulation/status');

// Check any full URL or port attachment with :8080 (e.g. :8080/path)
const port8080Paths = (simSrc.match(/:8080\/[a-zA-Z0-9_\/-]+/g) || []).map(s => s.replace(':8080', ''));
const invalid8080Paths = port8080Paths.filter(p => p !== '/api/simulation/status');
ok(invalid8080Paths.length === 0,
  'sim-tab.js has no :8080 path other than /api/simulation/status');

// Check that sim-tab.js never sends POST/PUT/DELETE/PATCH to :8080 or /api/simulation/status
const nonGetToward8080 = /fetch\s*\([^)]*(:8080|apiBase|\/api\/simulation\/status)[^)]*method\s*:\s*['"](POST|PUT|DELETE|PATCH)['"]/i.test(simSrc)
  || /fetch\s*\([^)]*method\s*:\s*['"](POST|PUT|DELETE|PATCH)['"][^)]*(:8080|apiBase|\/api\/simulation\/status)/i.test(simSrc);
ok(!nonGetToward8080, 'sim-tab.js uses only GET toward :8080');

// sim-embed.js must have no :8020 (forge math) address
ok(!/:8020\b/.test(embedSrc), 'sim-embed.js has no :8020 address');

// Check that any path attached to :8020 in sim-tab.js is only allowed paths
const port8020Paths = (simSrc.match(/:8020\/[a-zA-Z0-9_\/-]+/g) || []).map(s => s.replace(':8020', ''));
const invalid8020Paths = port8020Paths.filter(p => !['/forge/frame', '/forge/range', '/forge/seed', '/health'].includes(p));
ok(invalid8020Paths.length === 0,
  'sim-tab.js has no :8020 path other than /forge/frame, /forge/range, /forge/seed, /health');

// Check that sim-tab.js references /forge/ only with allowed paths
const simForgePaths = (simSrc.match(/\/forge\/[a-zA-Z0-9_\/-]+/g) || []);
const invalidSimForgePaths = simForgePaths.filter(p => !['/forge/frame', '/forge/range', '/forge/seed', '/health'].includes(p));
ok(simForgePaths.length > 0 && invalidSimForgePaths.length === 0,
  'sim-tab.js forge endpoints are strictly /forge/frame, /forge/range, /forge/seed, /health');

console.log('\n=== 2. App.tsx guards every engine write on engineReadOnly ===');
const app = fs.readFileSync(APP_TSX, 'utf8');
ok(/const engineReadOnly = isEngineReadOnly\(embedParams\);/.test(app),
  'engineReadOnly derives from isEngineReadOnly(embedParams)');
ok(/if\s*\(data\.t_sim\s*!==\s*undefined\)\s*\{\s*if\s*\(engineReadOnly\)\s*return;/.test(app),
  'App.tsx FORGE slot ignores live ticks');
ok(/const sendWsAction = \(payload: any\) => \{\s*if \(engineReadOnly\) return;/.test(app),
  'sendWsAction returns early for FORGE (covers start/pause/apply_*/reset/stop)');
ok(/if \(!engineReadOnly\) \{\s*ws\.send\(JSON\.stringify\(\{ action: "set_speed"/.test(app),
  'on-connect set_speed is skipped for FORGE');
ok(/if \(isRunningRef\.current && !engineReadOnly(?: && !isEmbed)?\) \{\s*ws\.send\(JSON\.stringify\(\{ action: "start" \}\)\)/.test(app),
  'on-connect start re-arm is skipped for FORGE');
ok(/const handleCloseEverything = async \(\) => \{\s*if \(engineReadOnly\) return;/.test(app),
  'close-everything (engine stop + DB wipe) is a no-op for FORGE');
ok(/if \(engineReadOnly\) \{\s*setIsRunning\(true\);\s*return;\s*\}/.test(app),
  'FORGE arms locally instead of auto-starting the engine');

console.log('\n=== 3. No unguarded engine writes in App.tsx ===');
const appCode = code(app);
const rawSends = (appCode.match(/\bws\.send\(|wsRef\.current\.send\(/g) || []).length;
ok(rawSends === 3, 'exactly 3 socket sends (set_speed, start re-arm, sendWsAction) — found ' + rawSends);
const controlPosts = (appCode.match(/fetch\("\/control"/g) || []).length;
ok(controlPosts === 1, 'exactly 1 POST /control (inside sendWsAction) — found ' + controlPosts);

console.log(fail === 0 ? '\nALL CHECKS PASSED\n' : '\n' + fail + ' CHECK(S) FAILED\n');
process.exit(fail ? 1 : 0);
