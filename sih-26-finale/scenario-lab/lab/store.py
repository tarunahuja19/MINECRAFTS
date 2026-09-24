"""Storage for Scenario Lab results (WP9 §1, §7, Sitting C).

Saved scenario results live under LabConfig.store_dir only.
scenario_id is the sha256 of the canonical request JSON, truncated to lab.id_hash_chars.
Re-saving the same request returns the same scenario_id.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from lab.config import LabConfig, load_lab_config


def canonical_request_json(req: Dict[str, Any]) -> str:
    """Format request dict as canonical JSON with sorted keys for deterministic hashing."""
    return json.dumps(req, sort_keys=True, separators=(",", ":"))


def scenario_id_for(req: Dict[str, Any], lab_cfg: Optional[LabConfig] = None) -> str:
    """Compute deterministic scenario_id: sha256 of canonical request JSON, first id_hash_chars."""
    lab = lab_cfg if lab_cfg is not None else load_lab_config()
    canonical = canonical_request_json(req).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[: lab.id_hash_chars]


def resolve_store_dir(
    store_dir: Optional[Union[str, Path]] = None,
    lab_cfg: Optional[LabConfig] = None,
) -> Path:
    """Resolve store directory path and ensure it exists.

    Defaults to LabConfig.store_dir relative to scenario-lab/.
    """
    if store_dir is not None:
        p = Path(store_dir).resolve()
    else:
        lab = lab_cfg if lab_cfg is not None else load_lab_config()
        base = Path(__file__).resolve().parent.parent
        p = (base / lab.store_dir).resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_scenario(
    req: Dict[str, Any],
    payload: Dict[str, Any],
    store_dir: Optional[Union[str, Path]] = None,
    lab_cfg: Optional[LabConfig] = None,
) -> str:
    """Save scenario result to store_dir/<scenario_id>.json.

    Stamps scenario_id, id, and request into payload.
    Ensures the target file path strictly resolves inside store_dir.
    """
    s_dir = resolve_store_dir(store_dir, lab_cfg)
    canonical = canonical_request_json(req)
    lab = lab_cfg if lab_cfg is not None else load_lab_config()
    sid = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[: lab.id_hash_chars]

    # Stamp payload
    payload["scenario_id"] = sid
    payload["id"] = sid
    payload["request"] = json.loads(canonical)

    target_file = (s_dir / f"{sid}.json").resolve()
    if not target_file.is_relative_to(s_dir):
        raise PermissionError(f"Target path {target_file} resolves outside store directory {s_dir}")

    target_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return sid


def get_scenario(
    scenario_id: str,
    store_dir: Optional[Union[str, Path]] = None,
    lab_cfg: Optional[LabConfig] = None,
) -> Optional[Dict[str, Any]]:
    """Load saved scenario by ID. Returns None if not found."""
    s_dir = resolve_store_dir(store_dir, lab_cfg)
    target_file = (s_dir / f"{scenario_id}.json").resolve()
    if not target_file.is_relative_to(s_dir):
        raise PermissionError(f"Target path {target_file} resolves outside store directory {s_dir}")
    if not target_file.is_file():
        return None
    return json.loads(target_file.read_text(encoding="utf-8"))


def list_scenarios(
    store_dir: Optional[Union[str, Path]] = None,
    lab_cfg: Optional[LabConfig] = None,
) -> List[Dict[str, Any]]:
    """List all saved scenarios in store_dir, sorted by filename."""
    s_dir = resolve_store_dir(store_dir, lab_cfg)
    results: List[Dict[str, Any]] = []
    for f in sorted(s_dir.glob("*.json")):
        try:
            results.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue
    return results
