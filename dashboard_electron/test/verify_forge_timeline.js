'use strict';

/**
 * dashboard_electron/test/verify_forge_timeline.js
 *
 * Automated verification of the independent FORGE timeline driven by :8020 frames:
 * 1. Spawns its own :8020-code math server on port 8022 (FORGE_PORT overrides; 8021 is held by macOS launchd).
 * 2. Opens FORGE; verifies badge displays day and END >= 365.
 * 3. Tests slider scrub to day 10 and day 60: asserts forge-frame-applied matches
 *    direct POST /forge/frame math.
 * 4. Captures screenshots at day 5, day 40, and END.
 * 5. Tests PLAY at 20 d/s from day 340: advances, PAUSE holds for 3 s, resumes
 *    and auto-stops at END.
 * 6. Verifies request isolation: 0 requests to :8000/control, 0 to :8080/api/simulation/*
 *    except GET .../status.
 * 7. Switches to MAP and asserts 0 /forge/frame requests for 5 s.
 *
 * Run with:  node test/verify_forge_timeline.js
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpPut(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'PUT'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let respData = '';
      res.on('data', chunk => respData += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(respData)); } catch (e) { resolve(respData); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Same rule as App.tsx's forge-frame handler: the amp with the largest magnitude, sign kept.
function signedMaxAmp(perts) {
  let m = 0;
  for (const p of perts || []) {
    if (p && Number.isFinite(p.amp) && Math.abs(p.amp) > Math.abs(m)) m = p.amp;
  }
  return m;
}

async function run() {
  console.log('=====================================================');
  console.log('[TEST] FORGE TIMELINE DRIVEN BY :8020 MATH');
  console.log('=====================================================\n');

  const repoRoot = path.join(__dirname, '..', '..');
  const simDir = path.join(repoRoot, 'simulation');
  const pythonBin = path.join(simDir, '.venv', 'bin', 'python');
  const imgDir = path.join(repoRoot, 'walkthroughs', 'forge-v2', 'img');
  if (!fs.existsSync(imgDir)) {
    fs.mkdirSync(imgDir, { recursive: true });
  }

  // 1. Start our own forge server on :8022 (FORGE_PORT overrides; an already-running one on that port is reused)
  const forgePort = process.env.FORGE_PORT || 8022;
  let startedOurOwn = false;
  let forgeProc = null;

  let isRunning = false;
  try {
    await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${forgePort}/health`, (r) => {
        if (r.statusCode === 200) resolve();
        else reject(new Error('Status ' + r.statusCode));
      }).on('error', reject);
    });
    isRunning = true;
  } catch (_) {}

  if (isRunning) {
    console.log(`[STEP 1] Using running forge math server on http://127.0.0.1:${forgePort}`);
  } else {
    console.log(`[STEP 1] Starting forge math server on port ${forgePort}...`);
    forgeProc = spawn(pythonBin, ['-m', 'uvicorn', 'forge.server:app', '--host', '127.0.0.1', '--port', String(forgePort)], {
      cwd: simDir,
      stdio: 'ignore'
    });
    startedOurOwn = true;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${forgePort}/health`, (r) => {
            if (r.statusCode === 200) resolve();
            else reject(new Error('Status ' + r.statusCode));
          }).on('error', reject);
        });
        isRunning = true;
        break;
      } catch (_) {}
    }
    if (!isRunning) {
      if (forgeProc) try { forgeProc.kill('SIGTERM'); } catch (_) {}
      throw new Error(`Port ${forgePort} forge server failed to start`);
    }
    console.log(`  PASS  Forge math server running on http://127.0.0.1:${forgePort}`);
  }

  const cleanupForge = () => {
    if (startedOurOwn && forgeProc) {
      try { forgeProc.kill('SIGTERM'); } catch (_) {}
    }
  };
  process.on('exit', cleanupForge);
  process.on('SIGINT', cleanupForge);

  // 2. Launch headless Chrome with CDP
  console.log('[STEP 2] Launching headless browser...');
  const tempProfile = `/tmp/chrome_forge_timeline_${Date.now()}`;
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--use-gl=angle',
    '--enable-webgl',
    '--remote-debugging-port=9226',
    `--user-data-dir=${tempProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1400,900',
    'about:blank'
  ]);

  const cleanupAll = () => {
    cleanupForge();
    try { chromeProc.kill('SIGKILL'); } catch (_) {}
    try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  };

  let cdpReady = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9226/json/version', (r) => {
          if (r.statusCode === 200) resolve();
          else reject(new Error('Status ' + r.statusCode));
        }).on('error', reject);
      });
      cdpReady = true;
      break;
    } catch (_) {}
  }
  if (!cdpReady) {
    cleanupAll();
    throw new Error('Chrome debugging port 9226 failed to respond');
  }

  const targetUrl = `http://localhost:8085/renderer/index.html?forge_port=${forgePort}`;
  const newPage = await httpPut(`http://127.0.0.1:9226/json/new?${encodeURIComponent(targetUrl)}`);
  const ws = new WebSocket(newPage.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  const consoleLogs = [];

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
      consoleLogs.push(text);
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  });

  await new Promise(resolve => ws.on('open', resolve));

  function sendCmd(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression, awaitPromise = true) {
    const res = await sendCmd('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  async function captureScreenshot(filePath) {
    const res = await sendCmd('Page.captureScreenshot', { format: 'png' });
    if (res && res.data) {
      fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
      console.log(`  [SCREENSHOT] Saved ${path.basename(filePath)} (${Math.round(res.data.length * 0.75 / 1024)} KB)`);
    }
  }

  await sendCmd('Page.enable');
  await sendCmd('Runtime.enable');
  await sendCmd('Console.enable');

  console.log('[STEP 3] Booting dashboard and installing request/event hooks...');
  await sleep(3500);

  // Install network spy and forge-frame-applied listener inside the browser context
  await evaluate(`
    (function() {
      window.__requestsTo8000Control = 0;
      window.__requestsTo8080Forbidden = 0;
      window.__requestsTo8080Status = 0;
      window.__forbidden8080List = [];
      window.__forgeFrameRequestCount = 0;
      window.__forgeFrameAppliedEvents = [];

      var origFetch = window.fetch;
      window.fetch = function(url, opts) {
        var strUrl = String(url || '');
        var method = (opts && opts.method ? opts.method : 'GET').toUpperCase();

        if (strUrl.indexOf(':8000/control') !== -1 || strUrl.indexOf('/control') !== -1) {
          window.__requestsTo8000Control++;
        }
        if (strUrl.indexOf('/api/simulation/') !== -1) {
          if (strUrl.indexOf('/api/simulation/status') !== -1 && method === 'GET') {
            window.__requestsTo8080Status++;
          } else {
            window.__requestsTo8080Forbidden++;
            window.__forbidden8080List.push(method + ' ' + strUrl);
          }
        }
        if (strUrl.indexOf('/forge/frame') !== -1) {
          window.__forgeFrameRequestCount++;
        }

        return origFetch.apply(this, arguments);
      };

      window.addEventListener('message', function(e) {
        if (e.data && e.data.event === 'forge-frame-applied') {
          window.__forgeFrameAppliedEvents.push(e.data);
        }
      });
    })()
  `);

  // Switch to FORGE tab
  console.log('[STEP 4] Opening FORGE tab...');
  await evaluate(`
    (function() {
      var btn = document.querySelector('button.tab-btn[data-tab="forge"]');
      if (btn) btn.click();
    })()
  `);

  // Wait for FORGE initialization & seed (up to 6s)
  let badgeInfo = null;
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    badgeInfo = await evaluate(`
      (function() {
        var b = document.getElementById('forge-day-badge');
        var slider = document.getElementById('forge-day-slider');
        return {
          text: b ? b.textContent.trim() : '',
          day: b ? b.dataset.day : null,
          endDay: b ? b.dataset.endDay : null,
          sliderMax: slider ? slider.max : null,
          sliderVal: slider ? slider.value : null
        };
      })()
    `);
    if (badgeInfo && badgeInfo.text.indexOf('FORGE · Day') !== -1 && Number(badgeInfo.endDay) >= 365) {
      break;
    }
  }

  console.log('  Badge text:', badgeInfo.text);
  if (!(Number(badgeInfo.endDay) >= 365)) {
    cleanupAll();
    throw new Error(`Expected badge to show END >= 365; got "${badgeInfo.text}" (endDay: ${badgeInfo.endDay})`);
  }
  const note = await evaluate(`document.getElementById('forge-badge-note').textContent`);
  console.log('  Badge note:', JSON.stringify(note));
  const forgeEvents = await evaluate(`window.simTab.getForgeState().events`);
  console.log(`  FORGE events after seed: ${forgeEvents.length}`);
  console.log(`  PASS  FORGE opened: badge shows a day and END = ${badgeInfo.endDay}`);

  // Step 5: Test slider scrub to day 10 and day 60
  console.log('\n[STEP 5] Scrubbing slider to day 10...');
  await evaluate(`
    (function() {
      var s = document.getElementById('forge-day-slider');
      s.value = '10';
      s.dispatchEvent(new Event('input'));
    })()
  `);

  let applied10 = null;
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    applied10 = await evaluate(`
      (function() {
        var evs = window.__forgeFrameAppliedEvents || [];
        for (var i = evs.length - 1; i >= 0; i--) {
          if (Math.abs(evs[i].t_days - 10) < 0.05) return evs[i];
        }
        return null;
      })()
    `);
    if (applied10) break;
  }
  if (!applied10) {
    cleanupAll();
    throw new Error('No forge-frame-applied event received for day 10');
  }

  const directFrame10 = await httpPost(`http://127.0.0.1:${forgePort}/forge/frame`, {
    day: 10,
    events: forgeEvents,
    include_grids: false
  });
  const directMaxAmp10 = signedMaxAmp(directFrame10.perturbations);
  const directPerts10 = directFrame10.perturbations.length;

  console.log(`  Day 10 frame: applied { t_days: ${applied10.t_days}, time_scalar: ${applied10.time_scalar}, perturbations: ${applied10.perturbations}, max_amp: ${applied10.max_amp} }`);
  console.log(`  Day 10 direct:  { t_days: ${directFrame10.t_days}, time_scalar: ${directFrame10.time_scalar}, perturbations: ${directPerts10}, max_amp: ${directMaxAmp10}, max_subsidence_m: ${directFrame10.terrain.max_subsidence_m} }`);
  if (Math.abs(applied10.t_days - 10) > 0.05 || applied10.time_scalar !== directFrame10.time_scalar
      || applied10.perturbations !== directPerts10 || applied10.max_amp !== directMaxAmp10) {
    cleanupAll();
    throw new Error(`Day 10 frame mismatch vs direct math: applied=${JSON.stringify(applied10)}, directPerts=${directPerts10}`);
  }
  console.log(`  PASS  Day 10 applied frame matches direct :${forgePort} math`);

  console.log('\n[STEP 6] Scrubbing slider to day 60...');
  await evaluate(`
    (function() {
      var s = document.getElementById('forge-day-slider');
      s.value = '60';
      s.dispatchEvent(new Event('input'));
    })()
  `);

  let applied60 = null;
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    applied60 = await evaluate(`
      (function() {
        var evs = window.__forgeFrameAppliedEvents || [];
        for (var i = evs.length - 1; i >= 0; i--) {
          if (Math.abs(evs[i].t_days - 60) < 0.05) return evs[i];
        }
        return null;
      })()
    `);
    if (applied60) break;
  }
  if (!applied60) {
    cleanupAll();
    throw new Error('No forge-frame-applied event received for day 60');
  }

  const directFrame60 = await httpPost(`http://127.0.0.1:${forgePort}/forge/frame`, {
    day: 60,
    events: forgeEvents,
    include_grids: false
  });
  const directMaxAmp60 = signedMaxAmp(directFrame60.perturbations);
  const directPerts60 = directFrame60.perturbations.length;

  console.log(`  Day 60 frame: applied { t_days: ${applied60.t_days}, time_scalar: ${applied60.time_scalar}, perturbations: ${applied60.perturbations}, max_amp: ${applied60.max_amp} }`);
  console.log(`  Day 60 direct:  { t_days: ${directFrame60.t_days}, time_scalar: ${directFrame60.time_scalar}, perturbations: ${directPerts60}, max_amp: ${directMaxAmp60}, max_subsidence_m: ${directFrame60.terrain.max_subsidence_m} }`);
  if (Math.abs(applied60.t_days - 60) > 0.05 || applied60.time_scalar !== directFrame60.time_scalar
      || applied60.perturbations !== directPerts60 || applied60.max_amp !== directMaxAmp60) {
    cleanupAll();
    throw new Error(`Day 60 frame mismatch vs direct math: applied=${JSON.stringify(applied60)}, directPerts=${directPerts60}`);
  }
  console.log(`  PASS  Day 60 applied frame matches direct :${forgePort} math`);

  // Step 7: Screenshots at day 5, day 40, and END
  console.log('\n[STEP 7] Capturing screenshots (day 5, day 40)...');
  await evaluate(`
    (function() {
      var s = document.getElementById('forge-day-slider');
      s.value = '5';
      s.dispatchEvent(new Event('input'));
    })()
  `);
  await sleep(600);
  await captureScreenshot(path.join(imgDir, 'forge-day-5.png'));

  await evaluate(`
    (function() {
      var s = document.getElementById('forge-day-slider');
      s.value = '40';
      s.dispatchEvent(new Event('input'));
    })()
  `);
  await sleep(600);
  await captureScreenshot(path.join(imgDir, 'forge-day-40.png'));

  // Step 8: PLAY at 20 d/s from day 340 with PAUSE mid-way (holds for 3s), then auto-stop at END
  console.log('\n[STEP 8] Testing PLAY at 20 d/s from day 340 with PAUSE hold...');
  // Select 20 d/s
  await evaluate(`
    (function() {
      var btn20 = document.querySelector('.forge-speed-btn[data-speed="20"]');
      if (btn20) btn20.click();
      var s = document.getElementById('forge-day-slider');
      s.value = '340';
      s.dispatchEvent(new Event('input'));
    })()
  `);
  await sleep(400);

  // Click PLAY
  console.log('  Starting PLAY from day 340...');
  await evaluate(`document.getElementById('forge-play-btn').click();`);

  // Let it play for ~250ms to advance
  await sleep(250);
  const statePlaying = await evaluate(`window.simTab.getForgeState()`);
  console.log(`  Advancing: current day is ${statePlaying.day.toFixed(2)} (playing: ${statePlaying.playing})`);
  if (statePlaying.day <= 340) {
    cleanupAll();
    throw new Error(`Expected day to advance beyond 340, but is ${statePlaying.day}`);
  }

  // Click PAUSE mid-way
  console.log('  Clicking PAUSE mid-way...');
  await evaluate(`document.getElementById('forge-play-btn').click();`);
  const pausedState = await evaluate(`window.simTab.getForgeState()`);
  const dayAtPause = pausedState.day;
  console.log(`  Paused at day ${dayAtPause.toFixed(2)}. Waiting 3 seconds to verify it holds...`);

  await sleep(3000);
  const after3sState = await evaluate(`window.simTab.getForgeState()`);
  console.log(`  After 3s hold: day is ${after3sState.day.toFixed(2)}`);
  if (Math.abs(after3sState.day - dayAtPause) > 0.05) {
    cleanupAll();
    throw new Error(`Day moved during PAUSE: was ${dayAtPause}, now ${after3sState.day}`);
  }
  console.log('  PASS  PAUSE held day static for 3 s');

  // Resume PLAY to END (365)
  console.log('  Resuming PLAY to END (365)...');
  await evaluate(`document.getElementById('forge-play-btn').click();`);

  // Wait until it reaches 365 and stops by itself (at 20 d/s, remaining ~25 days takes ~1.25s)
  let stoppedAtEnd = false;
  let finalForgeState = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    finalForgeState = await evaluate(`
      (function() {
        var st = window.simTab.getForgeState();
        var btn = document.getElementById('forge-play-btn');
        return {
          day: st.day,
          endDay: st.endDay,
          playing: st.playing,
          btnText: btn ? btn.textContent.trim() : ''
        };
      })()
    `);
    if (finalForgeState && Math.abs(finalForgeState.day - finalForgeState.endDay) < 0.1 && !finalForgeState.playing) {
      stoppedAtEnd = true;
      break;
    }
  }

  if (!stoppedAtEnd) {
    cleanupAll();
    throw new Error(`Did not auto-stop at END: ${JSON.stringify(finalForgeState)}`);
  }
  console.log(`  Stopped at END: day=${finalForgeState.day.toFixed(1)} / ${finalForgeState.endDay}, btn="${finalForgeState.btnText}"`);
  console.log('  PASS  PLAY at 20 d/s advanced smoothly and auto-stopped at END');

  // Screenshot at END
  await sleep(400);
  await captureScreenshot(path.join(imgDir, 'forge-day-end.png'));

  // Step 9: Verify request isolation
  console.log('\n[STEP 9] Verifying backend request isolation...');
  const netStats = await evaluate(`
    ({
      to8000Control: window.__requestsTo8000Control,
      to8080Forbidden: window.__requestsTo8080Forbidden,
      to8080Status: window.__requestsTo8080Status,
      forbiddenList: window.__forbidden8080List
    })
  `);
  console.log('  Request summary during test:', netStats);
  if (netStats.to8000Control !== 0) {
    cleanupAll();
    throw new Error(`Found ${netStats.to8000Control} requests to :8000/control! Forbidden!`);
  }
  if (netStats.to8080Forbidden !== 0) {
    cleanupAll();
    throw new Error(`Found ${netStats.to8080Forbidden} forbidden requests to :8080/api/simulation/*: ${JSON.stringify(netStats.forbiddenList)}`);
  }
  console.log('  PASS  Zero requests to :8000/control and strictly zero non-status requests to :8080/api/simulation/*');

  // Step 10: Switch to MAP and verify no /forge/frame requests for 5 s
  console.log('\n[STEP 10] Switching to MAP tab and observing for 5 s...');
  const frameReqsBeforeMap = await evaluate(`window.__forgeFrameRequestCount`);
  await evaluate(`
    (function() {
      var btnMap = document.querySelector('button.tab-btn[data-tab="map"]');
      if (btnMap) btnMap.click();
    })()
  `);

  console.log(`  Initial /forge/frame count: ${frameReqsBeforeMap}. Sleeping 5 seconds...`);
  await sleep(5000);
  const frameReqsAfterMap = await evaluate(`window.__forgeFrameRequestCount`);
  console.log(`  /forge/frame count after 5s on MAP: ${frameReqsAfterMap}`);
  if (frameReqsAfterMap !== frameReqsBeforeMap) {
    cleanupAll();
    throw new Error(`Leaked ${frameReqsAfterMap - frameReqsBeforeMap} /forge/frame requests while on MAP tab!`);
  }
  console.log('  PASS  Zero /forge/frame requests for 5 s while away on MAP tab');

  cleanupAll();
  console.log('\n=====================================================');
  console.log('ALL FORGE TIMELINE VERIFICATION CHECKS PASSED');
  console.log('=====================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
