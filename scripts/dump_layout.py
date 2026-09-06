#!/usr/bin/env python3
"""
Dump canonical node layout from the simulation to:
1. simulation/frontend/src/components/NodeMarkers.tsx (FALLBACK_NODES)
2. dashboard_electron/fixtures/nodes.json
"""

import json
import re
import sys
from pathlib import Path
import urllib.request

REPO_ROOT = Path(__file__).resolve().parent.parent
SIM_DIR = REPO_ROOT / "simulation"
sys.path.insert(0, str(SIM_DIR))


def get_node_defs():
    from sandbox.server import _node_defs
    return _node_defs()


def main():
    node_defs = get_node_defs()
    from sandbox import geo, dem

    # 1. Update dashboard_electron/fixtures/nodes.json
    fixtures_nodes = []
    for d in node_defs:
        nid_int = d["id"]
        node_id = f"N{nid_int:02d}"
        x = d["x"]
        y = d["y"]
        tier = d["tier"]
        lat, lng = geo.xy_to_latlon(float(x), float(y))
        z = round(float(dem.elevation_at(float(x), float(y))), 3)

        if tier in ("1A", "1B", "1C"):
            node_type = "scout"
        elif tier in ("2A", "2B"):
            node_type = "anchor"
        else:
            node_type = "gateway"

        if tier == "1A":
            ring = "inner"
        elif tier == "3":
            ring = "outer"
        else:
            ring = "middle"

        fixtures_nodes.append({
            "node_id": node_id,
            "label": node_id,
            "lat": round(lat, 7),
            "lng": round(lng, 7),
            "ring": ring,
            "state": "active",
            "tier": tier,
            "node_type": node_type,
            "x": x,
            "y": y,
            "z": z,
        })

    fixtures_path = REPO_ROOT / "dashboard_electron" / "fixtures" / "nodes.json"
    with open(fixtures_path, "w", encoding="utf-8") as f:
        json.dump(fixtures_nodes, f, indent=2)
        f.write("\n")
    print(f"[dump_layout] Updated {fixtures_path}")

    # 2. Update simulation/frontend/src/components/NodeMarkers.tsx
    nodemarkers_path = REPO_ROOT / "simulation" / "frontend" / "src" / "components" / "NodeMarkers.tsx"
    with open(nodemarkers_path, "r", encoding="utf-8") as f:
        content = f.read()

    lines = ["export const FALLBACK_NODES: NodeDef[] = ["]
    for d in node_defs:
        parent_id_str = "null" if d["parent_id"] is None else str(d["parent_id"])
        backup_id_str = "null" if d["backup_parent_id"] is None else str(d["backup_parent_id"])
        cluster_id_str = "null" if d["cluster_id"] is None else str(d["cluster_id"])
        dist_str = "null" if d["dist_to_parent_m"] is None else f"{d['dist_to_parent_m']:.2f}"
        tx_str = "null" if d["tx_dbm"] is None else str(d["tx_dbm"])

        lines.append(
            f'  {{ id: {d["id"]}, x: {d["x"]}, y: {d["y"]}, tier: "{d["tier"]}", '
            f'role: "{d["role"]}", parent_id: {parent_id_str}, '
            f'backup_parent_id: {backup_id_str}, cluster_id: {cluster_id_str}, '
            f'hop_count: {d["hop_count"]}, dist_to_parent_m: {dist_str}, tx_dbm: {tx_str} }},'
        )
    lines.append("];")
    new_fallback_block = "\n".join(lines)

    pattern = re.compile(r"export const FALLBACK_NODES: NodeDef\[\] = \[.*?\];", re.DOTALL)
    if pattern.search(content):
        updated_content = pattern.sub(new_fallback_block, content)
        with open(nodemarkers_path, "w", encoding="utf-8") as f:
            f.write(updated_content)
        print(f"[dump_layout] Updated {nodemarkers_path}")
    else:
        print("[dump_layout] Error: FALLBACK_NODES block not found in NodeMarkers.tsx", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
