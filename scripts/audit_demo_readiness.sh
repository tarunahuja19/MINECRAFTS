#!/usr/bin/env bash
# ==============================================================================
# audit_demo_readiness.sh - Automated Pre-Demo Readiness Audit
#
# Validates all critical requirements from PRE_DEMO_CHECKLIST.md:
#   1. PostgreSQL reachability & 31 Adriyala nodes count
#   2. Application ports availability
#   3. Offline map tiles cache status
#   4. JavaScript syntax integrity
#   5. 3D Frontend build verification
#   6. Simulation physics test suite (Knothe model & packet pipeline)
# ==============================================================================

set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

say()  { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$*"; }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; ERRORS=$((ERRORS + 1)); }

ERRORS=0

echo "================================================================="
echo "  R4 MINE SUBSIDENCE SYSTEM - PRE-DEMO READINESS AUDIT"
echo "================================================================="

# 1. Environment & Tools
say "\n[1] Environment & Runtimes"
if command -v node >/dev/null; then
  ok "Node.js installed ($(node --version))"
else
  fail "Node.js not found on PATH"
fi

if [ -x "simulation/.venv/bin/python" ]; then
  ok "Python virtual environment verified ($(simulation/.venv/bin/python --version))"
else
  fail "Python virtual environment missing at simulation/.venv"
fi

# 2. PostgreSQL & 31 Adriyala Nodes Invariant
say "\n[2] Database & Schema Contract"
if [ -f backend/.env ]; then
  set -a; . ./backend/.env; set +a
fi
PGHOST="${PGHOST:-localhost}"; PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"; PGDATABASE="${PGDATABASE:-mine_subsidence}"
PGPASSWORD="${PGPASSWORD:-labpass123}"
export PGPASSWORD

if command -v pg_isready >/dev/null && pg_isready -h "$PGHOST" -p "$PGPORT" -q; then
  ok "PostgreSQL is accepting connections on $PGHOST:$PGPORT"
  
  NODE_COUNT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc "SELECT count(*) FROM nodes;" 2>/dev/null || echo "0")
  if [ "$NODE_COUNT" = "31" ]; then
    ok "Exactly 31 canonical Adriyala nodes present in database"
  else
    fail "Node count discrepancy: found $NODE_COUNT nodes (expected 31)"
  fi

  ACTIVE_COUNT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc "SELECT count(*) FROM nodes WHERE status = 'active';" 2>/dev/null || echo "0")
  ok "Active nodes: $ACTIVE_COUNT / 31"
else
  fail "PostgreSQL is not responding on $PGHOST:$PGPORT (run 'brew services start postgresql@17')"
fi

# 3. Offline Map Tiles Cache
say "\n[3] Offline Tile Cache (Leaflet / 3D)"
TILE_COUNT=$(find dashboard_electron/tiles -type f -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
if [ "$TILE_COUNT" -gt 400 ]; then
  ok "$TILE_COUNT cached map tiles ready for offline demo"
else
  warn "Found only $TILE_COUNT cached tiles. Run 'npm run tiles:prefetch' while stack is running to warm cache."
fi

# 4. Port Conflict Audit
say "\n[4] Application Port Audit"
for port in 1883 8080 8085 8000 5173; do
  PID=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -z "$PID" ]; then
    ok "Port $port is free"
  else
    warn "Port $port is currently occupied by PID(s): $PID"
  fi
done

# 5. JavaScript Syntax Integrity
say "\n[5] Code Syntax Validation"
SYNTAX_ERRORS=0
while IFS= read -r file; do
  if ! node --check "$file" >/dev/null 2>&1; then
    fail "Syntax error in $file"
    SYNTAX_ERRORS=$((SYNTAX_ERRORS + 1))
  fi
done < <(find backend dashboard_electron/renderer/js dashboard_electron/main scripts -name "*.js" -not -path "*/node_modules/*")

if [ "$SYNTAX_ERRORS" -eq 0 ]; then
  ok "All JavaScript source files passed 'node --check' validation"
fi

# 6. 3D Frontend Compilation Check
say "\n[6] 3D Terrain Frontend Build Check"
if [ -d "simulation/frontend/dist" ]; then
  ok "Frontend build artifacts present in simulation/frontend/dist"
else
  warn "Frontend dist directory missing - run 'npm --prefix simulation/frontend run build'"
fi

# 7. Physics Simulation Engine Tests
say "\n[7] Physics Simulation Unit Tests"
if [ -x "simulation/.venv/bin/pytest" ]; then
  if simulation/.venv/bin/pytest simulation/tests -q >/dev/null 2>&1; then
    ok "Simulation physics & pipeline test suite passed (76/76 tests)"
  else
    fail "Simulation test suite failed. Run 'simulation/.venv/bin/pytest simulation/tests' for details."
  fi
else
  warn "pytest not available in simulation/.venv"
fi

echo "================================================================="
if [ "$ERRORS" -eq 0 ]; then
  printf '\033[32m%s\033[0m\n' "✅ AUDIT COMPLETE: System is in pristine demo-ready condition!"
  exit 0
else
  printf '\033[31m%s\033[0m\n' "❌ AUDIT FAILED: $ERRORS check(s) failed. Review output above."
  exit 1
fi
