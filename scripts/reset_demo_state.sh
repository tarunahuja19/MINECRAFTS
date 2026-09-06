#!/usr/bin/env bash
# ==============================================================================
# reset_demo_state.sh - Rapidly restore pristine baseline demo conditions
#
# Clears accumulated runtime readings, simulation packets, and alarms while
# preserving the 31 canonical Adriyala nodes in PostgreSQL.
#
# Usage:
#   npm run db:reset
#   or: bash scripts/reset_demo_state.sh
# ==============================================================================

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -f "$ROOT_DIR/backend/.env" ]; then
  set -a; . "$ROOT_DIR/backend/.env"; set +a
fi

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-labpass123}"
PGDATABASE="${PGDATABASE:-mine_subsidence}"

export PGPASSWORD

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql command not found on PATH." >&2
  exit 1
fi

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -q -c "
  TRUNCATE TABLE readings, simulation_packets, alarms CASCADE;
  UPDATE nodes SET status = 'active';
"

echo "✅ Demo state reset: readings, packets, and alarms cleared; all 31 nodes reset to 'active'."
