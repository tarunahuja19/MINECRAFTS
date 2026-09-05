#!/usr/bin/env bash
# ==============================================================================
# SIH26 Mine Subsidence Monitoring System — Unified Startup Script
# Starts:
#   1. Node.js Backend API & WebSocket Broadcaster (Port 8080)
#   2. Frontend Dashboard Web Server (Port 8085)
#   3. Python Physics Simulation Runner & PostgreSQL Persister
# ==============================================================================

set -e
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "================================================================="
echo "  R4 MINE SUBSIDENCE MONITORING SYSTEM — ONE HOOD LAUNCHER"
echo "  Root: $ROOT_DIR"
echo "================================================================="

# Trap Ctrl+C to shut down cleanly
cleanup() {
    echo ""
    echo "[LAUNCHER] Shutting down services..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    echo "[LAUNCHER] All services stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Kill any existing instances on ports 8080 and 8085
kill -9 $(lsof -t -i:8080) 2>/dev/null || true
kill -9 $(lsof -t -i:8085) 2>/dev/null || true
sleep 1

# 2. Start Backend API & WebSocket Server
echo "[1/3] Starting Backend API Server (Port 8080)..."
(cd backend && node server.js) &
BACKEND_PID=$!
sleep 2

# Verify backend health
if curl -s http://localhost:8080/api/health >/dev/null; then
    echo "      Backend API is healthy on http://localhost:8080/api/health"
else
    echo "      [WARNING] Backend health check did not respond immediately, continuing..."
fi

# 3. Start Frontend Dashboard Web Server
echo "[2/3] Starting Frontend Dashboard Server (Port 8085)..."
(cd frontend_dashboard && node serve.js) &
FRONTEND_PID=$!
sleep 1

echo "      Dashboard Web UI available at: http://127.0.0.1:8085/"

# 4. Start Physics Simulation Runner
echo "[3/3] Starting Physics Simulation Engine (Connecting to PostgreSQL)..."
echo "      Press Ctrl+C at any time to stop all services."
echo "-----------------------------------------------------------------"

# Run simulation runner in foreground with terminal logging
simulation/.venv/bin/python simulation/sandbox/runner.py "$@"
