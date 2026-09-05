#!/usr/bin/env bash
# ==============================================================================
# SIH26 Mine Subsidence Monitoring System - Unified Startup
#
#   ./scripts/start_all.sh          # start everything
#   ./scripts/start_all.sh --speed 60   # extra args go to the simulation runner
#   ./scripts/start_all.sh --no-sim     # services + UI only, leave the DB alone
#   ./scripts/start_all.sh --no-ui      # headless (no Electron window)
#
# Starts, in order:
#   1. Backend API + WebSocket broadcaster   http://localhost:8080
#   2. Frontend dashboard web server         http://127.0.0.1:8085
#   3. Electron desktop dashboard (the operator UI)
#   4. Python physics simulation -> PostgreSQL (foreground; Ctrl+C stops all)
#
# Every prerequisite is checked before anything starts, so a failure tells you
# what to fix instead of leaving half the stack running.
# ==============================================================================

set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_SIM=1
RUN_UI=1
SIM_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-sim) RUN_SIM=0 ;;
    --no-ui)  RUN_UI=0 ;;
    *)        SIM_ARGS+=("$arg") ;;
  esac
done

BACKEND_PID=""; FRONTEND_PID=""; ELECTRON_PID=""

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
  for pid in "$ELECTRON_PID" "$FRONTEND_PID" "$BACKEND_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  say "[LAUNCHER] All services stopped."
}
trap cleanup SIGINT SIGTERM EXIT

# ---------------------------------------------------------------- preflight --
say "[0/4] Preflight checks"

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
  # Guard against the stale-coordinate class of bug: nodes must sit at the
  # modelled Adriyala site (18.64 N), not the retired Jharia fixture (23.74 N).
  OFFSITE=$(PGPASSWORD="${PGPASSWORD:-}" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
              -tAc "select count(*) from nodes where lat is null or lat not between 18.5 and 18.8;" 2>/dev/null)
  [ "${OFFSITE:-0}" = "0" ] \
    && ok "all nodes geo-aligned to Adriyala (18.64 N, 79.57 E)" \
    || warn "$OFFSITE node(s) have missing/off-site lat - the map may be wrong"
fi

[ -d backend/node_modules ] || die "backend deps missing - run: npm --prefix backend install"
ok "backend dependencies present"

if [ "$RUN_UI" = 1 ]; then
  [ -x frontend_dashboard/node_modules/.bin/electron ] \
    && ok "electron present" \
    || { warn "electron missing - run 'npm --prefix frontend_dashboard install'; continuing headless"; RUN_UI=0; }
fi

if [ "$RUN_SIM" = 1 ]; then
  [ -x simulation/.venv/bin/python ] \
    || die "simulation venv missing - create it, e.g.: python3 -m venv simulation/.venv && simulation/.venv/bin/pip install -e simulation"
  ok "simulation venv present"
fi

TILE_COUNT=$(find frontend_dashboard/tiles -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
[ "${TILE_COUNT:-0}" -gt 0 ] \
  && ok "map tiles: $TILE_COUNT cached (offline-capable)" \
  || warn "tile cache empty - run 'npm run tiles:prefetch' while online"

# Free the ports we are about to bind.
for port in 8080 8085; do
  pids=$(lsof -t -i:"$port" 2>/dev/null)
  [ -n "$pids" ] && { kill -9 $pids 2>/dev/null; warn "killed stale process on port $port"; }
done

# ------------------------------------------------------------------ backend --
say "[1/4] Backend API + WebSocket (port 8080)"
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
say "[2/4] Dashboard web server (port 8085)"
(cd frontend_dashboard && node serve.js) &
FRONTEND_PID=$!

for i in $(seq 1 20); do
  curl -sf http://127.0.0.1:8085/ >/dev/null 2>&1 && break
  kill -0 "$FRONTEND_PID" 2>/dev/null || die "frontend server exited during startup"
  sleep 0.5
done
ok "dashboard at http://127.0.0.1:8085/"

# ------------------------------------------------------------------ the UI ---
if [ "$RUN_UI" = 1 ]; then
  say "[3/4] Electron dashboard"
  # ELECTRON_RUN_AS_NODE is exported by some editors/terminals (VS Code sets it
  # for its own helper processes). If it leaks into our environment Electron
  # boots as plain Node - `app` and `ipcMain` are undefined and main.js dies
  # with "Cannot read properties of undefined (reading 'handle')". Unset it.
  ELECTRON_LOG="$ROOT_DIR/.electron.log"
  (cd frontend_dashboard && env -u ELECTRON_RUN_AS_NODE \
      ./node_modules/.bin/electron . >"$ELECTRON_LOG" 2>&1) &
  ELECTRON_PID=$!

  # Don't claim success until it has survived startup - a crash on boot is
  # otherwise invisible because the process is backgrounded.
  sleep 3
  if kill -0 "$ELECTRON_PID" 2>/dev/null; then
    ok "operator UI launched"
  else
    warn "Electron exited on startup - see $ELECTRON_LOG"
    sed 's/^/       /' "$ELECTRON_LOG" | head -12
    ELECTRON_PID=""
  fi
else
  say "[3/4] Electron dashboard - skipped (headless)"
fi

# -------------------------------------------------------------- simulation ---
if [ "$RUN_SIM" = 0 ]; then
  say "[4/4] Simulation - skipped (--no-sim)"
  echo "-----------------------------------------------------------------"
  say "Services running. Press Ctrl+C to stop."
  wait "$BACKEND_PID" "$FRONTEND_PID"
  exit 0
fi

say "[4/4] Physics simulation -> PostgreSQL"
echo "      Press Ctrl+C at any time to stop everything."
echo "-----------------------------------------------------------------"
# bash 3.2 (the macOS default) treats "${arr[@]}" on an *empty* array as an
# unbound variable under `set -u`, so a plain `npm start` with no extra args
# aborted here and the EXIT trap tore the whole stack down. The ${a[@]+...}
# guard expands to nothing when the array is empty and to the args otherwise.
simulation/.venv/bin/python simulation/sandbox/runner.py ${SIM_ARGS[@]+"${SIM_ARGS[@]}"}
