"""Gate G01 - Exactly one implementation of S(x,y,t) exists in the repository."""

import ast
from pathlib import Path


def test_g01_single_physics_implementation():
    src_dir = Path(__file__).resolve().parent.parent.parent / "src" / "minesim"
    assert src_dir.is_dir(), f"src/minesim not found at {src_dir}"

    implementations = []

    for py_file in src_dir.glob("*.py"):
        if py_file.name == "fitting.py":
            # fitting.py imports physics.subsidence or defines fit curves
            continue
        with open(py_file, "r") as f:
            tree = ast.parse(f.read(), filename=str(py_file))

        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                # Check for erf call inside function body
                for subnode in ast.walk(node):
                    if isinstance(subnode, ast.Name) and subnode.id == "erf":
                        implementations.append((py_file.name, node.name))
                        break

    assert len(implementations) == 1, (
        f"Expected exactly 1 implementation referencing erf, found: {implementations}"
    )
    file_name, func_name = implementations[0]
    assert file_name == "physics.py", f"Implementation must live in physics.py, found in {file_name}"
    assert func_name == "subsidence", f"Implementation must be named subsidence, found {func_name}"
