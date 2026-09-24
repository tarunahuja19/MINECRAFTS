---
title: Sensor Noise Models & Corruption Pipeline
slug: sensor-noise-and-corruption-chain
type: concept
module: sensors
status: reviewed
tags: [sensors, noise, corruption-chain, quantization, bias, thermal-drift]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP4-sensor-models-provenance.md
---

# Sensor Noise Models & Corruption Pipeline

Mathematical definition of the hardware simulation pipeline implemented in `src/minesim/sensors.py` to turn clean mathematical ground deformation into realistic physical telemetry.

---

## 1. Five-Stage Sequential Corruption Pipeline

For each physical measurement, the sensor model applies transformations in strict sequence:

```mermaid
flowchart LR
    V0["Ideal Physical Value"] --> Q["1. Quantisation<br/>ADC LSB"]
    Q --> B["2. Constant Bias<br/>Calibration Offset"]
    B --> T["3. Thermal Drift<br/>Diurnal Temp Cycle"]
    T --> G["4. Gaussian Noise<br/>Sensor SNR"]
    G --> Vout["Emitted Telemetry"]
```

$$V_{quant} = \text{round}\left(\frac{V_{ideal}}{\Delta_{LSB}}\right) \cdot \Delta_{LSB}$$
$$V_{bias} = V_{quant} + b_{sensor}$$
$$V_{thermal} = V_{bias} + \alpha_{T} \cdot (T_{ambient}(t) - T_0)$$
$$V_{emitted} = V_{thermal} + \mathcal{N}(0, \sigma^2)$$

---

## 2. Sensor Tier Specifications

| Tier | Transducer | Baseline | Resolution ($\Delta_{LSB}$) | Thermal Drift ($\alpha_T$) | Noise ($\sigma$) |
|---|---|---|---|---|---|
| **Tier 1A** | MPU-6050 Accelerometer | Spot | $10.0\ \mu\text{rad}$ | **$50.0\ \mu\text{rad}/^\circ\text{C}$** | $25.0\ \mu\text{rad}$ |
| **Tier 1B** | Invar Rod + Foil Gauge | 10.0 m | $1.0\ \mu\epsilon$ | $2.0\ \mu\epsilon/^\circ\text{C}$ | $5.0\ \mu\epsilon$ |
| **Tier 1C** | Wire Extensometer + LVDT | 30.0 m | $0.1\ \mu\epsilon$ | $0.5\ \mu\epsilon/^\circ\text{C}$ | $1.0\ \mu\epsilon$ |

---

## 3. The Thermal Drift Trap (Why Tilt is Secondary)

Consumer MEMS accelerometers (e.g. MPU-6050 in Tier 1A) exhibit severe temperature sensitivity:
- Surface temperatures in the Ramagundam coalfield vary from $15^\circ\text{C}$ at night to $45^\circ\text{C}$ in summer ($\Delta T = 30^\circ\text{C}$).
- Over a diurnal cycle, MEMS tilt drifts by:
  $$\Delta T_{thermal} = 30^\circ\text{C} \times 50\ \mu\text{rad}/^\circ\text{C} = 1500\ \mu\text{rad} = 1.5\text{ mrad}$$
- For early subsidence detection ($S \approx 10\text{ mm}$), real physical tilt is often $< 500\ \mu\text{rad}$.
- The thermal drift signal is **$3\times$ larger** than the early subsidence signal!
- **System Decision:** Tilt is treated strictly as a secondary confirmation vote, never a primary alarm trigger. Extensometer strain (Tiers 1B & 1C) provides primary detection.

---

## 4. Cross-References

- **Implementation Package:** [[work-packages/WP4-sensor-models-provenance]]
- **Provenance Tagging:** [[notes/sensors/sensor-provenance-and-tagging]]
- **Kinematic Derivatives:** [[notes/physics/subsidence-derivatives-and-curvature]]
