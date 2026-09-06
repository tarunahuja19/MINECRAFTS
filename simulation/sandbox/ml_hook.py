"""
Machine Learning & GNN consumer hook (§Phase 12).

Provides a clean, decoupled interface for processing 60-second simulation packets.
The ML/GNN pipeline does not depend on the frontend or rendering components.
"""

from typing import Any, Callable

_ml_handlers: list[Callable[[dict[str, Any]], None]] = []


def register_ml_handler(handler: Callable[[dict[str, Any]], None]) -> None:
    """Register an external ML/GNN consumer callback."""
    if handler not in _ml_handlers:
        _ml_handlers.append(handler)


def unregister_ml_handler(handler: Callable[[dict[str, Any]], None]) -> None:
    """Unregister an external ML/GNN consumer callback."""
    if handler in _ml_handlers:
        _ml_handlers.remove(handler)


def process_simulation_packet(packet: dict[str, Any]) -> dict[str, Any]:
    """Process a 60-second simulation packet for ML/GNN analysis.

    Parameters
    ----------
    packet : dict
        Standardized 60-second simulation packet containing:
        - packet['packet_id'], packet['session_id'], packet['grid_id']
        - packet['start_sim_time'], packet['end_sim_time']
        - packet['nodes']: list of node aggregates and readings
        - packet['terrain']: changed boolean, max subsidence, and delta lists
        - packet['events']: zone transitions, collapses, blasts

    Returns
    -------
    dict
        Processed ML inferences, anomaly scores, or predictions.
    """
    packet_id = packet.get("packet_id", 0)
    nodes = packet.get("nodes", [])
    terrain = packet.get("terrain", {})
    events = packet.get("events", [])

    # Stub inference: compute node risk score based on aggregated strain & tilt
    node_scores: dict[int, float] = {}
    for n in nodes:
        nid = n["node_id"]
        aggs = n.get("aggregates", {})
        strain = aggs.get("max_strain") or 0.0
        tilt_mag = aggs.get("max_tilt_magnitude") or 0.0
        # Normalised heuristic risk metric in [0.0, 1.0]
        # Tensile limit is 5.3 mm/m = 5300 ue
        strain_risk = min(1.0, max(0.0, float(strain) / 5300.0))
        tilt_risk = min(1.0, max(0.0, float(tilt_mag) / 5000.0))
        risk_score = round(max(strain_risk, tilt_risk), 4)
        node_scores[nid] = risk_score

    # Dispatch to registered external models (e.g. PyTorch Geometric GNN)
    for handler in list(_ml_handlers):
        try:
            handler(packet)
        except Exception as e:
            print(f"[ML_HOOK] Handler error: {e}")

    return {
        "packet_id": packet_id,
        "status": "ready",
        "node_risk_scores": node_scores,
        "nodes_analyzed": len(nodes),
        "terrain_deformed": terrain.get("changed", False),
        "events_detected": len(events),
    }

