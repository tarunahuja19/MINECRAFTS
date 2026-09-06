"""SSM+GNN discrete-time survival model for mine ground-collapse hazard.

Implements `trainiging file making/plan_1_patched.md`. Module layout mirrors
the plan's §7.4 four-stage split deliberately:

    config.py   all tunables, including every [OPEN] choice + justification
    data.py     parquet -> tensors, feature schema, leakage exclusion, windows
    graph.py    per-mine radius graph with guaranteed self-loops (§4.1)
    model.py    SelectiveSSM / ComputeGate / SpatialGNN / HazardHead
    losses.py   censored survival NLL (§6) + physics regularizers (§7)
    train.py    mine-level batching, truncated BPTT, masking (§8)
"""
