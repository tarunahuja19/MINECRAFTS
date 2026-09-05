# 3D PINN Subsidence Sandbox (`pinn-sandbox`)

A real-time, interactive 3D digital twin and Physics-Informed Neural Network (PINN) simulator for mining-induced ground subsidence monitoring and geotechnical risk forecasting.

![3D PINN Scene Overview](out/stage2.png)

---

## 🌟 Key Capabilities & Features

- **Analytic Ground Engine**: Implements the Knothe time-dependent profile function with exact analytical gradients $\nabla S$, analytical Hessians $\mathbf{H}_S$, displacement vectors $\mathbf{U} = -B\nabla S$, tilt vectors $\mathbf{T} = \nabla S$, strain along extensometer chords $\varepsilon = -B(\hat{\mathbf{e}}^T \mathbf{H}_S \hat{\mathbf{e}})$, and chord extension $\Delta = (\mathbf{U}(C) - \mathbf{U}(A))\cdot\hat{\mathbf{e}}$.
- **Physics-Informed Neural Network (PINN)**: 13,000-parameter coordinate MLP $(x, y, t) \to S$ trained with warm-started Adam on streaming Level D sensor telemetry.
- **Learnable Physics Prior**: Learnable parameters $\hat{a}$ (subsidence factor) and $\hat{c}$ (time constant) that prevent circular regression and adapt to physical data while regularizing unmonitored sectors.
- **Hardware Sensor Fleet Simulation**: 28 field monitoring pegs + 2 deep anchors + 1 LoRa gateway executing a realistic 6-step physical damage chain (thermal drift, battery decay, quantization, bias walk, blast transients, and dynamic $\sigma$).
- **Mesh Networking & Multi-Hop Radio**: Path loss, SNR-dependent packet drop, multi-hop routing, cluster outages, and fleet revival.
- **Interactive 3D Visualization**: PyVista VTK renderer featuring in-place mesh mutation, custom Turbo colormap, wireframe ground truth ghost, error sheet delta visualization, draw-angle cones, 3D extensometer chords, and real-time 2D monospace telemetry HUD.
- **Web & Desktop Modes**: Native desktop GUI with slider widgets & interactive action buttons or remote browser streaming via PyVista Trame web server.

---

## 📐 The 7 Non-Negotiable Invariants

| Invariant | Description | Verification |
| :--- | :--- | :--- |
| **I1: Single Source of Truth** | Exactly one analytical implementation of $S(x, y, t)$ in `ground/surface.py`. | Verified by mathematical test suite. |
| **I2: AST Import Isolation** | `scoring/score.py` is the only module permitted to import `truth/`. PINN modules have zero access to truth parameters. | AST import graph validation in `tests/test_physics_leak.py`. |
| **I3: Render-Only Exaggeration** | Vertical exaggeration $E$ is purely a render-time coordinate multiplier ($z = -S \times E$). Physics/losses strictly use unexaggerated metres. | Verified in `viz/scene.py`. |
| **I4: Main Thread VTK Safety** | Worker threads communicate with renderer exclusively via thread-safe locked `SurfaceBuffer`. Only main thread touches VTK actors. | Zero Cocoa/VTK threading deadlocks. |
| **I5: In-Place Mutation** | Mesh structured grid topology created once; simulation ticks mutate `mesh.points[:, 2]` in place. | >45 FPS render performance. |
| **I6: Downward Sign Convention** | Subsidence $S$ is positive downward in metres. Visual renderer maps positive subsidence to negative elevation $z = -S \times E$. | Verified across all shaders. |
| **I7: Deterministic Seeds** | Per-sensor noise driven by deterministic seeds in `config/nodes.json` for bit-identical simulation reproducibility. | Verified in `tests/test_sim.py`. |

---

## 🚀 Quickstart & Installation

### 1. Environment Setup

Create and activate the Conda Python 3.11 environment:

```bash
conda create -n pinn-sandbox python=3.11 -y
conda activate pinn-sandbox
pip install -r requirements.txt
```

### 2. Running the Application

#### Interactive Live 3D Desktop Window (Default)
```bash
python -m viz.app
```

#### Remote Web Streaming (Trame on `localhost:8080`)
```bash
python -m viz.app --web
```

#### Stage 0 Smoke Test (Sine wave mutation benchmark)
```bash
python -m viz.app --stage0
```

#### Stage 2 Static 3D Scene Composition
```bash
python -m viz.app --stage2
```

#### Headless Verification
```bash
python -m viz.app --headless-test
```

---

## 🎮 Interactive Controls & Keybindings

### Sliders (Left Panel)
- **Sim Day** `[0 - 40 days]`: Seek simulation clock forward or backward in time (triggers automatic Adam momentum reset).
- **Speed** `[0x - 2000x]`: Control wall-clock simulation acceleration (set to 0 to pause).
- **Vert Exag** `[1x - 500x]`: Real-time vertical exaggeration multiplier (default: 100x).
- **Phys Weight $w$** `[0.0 - 1.0]`: Collocation physics prior weight balance.
- **Retrain Steps** `[50 - 1000]`: Number of warm-started Adam optimization steps per received epoch.

### Interactive Buttons & Fault Injection
- 🔴 **Kill Cluster**: Kills 8 high-strain sensors over the active extraction face. The PINN seamlessly deforms toward the physics prior in the unmonitored sector.
- 🛑 **Kill ALL (Falsification Gate)**: Kills all 28 sensors to demonstrate non-circularity (error degrades >7.0x without data).
- 🟢 **Revive Fleet**: Restores radio communication across all field monitoring nodes.
- 🟠 **Inject Blast (120kg)**: Simulates a 120 kg explosive excavation round at $(310, 95)$, triggering transient sensor noise and uncompensated offsets.
- 🔵 **Reset PINN**: Randomizes MLP weights and prior parameters to demonstrate cold convergence from scratch.

### Keyboard Shortcuts
- `T` / `t`: Toggle Wireframe Ground Truth Ghost overlay.
- `E` / `e`: Toggle Absolute Error Sheet ($|S_{\text{PINN}} - S_{\text{Truth}}|$) visualization.
- `D` / `d`: Toggle Geotechnical Draw-Angle Cones ($35^\circ$ limit angle).
- `X` / `x`: Toggle 3D Extensometer Chord lines between Pegs A and C.
- `G` / `g`: Start / Stop GIF session recording (saved to `out/session.gif`).

---

## 📊 Performance Benchmarks (Q1 Results)

All performance benchmarks measured on standard CPU execution (`torch.set_num_threads(2)`):

| Metric | Measured Value | Requirement / Target | Status |
| :--- | :--- | :--- | :--- |
| **Q1 Retrain Time (Median)** | **393.6 ms** | $\le 1000\,\text{ms}$ | **PASSED** |
| **Q1 Retrain Time (p95)** | **412.9 ms** | $\le 1500\,\text{ms}$ | **PASSED** |
| **Render Frame Rate** | **> 45 FPS** | $\ge 30\,\text{FPS}$ | **PASSED** |
| **Day 40 PINN RMSE** | **43.1 mm** (2.2% max subsidence) | $\le 65\,\text{mm}$ | **PASSED** |
| **Falsification Degradation** | **7.01x** error increase without sensors | $> 5.0\text{x}$ | **PASSED** |
| **Stage 0 Smoke Performance** | **68.2 FPS** | $\ge 30\,\text{FPS}$ | **PASSED** |
| **Stage 2 Orbit Performance** | **52.4 FPS** | $\ge 30\,\text{FPS}$ | **PASSED** |

---

## 🧪 Test Suite

Run the full automated test suite covering analytical ground derivatives, 40-day sensor fleet simulations, JSON schema validations, AST import leak checks, 40-day convergence benchmarks, and fault injection:

```bash
pytest tests/ -v
```

```
======================== 11 passed in 111.47s ========================
```

---

## 📁 Repository Structure

```
.
├── config/
│   └── nodes.json              # 31-radio mine layout (28 field + 2 anchors + 1 gateway)
├── ground/
│   └── surface.py              # Single source of truth for Knothe ground analytics
├── pinn/
│   ├── model.py                # 13k-parameter SubsidencePINN MLP architecture
│   ├── losses.py               # 5-term loss engine and learnable PhysicsPrior
│   └── trainer.py              # Warm-started Adam worker updating SurfaceBuffer
├── sim/
│   ├── sensors.py              # 6-step sensor physical damage chain and noise models
│   ├── radio.py                # Multi-hop mesh path loss and fault management
│   └── producer.py             # Telemetry producer emitting Level D JSON epochs
├── scoring/
│   └── score.py                # Isolated RMSE, MAE, and max-error evaluation engine
├── truth/
│   └── truth.py                # Isolated ground truth evaluation
├── viz/
│   ├── app.py                  # CLI entry point (--stage0, --stage2, --web)
│   ├── app_live.py             # 3-thread live simulation and PyVista window loop
│   ├── buffer.py               # Thread-safe locked SurfaceBuffer (Invariant I4)
│   ├── scene.py                # PyVista 3D structured mesh and visual actors
│   ├── hud.py                  # 2D Monospace telemetry HUD overlay
│   └── controls.py             # UI sliders, buttons, and keybindings
├── tests/
│   ├── test_ground.py          # Stage 1 analytical derivatives and line integrals
│   ├── test_sim.py             # Stage 3 schema validation and seed reproducibility
│   ├── test_physics_leak.py    # Stage 4 AST leak test & falsification gate
│   ├── test_trainer.py         # Stage 4 40-day convergence and Q1 retrain benchmark
│   └── test_stage5_faults.py   # Stage 5 fault injection and GIF recording
└── out/
    ├── stage0.png              # Stage 0 smoke test screenshot
    ├── stage2.png              # Stage 2 static scene screenshot
    └── kill_cluster.gif        # Stage 5 cluster kill fault recording
```
