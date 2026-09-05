#!/usr/bin/env bash
# ==============================================================================
# SIH26 Mine Subsidence Monitoring System - Unified Startup
#
#   npm start                       # start the whole stack
#   ./scripts/start_all.sh --no-ui        # no Electron window
#   ./scripts/start_all.sh --no-chrome    # don't open the 3D sandbox in Chrome
#   ./scripts/start_all.sh --no-sim       # services + UIs only, no simulation
#
# Starts, in order:
#   1. MQTT broker (aedes, pure Node)         mqtt://127.0.0.1:1883
#   2. Backend API + WebSocket broadcaster    http://localhost:8080
#   3. Dashboard web server (tile proxy)      http://127.0.0.1:8085
#   4. Sandbox simulation server (physics)    http://localhost:8000   <- THE SIM
#   5. Sandbox 3D frontend (Vite dev server)  http://localhost:5173
#   6. Electron desktop dashboard (operator UI)
#   7. Chrome tab on the 3D sandbox
#
# Data path:
#   sandbox/server.py  --(readings + packets)-->  PostgreSQL (mine_subsidence)
#   PostgreSQL  -->  backend :8080  -->  ws://:8080/ws  -->  Electron dashboard
#   sandbox/server.py  --(state deltas)-->  ws://:8000/ws  -->  3D sandbox UI
#   sandbox/mqtt_bridge.py  --(per-tick telemetry + alarms)-->  mqtt://:1883
#                           -->  Electron dashboard (main/mqtt-client.js)
#
# The 3D sandbox (terrain, collapse, vibration, mining advance) IS the
# simulation. It replaces the old headless runner.py.
#
# Every prerequisite is checked before anything starts.
# ==============================================================================

set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_SIM=1
RUN_UI=1
RUN_CHROME=1
for arg in "$@"; do
  case "$arg" in
    --no-sim)    RUN_SIM=0 ;;
    --no-ui)     RUN_UI=0 ;;
    --no-chrome) RUN_CHROME=0 ;;
    *)           echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

BROKER_PID=""; BACKEND_PID=""; FRONTEND_PID=""; SIM_PID=""; VITE_PID=""; ELECTRON_PID=""

say()  { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$*"; }
die()  { printf '  \033[31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

echo "================================================================="
echo "  R4 MINE SUBSIDENCE MONITORING SYSTEM - LAUNCHER"
echo "  Root: $ROOT_DIR"
echo "================================================================="

cleanup() {
  trap - SIGINT SIGTERM EXIT
  echo ""
  say "[LAUNCHER] Shutting down services..."
  for pid in "$ELECTRON_PID" "$VITE_PID" "$SIM_PID" "$FRONTEND_PID" "$BACKEND_PID" "$BROKER_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  say "[LAUNCHER] All services stopped."
}
trap cleanup SIGINT SIGTERM EXIT

# ---------------------------------------------------------------- preflight --
say "[0] Preflight checks"

command -v node >/dev/null || die "node not found on PATH"
ok "node $(node --version)"

# Load backend/.env so the DB check uses the same credentials the server will.
if [ -f backend/.env ]; then
  set -a; . ./backend/.env; set +a
  ok "loaded backend/.env"
else
  warn "backend/.env missing - falling back to pg defaults"
fi
PGHOST="${PGHOST:-localhost}"; PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"; PGDATABASE="${PGDATABASE:-mine_subsidence}"

if command -v pg_isready >/dev/null; then
  pg_isready -h "$PGHOST" -p "$PGPORT" -q \
    || die "PostgreSQL is not accepting connections on $PGHOST:$PGPORT (start it, e.g. 'brew services start postgresql')"
  ok "PostgreSQL up on $PGHOST:$PGPORT"
fi

if command -v psql >/dev/null; then
  NODE_COUNT=$(PGPASSWORD="${PGPASSWORD:-}" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
                 -tAc "select count(*) from nodes;" 2>/dev/null)
  if [ -z "$NODE_COUNT" ]; then
    die "cannot query database '$PGDATABASE' - run: npm --prefix backend run migrate"
  fi
  ok "database '$PGDATABASE' reachable ($NODE_COUNT nodes)"
  OFFSITE=$(PGPASSWORD="${PGPASSWORD:-}" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
              -tAc "select count(*) from nodes where lat is null or lat not between 18.5 and 18.8;" 2>/dev/null)
  [ "${OFFSITE:-0}" = "0" ] \
    && ok "all nodes geo-aligned to Adriyala (18.64 N, 79.57 E)" \
    || warn "$OFFSITE node(s) have missing/off-site lat - the map may be wrong"
fi

[ -d backend/node_modules ] || die "backend deps missing - run: npm --prefix backend install"
ok "backend dependencies present"

[ -d node_modules/aedes ] || die "MQTT broker dep missing - run: npm install"
ok "MQTT broker (aedes) present"

if [ "$RUN_UI" = 1 ]; then
  [ -x frontend_dashboard/node_modules/.bin/electron ] \
    && ok "electron present" \
    || { warn "electron missing - run 'npm --prefix frontend_dashboard install'; continuing headless"; RUN_UI=0; }
fi

if [ "$RUN_SIM" = 1 ]; then
  [ -x simulation/.venv/bin/uvicorn ] \
    || die "simulation venv missing/incomplete - create it, e.g.: python3 -m venv simulation/.venv && simulation/.venv/bin/pip install -e simulation"
  ok "simulation venv present"
  [ -x simulation/frontend/node_modules/.bin/vite ] \
    || die "sandbox frontend deps missing - run: npm --prefix simulation/frontend install"
  ok "sandbox frontend dependencies present"
fi

TILE_COUNT=$(find frontend_dashboard/tiles -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
[ "${TILE_COUNT:-0}" -gt 0 ] \
  && ok "map tiles: $TILE_COUNT cached (offline-capable)" \
  || warn "tile cache empty - run 'npm run tiles:prefetch' while online"

# Free the ports we are about to bind.
for port in 1883 8080 8085 8000 5173; do
  pids=$(lsof -t -i:"$port" 2>/dev/null)
  [ -n "$pids" ] && { kill -9 $pids 2>/dev/null; warn "killed stale process on port $port"; }
done

# ------------------------------------------------------------------- broker --
# Started first: the simulation publishes to it and the dashboard subscribes,
# so anything that connects later finds it already listening.
say "[1] MQTT broker (port 1883)"
BROKER_LOG="$ROOT_DIR/.broker.log"
node scripts/broker.js >"$BROKER_LOG" 2>&1 &
BROKER_PID=$!

# Readiness means a completed MQTT handshake, not just a bound port: a broker
# can accept the TCP connection and never send a CONNACK, and `nc -z` would
# call that healthy while every client hangs.
broker_ready() { node scripts/mqtt_tap.js --probe >/dev/null 2>&1; }

for i in $(seq 1 20); do
  broker_ready && break
  kill -0 "$BROKER_PID" 2>/dev/null || { sed 's/^/       /' "$BROKER_LOG" | head -8; die "MQTT broker exited during startup"; }
  sleep 0.25
done
broker_ready \
  && ok "MQTT broker accepting connections - mqtt://127.0.0.1:1883 (log: .broker.log)" \
  || die "MQTT broker did not complete an MQTT handshake within 5s"

# ------------------------------------------------------------------ backend --
say "[2] Backend API + WebSocket (port 8080)"
(cd backend && node server.js) &
BACKEND_PID=$!

for i in $(seq 1 30); do
  curl -sf http://localhost:8080/api/health >/dev/null 2>&1 && break
  kill -0 "$BACKEND_PID" 2>/dev/null || die "backend exited during startup (see log above)"
  sleep 0.5
done
curl -sf http://localhost:8080/api/health >/dev/null 2>&1 \
  && ok "backend healthy - http://localhost:8080/api/health" \
  || die "backend did not become healthy within 15s"

# ----------------------------------------------------------------- frontend --
say "[3] Dashboard web server (port 8085)"
(cd frontend_dashboard && node serve.js) &
FRONTEND_PID=$!

for i in $(seq 1 20); do
  curl -sf http://127.0.0.1:8085/ >/dev/null 2>&1 && break
  kill -0 "$FRONTEND_PID" 2>/dev/null || die "frontend server exited during startup"
  sleep 0.5
done
ok "dashboard at http://127.0.0.1:8085/"

# ---------------------------------------------------------------- simulation --
if [ "$RUN_SIM" = 1 ]; then
  say "[4] Sandbox simulation server (port 8000)"
  (cd simulation && .venv/bin/uvicorn sandbox.server:app --host 0.0.0.0 --port 8000 --log-level warning) &
  SIM_PID=$!

  for i in $(seq 1 40); do
    curl -sf http://localhost:8000/health >/dev/null 2>&1 && break
    kill -0 "$SIM_PID" 2>/dev/null || die "simulation server exited during startup (see log above)"
    sleep 0.5
  done
  curl -sf http://localhost:8000/health >/dev/null 2>&1 \
    && ok "simulation server healthy - http://localhost:8000/health" \
    || die "simulation server did not become healthy within 20s"

  say "[5] Sandbox 3D frontend (Vite dev server, port 5173)"
  (cd simulation/frontend && node_modules/.bin/vite --host --port 5173 --strictPort) &
  VITE_PID=$!

  for i in $(seq 1 40); do
    curl -sf http://localhost:5173/ >/dev/null 2>&1 && break
    kill -0 "$VITE_PID" 2>/dev/null || die "Vite dev server exited during startup"
    sleep 0.5
  done
  ok "3D sandbox UI at http://localhost:5173/"
else
  say "[4] Sandbox simulation server - skipped (--no-sim)"
  say "[5] Sandbox 3D frontend - skipped (--no-sim)"
fi

# ------------------------------------------------------------------ the UI ---
if [ "$RUN_UI" = 1 ]; then
  say "[6] Electron dashboard"
  # ELECTRON_RUN_AS_NODE leaks from some editors/terminals; unset it or Electron
  # boots as plain Node and main.js dies on undefined `app`/`ipcMain`.
  ELECTRON_LOG="$ROOT_DIR/.electron.log"
  (cd frontend_dashboard && env -u ELECTRON_RUN_AS_NODE \
      ./node_modules/.bin/electron . >"$ELECTRON_LOG" 2>&1) &
  ELECTRON_PID=$!

  sleep 3
  if kill -0 "$ELECTRON_PID" 2>/dev/null; then
    ok "operator UI launched"
  else
    warn "Electron exited on startup - see $ELECTRON_LOG"
    sed 's/^/       /' "$ELECTRON_LOG" | head -12
    ELECTRON_PID=""
  fi
else
  say "[6] Electron dashboard - skipped (--no-ui)"
fi

# ------------------------------------------------------------- Chrome tab ---
if [ "$RUN_CHROME" = 1 ] && [ "$RUN_SIM" = 1 ]; then
  say "[7] Opening the 3D sandbox in Chrome"
  open -a "Google Chrome" "http://localhost:5173/" 2>/dev/null \
    && ok "Chrome tab opened on the 3D sandbox" \
    || warn "could not open Chrome - browse to http://localhost:5173/ manually"
else
  say "[7] Chrome tab - skipped"
fi

echo "-----------------------------------------------------------------"
say "Stack is up. Press Ctrl+C to stop everything."
echo "  Simulation (3D sandbox):  http://localhost:5173/"
echo "  Operator dashboard:       Electron window  +  http://127.0.0.1:8085/"
echo "  Backend API:              http://localhost:8080"
echo "  MQTT broker:              mqtt://127.0.0.1:1883"
echo "  Watch live MQTT traffic:  node scripts/mqtt_tap.js"
echo "-----------------------------------------------------------------"

# Block on the long-lived services. If any exits, tear the rest down.
if [ "$RUN_SIM" = 1 ]; then
  wait "$SIM_PID"
else
  wait "$BACKEND_PID" "$FRONTEND_PID"
fi
