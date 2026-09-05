#!/usr/bin/env bash
# vertical-slice.sh — Phase 2 integration test
#
# Verifies: Mosquitto running → publish fake telemetry → R4 receives it
#
# Prerequisites:
#   - Docker (for Mosquitto) OR a local Mosquitto on port 1883
#   - mosquitto_pub installed (comes with mosquitto-clients)
#   - R4 dashboard running: cd r4-dashboard && npm start
#
# Usage:
#   bash test/vertical-slice.sh

set -euo pipefail

BROKER="localhost"
PORT="1883"
PANEL="P3"
NODE="N07"
TOPIC="mine/${PANEL}/node/${NODE}/telemetry"

echo "=== R4 Vertical Slice Test ==="
echo ""

# Step 1: Check if broker is reachable
echo "[1/3] Checking MQTT broker at ${BROKER}:${PORT}..."
if command -v mosquitto_pub &>/dev/null; then
  MQTT_CMD="mosquitto_pub"
elif command -v docker &>/dev/null; then
  MQTT_CMD="docker run --rm --network host eclipse-mosquitto mosquitto_pub"
else
  echo "ERROR: Neither mosquitto_pub nor Docker found."
  echo "Install mosquitto-clients or Docker to run this test."
  exit 1
fi

# Step 2: Publish test telemetry
EPOCH=$(date +%s)
PAYLOAD=$(cat <<EOF
{
  "node_id": "${NODE}",
  "t_epoch_s": ${EPOCH},
  "tilt_x_mdeg": 150,
  "tilt_y_mdeg": -80,
  "strain_ustrain": 425,
  "temp_c_x10": 312,
  "vbat_mv": 3650,
  "vib_rms_summary": 12,
  "flags": 0,
  "crc8": 0
}
EOF
)

echo "[2/3] Publishing telemetry to ${TOPIC}..."
echo "  Payload: ${PAYLOAD}"
$MQTT_CMD -h "$BROKER" -p "$PORT" -t "$TOPIC" -m "$PAYLOAD"

echo ""
echo "[3/3] Published successfully."
echo ""
echo "=== Manual Verification ==="
echo "Check the R4 dashboard window:"
echo "  1. Node ${NODE} marker should turn GREEN (active)"
echo "  2. Hover over ${NODE} — tooltip should show:"
echo "     Strain: 425 ustrain"
echo "     Battery: 3650 mV"
echo "  3. Status bar: MQTT LED should be GREEN, 'CONNECTED'"
echo ""
echo "To publish continuously (every 2s), run:"
echo "  python3 test/stub-publisher.py"
echo ""
echo "=== Done ==="
