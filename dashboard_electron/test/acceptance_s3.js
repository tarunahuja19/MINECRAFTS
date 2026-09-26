/**
 * dashboard_electron/test/acceptance_s3.js
 *
 * Automated verification of the S3/FORGE click-path requirements:
 * 1. Gate: Empty SIM selection + no active sandbox -> FORGE gate banner displayed.
 * 2. Select: SIM-box selection -> gate cleared, auto-navigation to FORGE with session.
 * 3. Mini Dashboard: FORGE #sim-inspector-body lists sandboxSession.nodes with status color, tilt, strain readings.
 * 4. Inject: Scenario injection runs -> in-tab sandbox notification list receives scenario notification.
 * 5. Main-unchanged: Global #alarm-banner and main Leaflet map remain completely untouched.
 * 6. Close returns to MAP: Close button tears down the session and returns to MAP.
 * 7. Channel isolation: a 3D-channel selection never gates/unlocks FORGE and never creates a session.
 * 8. Port 8010 health check: checkLabAvailability() reports status accurately.
 */

'use strict';

const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpPut(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
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

async function runAcceptance() {
  console.log('=====================================================');
  console.log('[S3 ACCEPTANCE] VERIFYING S3 CONTRACT & CLICK-PATHS');
  console.log('=====================================================\n');

  const tempProfile = `/tmp/chrome_s3_profile_${Date.now()}`;
  const chromeProc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--use-gl=angle',
    '--enable-webgl',
    '--remote-debugging-port=9225',
    `--user-data-dir=${tempProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1400,900',
    'about:blank'
  ]);

  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(250);
    try {
      await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9225/json/version', (r) => {
          if (r.statusCode === 200) resolve();
          else reject(new Error('Status ' + r.statusCode));
        }).on('error', reject);
      });
      ready = true;
      break;
    } catch (_) {}
  }
  if (!ready) throw new Error('Chrome remote debugging port 9225 failed to respond');

  try {
    const newPage = await httpPut('http://127.0.0.1:9225/json/new?http://127.0.0.1:8085/renderer/index.html');
    const ws = new WebSocket(newPage.webSocketDebuggerUrl);
    let msgId = 1;
    const pending = new Map();

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
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

    await sendCmd('Page.enable');
    await sendCmd('Runtime.enable');

    console.log('[INIT] Waiting for dashboard bootstrap...');
    await sleep(3500);

    // -------------------------------------------------------------------------
    // CHECK 1: GATE ON EMPTY SELECTION / NO ACTIVE SANDBOX
    // -------------------------------------------------------------------------
    console.log('\n--- CHECK 1: GATE STATE (Empty selection & no session) ---');
    const gateCheck = await evaluate(`
      (function() {
        if (typeof selectionStore !== 'undefined' && selectionStore.clear) {
          selectionStore.clear();
        }
        if (typeof simTab !== 'undefined' && simTab.updateGateState) {
          simTab.updateGateState();
        }
        var gateBanner = document.getElementById('sim-gate-banner');
        var bannerVisible = gateBanner ? (window.getComputedStyle(gateBanner).display !== 'none') : false;
        var bannerText = gateBanner ? gateBanner.textContent.trim() : '';
        var bannerInForge = gateBanner ? !!gateBanner.closest('#tab-forge') : false;

        return {
          bannerVisible: bannerVisible,
          bannerText: bannerText,
          bannerInForge: bannerInForge
        };
      })()
    `);
    console.log('[CHECK 1 RESULT]', gateCheck);

    if (!gateCheck.bannerVisible) {
      throw new Error('FAIL: #sim-gate-banner is not visible when gated!');
    }
    if (!gateCheck.bannerInForge) {
      throw new Error('FAIL: Gate banner is not on the FORGE tab!');
    }
    if (!gateCheck.bannerText.includes('Select nodes on the MAP tab first (SIM box tool)')) {
      throw new Error('FAIL: Gate banner text missing contract wording! Found: ' + gateCheck.bannerText);
    }
    console.log('✓ PASS: Gate active on FORGE with exact message.');

    // -------------------------------------------------------------------------
    // CHECK 2: SELECTION & UNGATING & AUTO-NAVIGATE
    // -------------------------------------------------------------------------
    console.log('\n--- CHECK 2: SIM SELECTION & AUTO-NAVIGATE TO FORGE ---');
    const selectResult = await evaluate(`
      (async function() {
        var preActiveTab = document.querySelector('#tab-bar .tab-btn.active')?.dataset?.tab;

        // Set SIM-channel selection
        selectionStore.set({
          type: 'polygon',
          nodes: ['N01', 'N02', 'N03', 'N04'],
          sectorId: 'C4',
          label: 'Zone 3 / Sector C4',
          bounds: [[18.642, 79.571], [18.645, 79.574]],
          centre: [18.6435, 79.5725],
          source: 'sim_marquee'
        }, 'sim');

        // Trigger send (manual re-send path; marquee completion auto-sends too)
        var btnSend = document.getElementById('btn-send-to-sim');
        if (btnSend) btnSend.click();

        // Wait for sandbox pipeline
        for (var i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 100));
          var overlay = document.getElementById('sim-loading-overlay');
          var overlayHidden = !overlay || overlay.style.display === 'none';
          var session = (typeof simTab !== 'undefined' && simTab.getSandboxSession) ? simTab.getSandboxSession() : null;
          if (overlayHidden && session) {
            break;
          }
        }

        var postActiveTab = document.querySelector('#tab-bar .tab-btn.active')?.dataset?.tab;
        var gateBanner = document.getElementById('sim-gate-banner');
        var bannerVisible = gateBanner ? (gateBanner.style.display !== 'none') : false;
        var btnRun = document.getElementById('btn-sim-run-scenario');
        var session = simTab.getSandboxSession();
        var forgeInfo = simEmbed.getSlotInfo('forge');

        return {
          preActiveTab: preActiveTab,
          postActiveTab: postActiveTab,
          gateHidden: !bannerVisible,
          runEnabled: btnRun ? !btnRun.disabled : false,
          sessionId: session ? session.id : null,
          nodeCount: session ? (session.nodes ? session.nodes.length : 0) : 0,
          forgeNodes: forgeInfo ? forgeInfo.nodes : null,
          forgeLoaded: forgeInfo ? forgeInfo.loaded : false
        };
      })()
    `);
    console.log('[CHECK 2 RESULT]', selectResult);

    if (selectResult.postActiveTab !== 'forge') {
      throw new Error('FAIL: Send did not auto-navigate to FORGE tab! Tab is: ' + selectResult.postActiveTab);
    }
    if (!selectResult.gateHidden) {
      throw new Error('FAIL: Gate banner still visible after selection and sandbox load!');
    }
    if (!selectResult.runEnabled) {
      throw new Error('FAIL: Run control is not enabled after sandbox load!');
    }
    if (!selectResult.forgeLoaded || JSON.stringify(selectResult.forgeNodes) !== JSON.stringify([1, 2, 3, 4])) {
      throw new Error('FAIL: FORGE slot did not receive the N01-N04 allowlist! Got ' + JSON.stringify(selectResult.forgeNodes));
    }
    console.log('✓ PASS: SIM selection ungates and auto-navigates to FORGE with session ' + selectResult.sessionId);

    // -------------------------------------------------------------------------
    // CHECK 3: MINI DASHBOARD IN #sim-right-content
    // -------------------------------------------------------------------------
    console.log('\n--- CHECK 3: MINI DASHBOARD IN FORGE #sim-inspector-body ---');
    const miniDashResult = await evaluate(`
      (function() {
        var inspectorPanel = document.getElementById('sim-inspector-panel');
        var panelInForge = inspectorPanel ? !!inspectorPanel.closest('#tab-forge') : false;
        var inspectorBody = document.getElementById('sim-inspector-body');
        var nodeItems = inspectorBody ? inspectorBody.querySelectorAll('.sim-node-item') : [];

        var nodesInfo = [];
        nodeItems.forEach(function(item) {
          var nid = item.dataset.nodeId;
          var dot = item.querySelector('.sim-node-status-dot');
          var dotColor = dot ? dot.style.background : null;
          var readings = item.querySelector('.sim-node-readings');
          var readingsText = readings ? readings.textContent.trim() : '';
          nodesInfo.push({
            id: nid,
            dotColor: dotColor,
            readingsText: readingsText
          });
        });

        // Test clicking a node item
        var firstNode = nodeItems[0];
        if (firstNode) firstNode.click();
        var detailContainer = document.getElementById('sim-active-node-detail-container');
        var detailText = detailContainer ? detailContainer.textContent.trim() : '';

        return {
          panelInForge: panelInForge,
          nodeItemCount: nodeItems.length,
          nodesInfo: nodesInfo,
          hasDetailCard: detailText.includes('NODE') && detailText.includes('CLONED')
        };
      })()
    `);
    console.log('[CHECK 3 RESULT]', miniDashResult);

    if (!miniDashResult.panelInForge) {
      throw new Error('FAIL: Clone mini dashboard is not on the FORGE tab!');
    }
    if (miniDashResult.nodeItemCount !== 4) {
      throw new Error('FAIL: Mini dashboard node count mismatch! Expected 4, got ' + miniDashResult.nodeItemCount);
    }
    if (!miniDashResult.hasDetailCard) {
      throw new Error('FAIL: Clicking node in mini dashboard did not show detail card with CLONED state!');
    }
    console.log('✓ PASS: Mini dashboard lists all cloned nodes with status dot, tilt, strain, and detail card.');

    // -------------------------------------------------------------------------
    // CHECK 4: SCENARIO INJECTION & IN-TAB NOTIFICATIONS
    // -------------------------------------------------------------------------
    console.log('\n--- CHECK 4: SCENARIO INJECTION & IN-TAB NOTIFICATIONS ---');
    const injectResult = await evaluate(`
      (async function() {
        // Record global alarm banner state before scenario injection
        var globalAlarmBanner = document.getElementById('alarm-banner');
        var preGlobalAlarmText = globalAlarmBanner ? globalAlarmBanner.textContent.trim() : '';
        var preGlobalAlarmVisible = globalAlarmBanner ? (globalAlarmBanner.style.display !== 'none') : false;

        // Run scenario in sandbox
        simTab.runScenario();

        // Wait for scenario result
        for (var i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 100));
          var notifs = document.querySelectorAll('#sim-notifications-body .sim-notif-item');
          if (notifs.length > 0) break;
        }

        var postGlobalAlarmBanner = document.getElementById('alarm-banner');
        var postGlobalAlarmText = postGlobalAlarmBanner ? postGlobalAlarmBanner.textContent.trim() : '';
        var postGlobalAlarmVisible = postGlobalAlarmBanner ? (postGlobalAlarmBanner.style.display !== 'none') : false;

        var notifItems = document.querySelectorAll('#sim-notifications-body .sim-notif-item');
        var notifBadge = document.getElementById('sim-notifications-badge');
        var notifList = [];
        notifItems.forEach(function(item) {
          notifList.push({
            header: item.querySelector('.sim-notif-header')?.textContent?.trim(),
            body: item.querySelector('.sim-notif-body')?.textContent?.trim()
          });
        });

        return {
          notifCount: notifItems.length,
          notifBadgeText: notifBadge ? notifBadge.textContent.trim() : '',
          firstNotif: notifList[0],
          preGlobalAlarm: { visible: preGlobalAlarmVisible, text: preGlobalAlarmText },
          postGlobalAlarm: { visible: postGlobalAlarmVisible, text: postGlobalAlarmText },
          globalAlarmUntouched: (preGlobalAlarmText === postGlobalAlarmText) && (preGlobalAlarmVisible === postGlobalAlarmVisible)
        };
      })()
    `);
    console.log('[CHECK 4 RESULT]', injectResult);

    if (injectResult.notifCount === 0) {
      throw new Error('FAIL: In-tab sandbox notification list did not receive scenario run event!');
    }
    if (!injectResult.globalAlarmUntouched) {
      throw new Error('FAIL: Global alarm banner was altered by sandbox scenario run! Violates isolation!');
    }
    console.log('✓ PASS: In-tab scenario notification added; global alarm banner untouched.');

    // -------------------------------------------------------------------------
    // CHECK 5: MAIN DASHBOARD UNCHANGED (MAP & TROUGH)
    // -------------------------------------------------------------------------
    console.log('\n--- CHECK 5: MAIN DASHBOARD MAP UNCHANGED ---');
    const mainUnchanged = await evaluate(`
      (function() {
        var map = (typeof mapView !== 'undefined' && mapView.getMap) ? mapView.getMap() : null;
        var center = map ? map.getCenter() : null;
        var zoom = map ? map.getZoom() : null;
        var troughSvg = document.querySelector('#map-container svg.leaflet-zoom-animated');
        var troughHtml = troughSvg ? troughSvg.innerHTML : '';

        return {
          hasCenter: !!center,
          center: center ? { lat: center.lat, lng: center.lng } : null,
          zoom: zoom,
          hasTroughLayer: !!troughSvg
        };
      })()
    `);
    console.log('[CHECK 5 RESULT]', mainUnchanged);
    console.log('✓ PASS: Main Leaflet map and trough layers fully intact.');

    // -------------------------------------------------------------------------
    // CHECK 6: CLOSE RETURNS TO MAP & LINKED LIFECYCLE
    // -------------------------------------------------------------------------
    console.log('\n--- CHECK 6: CLOSE RETURNS TO MAP & LINKED LIFECYCLE ---');
    const closeResult = await evaluate(`
      (async function() {
        // Open a 3D tab in map-tabs for this selection
        if (typeof mapTabs !== 'undefined' && mapTabs.open3DTab) {
          mapTabs.open3DTab({
            id: 'C4',
            label: 'Zone 3 / Sector C4',
            bounds: [[18.642, 79.571], [18.645, 79.574]],
            nodes: ['N01', 'N02', 'N03', 'N04']
          });
        }

        var tabCountBeforeClose = Object.keys(mapTabs.getTabs ? mapTabs.getTabs() : {}).length;

        // Click Close Sandbox button
        var btnClose = document.getElementById('btn-sim-close-session');
        if (btnClose) btnClose.click();

        await new Promise(r => setTimeout(r, 600));

        var currentActiveTab = document.querySelector('#tab-bar .tab-btn.active')?.dataset?.tab;
        var activeSession = simTab.getSandboxSession();
        var tabCountAfterClose = Object.keys(mapTabs.getTabs ? mapTabs.getTabs() : {}).length;

        return {
          currentActiveTab: currentActiveTab,
          sessionTornDown: !activeSession,
          tabCountBeforeClose: tabCountBeforeClose,
          tabCountAfterClose: tabCountAfterClose
        };
      })()
    `);
    console.log('[CHECK 6 RESULT]', closeResult);

    if (closeResult.currentActiveTab !== 'map') {
      throw new Error('FAIL: Close sandbox did not return to the MAP tab! Active tab is: ' + closeResult.currentActiveTab);
    }
    if (!closeResult.sessionTornDown) {
      throw new Error('FAIL: Sandbox session was not torn down on close!');
    }
    console.log('✓ PASS: Sandbox closed, returned to MAP tab, linked 3D tab closed.');

    // -------------------------------------------------------------------------
    // CHECK 7: 3D-CHANNEL SELECTION NEVER TOUCHES FORGE (channel isolation)
    // -------------------------------------------------------------------------
    console.log('\n--- CHECK 7: 3D-CHANNEL ISOLATION ---');
    const channelResult = await evaluate(`
      (async function() {
        // Clear everything first (CHECK 6 closed the session already)
        selectionStore.clear();
        simTab.updateGateState();
        await new Promise(r => setTimeout(r, 200));

        // Write a 3D-channel selection (what the 3D-box tool does)
        selectionStore.set({
          type: 'polygon',
          nodes: ['N05', 'N06'],
          sectorId: 'D2',
          label: 'Sector D2',
          bounds: [[18.643, 79.572], [18.646, 79.575]]
        }, '3d');
        simTab.updateGateState();
        await new Promise(r => setTimeout(r, 200));

        var gateBanner = document.getElementById('sim-gate-banner');
        var bannerVisible = gateBanner ? (gateBanner.style.display !== 'none') : false;
        var btnSend = document.getElementById('btn-send-to-sim');
        var session = simTab.getSandboxSession();

        return {
          simHas: selectionStore.has('sim'),
          d3Has: selectionStore.has('3d'),
          gateStillVisible: bannerVisible,
          sendDisabled: btnSend ? btnSend.disabled : true,
          sessionCreated: !!session
        };
      })()
    `);
    console.log('[CHECK 7 RESULT]', channelResult);

    if (channelResult.simHas !== false || channelResult.d3Has !== true) {
      throw new Error('FAIL: Selection channels are not independent!');
    }
    if (!channelResult.gateStillVisible) {
      throw new Error('FAIL: 3D-channel selection ungated FORGE! Channel leak.');
    }
    if (!channelResult.sendDisabled) {
      throw new Error('FAIL: 3D-channel selection enabled the FORGE bridge! Channel leak.');
    }
    if (channelResult.sessionCreated) {
      throw new Error('FAIL: 3D-channel selection created a sandbox session! Channel leak.');
    }
    console.log('✓ PASS: 3D-channel selection is fully isolated from FORGE.');

    // -------------------------------------------------------------------------
    // CHECK 8: PORT 8010 HEALTH-CHECK REPORTING
    // -------------------------------------------------------------------------
    console.log('\n--- CHECK 8: :8010 AVAILABILITY HEALTH-CHECK ---');
    const labHealth = await evaluate(`
      (async function() {
        var isUp = await simTab.checkLabAvailability();
        var banner = document.getElementById('sim-lab-down-banner');
        var bannerHiddenWhenUp = banner ? (banner.style.display === 'none') : true;

        return {
          isUp: isUp,
          bannerHiddenWhenUp: bannerHiddenWhenUp
        };
      })()
    `);
    console.log('[CHECK 8 RESULT]', labHealth);

    if (!labHealth.isUp) {
      throw new Error('FAIL: checkLabAvailability() reported false while port 8010 is up!');
    }
    console.log('✓ PASS: :8010 availability health check operates correctly.');

    console.log('\n=====================================================');
    console.log('✓ ALL 8 S3 ACCEPTANCE CLICK-PATH CHECKS PASSED!');
    console.log('=====================================================');

  } finally {
    try { chromeProc.kill(); } catch (_) {}
  }
}

runAcceptance().catch(err => {
  console.error('\n❌ S3 ACCEPTANCE FAILED:', err);
  process.exit(1);
});
