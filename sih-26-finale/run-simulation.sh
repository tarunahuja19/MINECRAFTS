#!/usr/bin/env bash
# Run the simulation, entirely, on this laptop: simulation -> data for ML/backend -> 3D view.
# No database. Everything is files on this laptop.
#
#   ./run-simulation.sh              rebuild everything from scratch (690 days), then open the 3D view
#   ./run-simulation.sh 30           quick 30-day run into mine-sim/out/v2-30d, then open the 3D view of it
#   ./run-simulation.sh view         no rebuild: prepare + open the 3D view of mine-sim/out/v2-690d
#   ./run-simulation.sh --no-view    rebuild only (add to any of the above)
#
# Rebuild steps: erase generated data -> refit from field data -> tests -> plan the sensor network over the
# real terrain -> simulate that network (live progress read from nodes.csv while it is being written)
# -> real-anchored dataset -> handoff sample -> verify.
# Never erased: mine-sim/data/real (field data), data/fixtures, config.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SIM="$ROOT/mine-sim"
PY="${PY:-/opt/miniconda3/envs/pinn-sandbox/bin/python3.11}"
PORT="${PORT:-8000}"
SAMPLE="$ROOT/handoff/v2-sim-sample"
ANCHORED="$ROOT/handoff/v2-real-anchored"
PLAN="$SIM/out/plan/node_plan.json"
HANDOFF_GZ_MAX_MB=50    # source: F4 — keep the GitHub handoff sample small
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

DAYS=690; VIEW=1; REBUILD=1
for arg in "$@"; do
  case "$arg" in
    view) REBUILD=0 ;;
    --no-view) VIEW=0 ;;
    ''|*[!0-9]*) echo "unknown argument: $arg (use a number of days, view, or --no-view)"; exit 2 ;;
    *) DAYS="$arg" ;;
  esac
done
OUT="$SIM/out/v2-${DAYS}d"

[ -x "$PY" ] || { echo "Python not found at $PY (set PY=/path/to/python)"; exit 1; }
START=$(date +%s)

# Keep the committed file when only gzip header bytes / wall time differ (the data is identical).
keep_if_same() {
  local path="$1" kind="$2" rel="${1#$ROOT/}"
  git -C "$ROOT" cat-file -e "HEAD:$rel" 2>/dev/null || return 0
  case "$kind" in
    gz)   [ "$(gunzip -c "$path" | shasum -a 256)" = "$(git -C "$ROOT" show "HEAD:$rel" | gunzip -c | shasum -a 256)" ] ;;
    json) "$PY" -c "import json,sys; a,b=(json.load(open(sys.argv[1])),json.loads(sys.argv[2])); [d.pop('wall_time_s',0) for d in (a,b)]; sys.exit(a!=b)" "$path" "$(git -C "$ROOT" show "HEAD:$rel")" ;;
  esac && git -C "$ROOT" checkout -- "$rel"
  return 0  # data really changed: keep the new file and carry on (set -e would stop the run here)
}

if [ "$REBUILD" = 1 ]; then
  cd "$SIM"

  step "1/9 Erase generated data"
  rm -rf "$OUT" "$SIM"/data/fitted/*.json
  if [ "$DAYS" = "690" ]; then
    rm -rf "$SIM"/out/*
    rm -f "$SAMPLE"/nodes.csv.gz "$SAMPLE"/nodes_first_1000_rows.csv "$SAMPLE"/run_summary.json "$SAMPLE"/terrain_state.npz
    rm -f "$ANCHORED"/survey_line_daily.csv.gz "$ANCHORED"/survey_line_preview.csv "$ANCHORED"/validation.json
    echo "erased: mine-sim/out/*, mine-sim/data/fitted, handoff v2 data files (READMEs kept)"
  else
    echo "erased: ${OUT#$ROOT/}, mine-sim/data/fitted (other runs kept)"
  fi

  step "2/9 Refit Knothe parameters from field data (data/real)"
  "$PY" -c "from minesim.fitting import fit_adriyala, fit_illinois; a=fit_adriyala(); fit_illinois(); print('Adriyala fit: RMS', a['fit']['rms_residual_mm'], 'mm, R2', a['fit']['r_squared'])"

  step "3/9 Unit tests and gates"
  "$PY" -m pytest -q | tail -1

  step "4/9 Plan the sensor network over the real terrain -> ${PLAN#$ROOT/}"
  if [ ! -f "$SIM/data/real/adriyala_lw1_dem.npz" ]; then "$PY" scripts/fetch_dem.py; fi
  "$PY" -m minesim.placement --out "$PLAN" | head -1

  step "5/9 Simulate $DAYS days (layout.source in config/assumptions.yaml) -> ${OUT#$ROOT/}"
  mkdir -p "$SIM/out"
  "$PY" -m minesim.run --days "$DAYS" --out "$OUT" > "$OUT.log" 2>&1 &
  RUN_PID=$!
  while kill -0 "$RUN_PID" 2>/dev/null; do
    sleep 3
    if [ -f "$OUT/nodes.csv" ]; then
      epoch=$(tail -n 2 "$OUT/nodes.csv" | head -n 1 | cut -d, -f1)
      case "$epoch" in ''|*[!0-9]*) continue ;; esac
      printf '\r  reading nodes.csv: day %s / %s   rows %s' "$((epoch / 24))" "$DAYS" "$(wc -l < "$OUT/nodes.csv" | tr -d ' ')"
    fi
  done
  wait "$RUN_PID" || { echo; cat "$OUT.log"; exit 1; }
  echo; cat "$OUT.log"; rm -f "$OUT.log"

  step "6/9 Real-anchored survey-line dataset"
  if [ "$DAYS" = "690" ]; then
    "$PY" scripts/build_anchored_dataset.py | tail -3
    keep_if_same "$ANCHORED/survey_line_daily.csv.gz" gz
  else
    echo "skipped (only refreshed on the 690-day run)"
  fi

  step "7/9 Package handoff/v2-sim-sample"
  if [ "$DAYS" = "690" ]; then
    head -n 1001 "$OUT/nodes.csv" > "$SAMPLE/nodes_first_1000_rows.csv"
    cp "$OUT/run_summary.json" "$OUT/terrain_state.npz" "$SAMPLE/"
    gzip -n -c "$OUT/nodes.csv" > "$SAMPLE/nodes.csv.gz"
    gz_mb=$(( $(wc -c < "$SAMPLE/nodes.csv.gz") / 1048576 ))
    if [ "$gz_mb" -gt "$HANDOFF_GZ_MAX_MB" ]; then
      # Too big for GitHub: keep only the survey-line nodes (the ones that carry real / pinned values).
      "$PY" "$SIM/scripts/handoff_survey_line_gz.py" "$PLAN" "$OUT/nodes.csv" "$SAMPLE/nodes.csv.gz"
      echo "survey_line_only" > "$SAMPLE/NODES_GZ_CONTENTS.txt"
    else
      echo "all_nodes" > "$SAMPLE/NODES_GZ_CONTENTS.txt"
    fi
    keep_if_same "$SAMPLE/nodes.csv.gz" gz
    keep_if_same "$SAMPLE/run_summary.json" json
    echo "copied to ${SAMPLE#$ROOT/} (nodes.csv.gz: $(cat "$SAMPLE/NODES_GZ_CONTENTS.txt"), $(( $(wc -c < "$SAMPLE/nodes.csv.gz") / 1048576 )) MB)"
  else
    echo "skipped (handoff sample is the 690-day run)"
  fi

  step "8/9 Verify"
  "$PY" - "$OUT" "$DAYS" "$PLAN" <<'EOF'
import csv, json, sys
out, days, plan = sys.argv[1], float(sys.argv[2]), sys.argv[3]
s = json.load(open(f"{out}/run_summary.json"))
rows = sum(1 for _ in open(f"{out}/nodes.csv")) - 1
c = json.load(open(plan))["counts"]
plan_scouts = c["1A"] + c["1B"] + c["1C"]
if s["scouts"] != plan_scouts:
    print(f"note: run has {s['scouts']} scouts, plan has {plan_scouts} (layout.source is not plan?)")
want = plan_scouts * int(round(days * 24))
seen, dup = set(), 0
for r in csv.DictReader(open(f"{out}/nodes.csv")):
    k = (r["node_id"], r["epoch"]); dup += k in seen; seen.add(k)
ok = rows == want and dup == 0
print(f"rows {rows} (expected {want}) | duplicate (node_id, epoch) {dup} | delivery {s['delivery_rate']}"
      f" | peak {s['peak_subsidence_mm']} mm | provenance {s['provenance']}")
sys.exit(0 if ok else 1)
EOF

  step "9/9 Surface crack field and vibration -> ${OUT#$ROOT/}/../cracks"
  # S7. Cracks LATCH: once a fissure opens it narrows but never heals, so the crack state at day T
  # cannot be evaluated at one instant - it has to be walked forward from day 0. This export is the
  # only place that walk happens, and the Scenario Lab's "new cracks" count is measured against it.
  # Before S7 a full rebuild erased out/ and never recreated this, so the file the crack scenario
  # depends on was absent after every clean run (WHATS-LEFT §1.5).
  # Several days, not just the last: the Scenario Lab can freeze ANY day, and with no baseline for
  # that day it refuses to count new cracks. One shared walk, so four days cost the same as one.
  CRACK_DAYS="$(( DAYS / 4 )),$(( DAYS / 2 )),$(( DAYS * 3 / 4 )),$DAYS"
  "$PY" scripts/export_cracks.py --day "$CRACK_DAYS" --out out/cracks | "$PY" -c "import json,sys; rows=json.load(sys.stdin); rows=rows if isinstance(rows,list) else [rows]; [print(f\"day {r['day']:.0f}: cracked {r['cracked_cells']} of {r['cells']} cells ({r['cracked_area_ha']} ha) on a {r['cell_m']} m grid | widest {r['max_crack_width_mm']} mm | caving events {r['caving_events']}\") for r in rows]"
fi

[ -f "$OUT/run_summary.json" ] || { echo "No run at ${OUT#$ROOT/}. Run ./run-simulation.sh first."; exit 1; }

cat <<EOF

Data on this laptop (ML and backend read these files):
  ${OUT#$ROOT/}/nodes.csv              sensor rows (negative subsidence = down; dedupe on node_id+epoch)
  ${OUT#$ROOT/}/terrain_changes.jsonl  terrain change per hour
  ${OUT#$ROOT/}/terrain_state.npz      terrain at t=0
  ${OUT#$ROOT/}/run_summary.json       counts, cost, delivery, provenance
  handoff/v2-sim-sample/, handoff/v2-real-anchored/   copies for GitHub
EOF

if [ ! -f "$ROOT/renderer/export_scene.py" ]; then
  echo; echo "3D view: not built yet (step T4)."; exit 0
fi
if [ ! -f "$PLAN" ]; then
  step "3D view: plan the sensor network over the real terrain"
  if [ ! -f "$SIM/data/real/adriyala_lw1_dem.npz" ]; then
    (cd "$SIM" && "$PY" scripts/fetch_dem.py)
  fi
  (cd "$SIM" && "$PY" -m minesim.placement --out "$PLAN")
fi
cd "$ROOT"
step "3D view: prepare scene"
"$PY" renderer/export_scene.py --run "$OUT"
echo "Live stream server: not built yet (step T2)."
echo "Total $(( $(date +%s) - START )) s."

[ "$VIEW" = 1 ] || exit 0
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is busy (an old view still running?). Open http://localhost:$PORT or run: PORT=8001 ./run-simulation.sh view"
  exit 1
fi
step "3D view: http://localhost:$PORT  (Ctrl+C to stop)"
(sleep 1 && open "http://localhost:$PORT" >/dev/null 2>&1 || true) &
cd "$ROOT/renderer" && exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
