#!/usr/bin/env node
'use strict';

// ==============================================================================
// SIH26 Mine Subsidence Monitoring System - Cross-Platform Unified Launcher
//
// Starts in order:
//   1. MQTT broker (aedes, pure Node)         mqtt://127.0.0.1:1883
//   2. Backend API + WebSocket broadcaster    http://localhost:8080
//   3. Dashboard web server (tile proxy)      http://127.0.0.1:8085
//   4. Sandbox simulation server (physics)    http://127.0.0.1:8000
//   5. Sandbox 3D frontend (Vite dev server)  http://127.0.0.1:5173
//   6. Electron desktop dashboard (operator UI)
//   7. Browser tab on the 3D sandbox
// ==============================================================================

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
process.chdir(ROOT_DIR);

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m'
};

function say(msg) { console.log(`${colors.cyan}${msg}${colors.reset}`); }
function ok(msg) { console.log(`  ${colors.green}OK${colors.reset}   ${msg}`); }
function warn(msg) { console.log(`  ${colors.yellow}WARN${colors.reset} ${msg}`); }
function die(msg) { console.error(`  ${colors.red}FAIL${colors.reset} ${msg}`); process.exit(1); }

console.log('=================================================================');
console.log('  R4 MINE SUBSIDENCE MONITORING SYSTEM - LAUNCHER');
console.log(`  Root: ${ROOT_DIR}`);
console.log('=================================================================');

const STACK_PORTS = [1883, 8080, 8085, 8000, 5173];
const children = [];

function clearPortOccupants(ports = STACK_PORTS) {
  try {
    if (process.platform === 'win32') {
      for (const port of ports) {
        try {
          const stdout = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          const lines = stdout.split('\n');
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && !isNaN(Number(pid)) && Number(pid) > 0 && Number(pid) !== process.pid) {
              execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            }
          }
        } catch (_) {}
      }
    } else {
      const portStr = ports.join(',');
      try {
        const pids = execSync(`lsof -ti:${portStr}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
          .trim()
          .split('\n')
          .map((p) => p.trim())
          .filter((p) => p && !isNaN(Number(p)) && Number(p) !== String(process.pid));
        if (pids.length > 0) {
          execSync(`kill -9 ${pids.join(' ')} 2>/dev/null`, { stdio: 'ignore' });
        }
      } catch (_) {}
    }
  } catch (_) {}
}

function killChild(child) {
  if (!child || child.killed || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (_) {
        child.kill('SIGKILL');
      }
    }
  } catch (_) {}
}

function cleanup() {
  console.log('\n');
  say('[LAUNCHER] Shutting down services...');
  for (const child of children) {
    killChild(child);
  }
  clearPortOccupants(STACK_PORTS);
  say('[LAUNCHER] All services stopped.');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  for (const child of children) {
    killChild(child);
  }
  clearPortOccupants(STACK_PORTS);
});

function waitForTcp(port, host = '127.0.0.1', timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 300);
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 300);
        }
      });
      socket.connect(port, host);
    }
    tryConnect();
  });
}

function waitForHttp(url, timeoutMs = 25000, childProc = null) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let resolved = false;
    function check() {
      if (resolved) return;
      if (childProc && childProc.exitCode !== null) {
        resolved = true;
        return reject(new Error(`Process died prematurely with exit code ${childProc.exitCode} while waiting for ${url}`));
      }
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolved = true;
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          reject(new Error(`HTTP check failed with status ${res.statusCode}`));
        } else {
          setTimeout(check, 500);
        }
      });
      req.on('error', () => {
        if (resolved) return;
        if (childProc && childProc.exitCode !== null) {
          resolved = true;
          return reject(new Error(`Process died prematurely with exit code ${childProc.exitCode} while waiting for ${url}`));
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout connecting to ${url}`));
        } else {
          setTimeout(check, 500);
        }
      });
      req.setTimeout(2000, () => {
        req.destroy();
      });
    }
    check();
  });
}

function getPythonExecutable() {
  const venvCandidates = [
    path.join(ROOT_DIR, 'simulation', '.venv', 'bin', 'python'),
    path.join(ROOT_DIR, 'simulation', '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT_DIR, 'simulation', 'venv', 'bin', 'python'),
    path.join(ROOT_DIR, 'simulation', 'venv', 'Scripts', 'python.exe')
  ];
  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function main() {
  say('[0] Preflight checks');
  
  // Clear any zombie/orphan processes holding stack ports
  clearPortOccupants(STACK_PORTS);
  ok('verified stack ports (1883, 8080, 8085, 8000, 5173) are free');

  // 1. Check & Auto-Reset DB for a pristine run
  try {
    const db = require(path.join(ROOT_DIR, 'backend', 'db', 'db'));
    await db.testConnection();
    await db.query(`
      TRUNCATE TABLE readings, simulation_packets, alarms CASCADE;
      UPDATE nodes SET status = 'active';
    `);
    const res = await db.query('SELECT count(*) FROM nodes');
    ok(`database auto-reset on boot: 0 readings, 0 packets, 0 alarms (${res.rows[0].count} active nodes ready)`);
  } catch (err) {
    die(`database auto-reset failed: ${err.message}`);
  }

  // 2. Start MQTT Broker
  say('[1] MQTT broker (port 1883)');
  const brokerProc = spawn('node', ['scripts/broker.js'], {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });
  children.push(brokerProc);
  await waitForTcp(1883);
  ok('MQTT broker accepting connections - mqtt://127.0.0.1:1883');

  // 3. Start Backend API
  say('[2] Backend API + WebSocket (port 8080)');
  const backendProc = spawn('node', ['server.js'], {
    cwd: path.join(ROOT_DIR, 'backend'),
    stdio: 'inherit',
    env: { ...process.env }
  });
  children.push(backendProc);
  await waitForHttp('http://localhost:8080/api/health', 25000, backendProc);
  ok('backend healthy - http://localhost:8080/api/health');

  // 4. Start Dashboard Web Server
  say('[3] Dashboard web server (port 8085)');
  const serveProc = spawn('node', ['serve.js'], {
    cwd: path.join(ROOT_DIR, 'dashboard_electron'),
    stdio: 'inherit'
  });
  children.push(serveProc);
  await waitForHttp('http://127.0.0.1:8085/', 25000, serveProc);
  ok('dashboard tile proxy at http://127.0.0.1:8085/');

  // 5. Start Sandbox Simulation Server
  say('[4] Sandbox simulation server (port 8000)');
  const pythonCmd = getPythonExecutable();
  const simProc = spawn(pythonCmd, ['-m', 'uvicorn', 'sandbox.server:app', '--host', '0.0.0.0', '--port', '8000', '--log-level', 'info'], {
    cwd: path.join(ROOT_DIR, 'simulation'),
    stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' }
  });
  children.push(simProc);
  await waitForHttp('http://127.0.0.1:8000/health', 25000, simProc);
  ok('simulation server healthy - http://127.0.0.1:8000/health');

  // 6. Start Vite 3D Sandbox Frontend
  say('[5] Sandbox 3D frontend (Vite dev server, port 5173)');
  const localVite = path.join(ROOT_DIR, 'simulation', 'frontend', 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
  const viteBin = fs.existsSync(localVite) ? localVite : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const viteArgs = fs.existsSync(localVite)
    ? ['--host', '127.0.0.1', '--port', '5173', '--strictPort']
    : ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'];
  const viteProc = spawn(viteBin, viteArgs, {
    cwd: path.join(ROOT_DIR, 'simulation', 'frontend'),
    stdio: 'inherit',
    shell: false
  });
  children.push(viteProc);
  await waitForHttp('http://127.0.0.1:5173/', 25000, viteProc);
  ok('3D sandbox UI ready at http://127.0.0.1:5173/');

  const noUi = process.argv.includes('--no-ui');
  const noBrowser = process.argv.includes('--no-browser') || process.argv.includes('--no-chrome');

  // 7. Start Electron Operator UI
  if (!noUi) {
    say('[6] Electron dashboard');
    const localElectron = path.join(ROOT_DIR, 'dashboard_electron', 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
    const electronBin = fs.existsSync(localElectron) ? localElectron : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
    const electronArgs = fs.existsSync(localElectron) ? ['.'] : ['electron', '.'];
    const electronProc = spawn(electronBin, electronArgs, {
      cwd: path.join(ROOT_DIR, 'dashboard_electron'),
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
    });
    children.push(electronProc);
    ok('operator UI launched in Electron window');

    electronProc.on('exit', (code) => {
      console.log(`[main] Electron window closed (code ${code}).`);
    });
  } else {
    ok('Skipping Electron operator UI (--no-ui)');
  }

  // 8. Open 3D sandbox in default browser
  if (!noBrowser) {
    say('[7] Opening 3D Sandbox in browser');
    try {
      const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(opener, ['http://127.0.0.1:5173/'], { shell: true });
      ok('3D Sandbox tab opened in default browser');
    } catch (_) {}
  } else {
    ok('Skipping browser launch (--no-browser)');
  }

  console.log('-----------------------------------------------------------------');
  say('Stack is up and running! Press Ctrl+C to stop all services.');
  console.log('  Simulation (3D Sandbox):  http://127.0.0.1:5173/');
  console.log('  Operator Dashboard:       Electron Window  &  http://127.0.0.1:8085/');
  console.log('  Backend REST & WebSocket: http://localhost:8080');
  console.log('  Physics Sim Engine:       http://127.0.0.1:8000');
  console.log('  MQTT Telemetry Broker:    mqtt://127.0.0.1:1883');
  console.log('-----------------------------------------------------------------');
}

main().catch(err => {
  die(err.stack || err.message);
});
