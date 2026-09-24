"""Real-anchored survey-line dataset: keep every measured value, derive every missing column from it.

    cd mine-sim && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 scripts/build_anchored_dataset.py

Rule (Adarsh, 2026-09-14): a value present in the field data is never changed. A value that is
missing is derived from the values that are present:

  1. Physics prior   S_fit(y, t) = physics.subsidence at the survey line with the pinned fit.
  2. ML correction   a Gaussian process learns the residual (measured - S_fit) over (y, t),
                     scaled by the ground's development fraction D(t) at the line (0 before the face
                     arrives, -> 1 when settled), so nothing moves before mining. Hyperparameters by
                     maximum marginal likelihood (best of three starts). Gives a 1-sigma uncertainty.
  3. Keep measured   on a survey day at a monument, the row carries the measured value exactly.
  4. Derive          tilt, curvature, horizontal displacement (U = B * tilt), strain (dU/dy) and
                     rates from the derived surface — the same Knothe relations physics.py uses.

Provenance stays within the three tags (invariant 6): measured -> real; fitted + learned value at a
monument off a survey day -> pinned; every derivative -> synthetic. A separate `*_basis` column says
what each value is built from, so "synthetic" derived from real data is not confused with noise.

Output: handoff/v2-real-anchored/ (survey_line_daily.csv.gz, preview, validation.json).
"""

import csv
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.linalg import cho_factor, cho_solve
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from minesim import physics  # noqa: E402
from minesim.config import load_config  # noqa: E402
from minesim.fitting import load_profile_csv  # noqa: E402

OUT = ROOT.parent / "handoff" / "v2-real-anchored"
DERIV_STEP_M = 1.0          # finite-difference step for spatial derivatives of the derived surface
MONOTONE_TOL_MM = 0.1       # a derived value may not rise by more than this between days


# ---------- Gaussian process on residuals ----------

def _kernel(a, b, log_params):
    sig_f, ly, lt = np.exp(log_params[:3])
    dy = (a[:, None, 0] - b[None, :, 0]) / ly
    dt = (a[:, None, 1] - b[None, :, 1]) / lt
    return sig_f ** 2 * np.exp(-0.5 * (dy ** 2 + dt ** 2))


def _neg_log_marginal(log_params, X, r):
    K = _kernel(X, X, log_params) + (np.exp(log_params[3]) ** 2 + 1e-6) * np.eye(len(r))
    try:
        c = cho_factor(K, lower=True)
    except np.linalg.LinAlgError:
        return 1e12
    alpha = cho_solve(c, r)
    return 0.5 * r @ alpha + np.log(np.diag(c[0])).sum() + 0.5 * len(r) * math.log(2 * math.pi)


class ResidualGP:
    """Squared-exponential GP in (y, t). The y length scale is floored at two monument gaps: a shape
    narrower than that is not resolved by the survey, so without the floor the GP fits digitisation
    wiggles (7 m scale, 2 mm noise, ground rising between days) instead of ground movement."""

    def __init__(self, X, r, min_length_y_m):
        bounds = [(0.0, 8.0), (math.log(min_length_y_m), math.log(300.0)), (math.log(5.0), math.log(2000.0)), (0.0, 6.0)]
        fit = min((minimize(_neg_log_marginal, np.log([np.std(r), k * min_length_y_m, 150.0, 30.0]), args=(X, r),
                            method="L-BFGS-B", bounds=bounds) for k in (1.0, 2.0, 4.0)), key=lambda f: f.fun)
        self.log_params, self.X = fit.x, X
        K = _kernel(X, X, fit.x) + (np.exp(fit.x[3]) ** 2 + 1e-6) * np.eye(len(r))
        self._c = cho_factor(K, lower=True)
        self._alpha = cho_solve(self._c, r)

    def predict(self, Xs):
        Ks = _kernel(Xs, self.X, self.log_params)
        mean = Ks @ self._alpha
        v = cho_solve(self._c, Ks.T)
        var = np.exp(self.log_params[0]) ** 2 - np.einsum("ij,ji->i", Ks, v)
        return mean, np.sqrt(np.clip(var, 0.0, None))

    @property
    def hyper(self):
        sig_f, ly, lt, sig_n = np.exp(self.log_params)
        return {"signal_sigma_mm": round(sig_f, 1), "length_scale_y_m": round(ly, 1),
                "length_scale_t_days": round(lt, 1), "noise_sigma_mm": round(sig_n, 1)}


# ---------- build ----------

def main():
    cfg = load_config(ROOT / "config" / "assumptions.yaml")
    if cfg.survey_line_x_m is None:
        raise SystemExit("survey_line_x_m is null in the mine file; nothing to anchor to")
    y_data, t_data, s_meas, _ = load_profile_csv(cfg.profiles_csv)     # s_meas negative down
    y0, x_line = cfg.survey_origin_offset_m, cfg.survey_line_x_m
    # The anchor is the measured LW1 survey line, so the prior is LW1 alone, never a district (F6 B).
    P, K = physics.as_single_panel(cfg.panel), cfg.knothe

    def prior(y_panel, day):                                              # negative down, mm
        return -physics.subsidence(np.full(len(y_panel), x_line), y_panel, float(day), P, K)

    s_prior = np.concatenate([prior(y_data[t_data == d] - y0, d) for d in np.unique(t_data)])
    order = np.concatenate([np.flatnonzero(t_data == d) for d in np.unique(t_data)])
    prior_at_data = np.empty_like(s_meas)
    prior_at_data[order] = s_prior
    s_settled = physics.subsidence(x_line, 0.0, 1.0e6, P, K)

    def development(day):                                                 # 0 before the face arrives -> 1 settled
        return physics.subsidence(x_line, 0.0, float(day), P, K) / s_settled

    X = np.column_stack([y_data, t_data])
    dev_data = np.array([development(d) for d in t_data])
    resid = (s_meas - prior_at_data) / dev_data
    min_ly = 2.0 * float(np.median(np.diff(np.unique(y_data))))           # two monument gaps
    gp = ResidualGP(X, resid, min_ly)

    # Validation: hold out each survey day, predict it from the rest.
    folds = []
    for day in np.unique(t_data):
        hold = t_data == day
        g = ResidualGP(X[~hold], resid[~hold], min_ly)
        mean, _ = g.predict(X[hold])
        miss = resid[hold] * dev_data[hold]
        folds.append({"held_out_day": int(day), "n": int(hold.sum()),
                      "physics_only_rms_mm": round(float(np.sqrt(np.mean(miss ** 2))), 1),
                      "physics_plus_gp_rms_mm": round(float(np.sqrt(np.mean((miss - mean * dev_data[hold]) ** 2))), 1)})

    monuments = np.unique(y_data)
    measured = {(float(y), int(d)): float(s) for y, d, s in zip(y_data, t_data, s_meas)}
    days = np.arange(0, cfg.sim.duration_days + 1)
    b_m = cfg.r / math.sqrt(2.0 * math.pi)                                 # Knothe B, as in physics.displacement
    face_x = np.minimum(K.advance_m_per_day * days, P.length_m)

    def surface(y_csv, day):
        y_csv = np.asarray(y_csv, dtype=float)
        mean, sd = gp.predict(np.column_stack([y_csv, np.full(len(y_csv), float(day))]))
        dev = development(day)
        return prior(y_csv - y0, day) + dev * mean, dev * sd

    rows, monotone_fixes, max_rise = [], 0, 0.0
    last = {float(y): 0.0 for y in monuments}
    for day in days:
        s, sd = surface(monuments, day)
        sp, _ = surface(monuments + DERIV_STEP_M, day)
        sm, _ = surface(monuments - DERIV_STEP_M, day)
        s_prev, _ = surface(monuments, max(day - 1, 0))
        tilt_mm_m = (sp - sm) / (2 * DERIV_STEP_M)                        # d(subsidence_mm)/dy, mm/m
        curv = (sp - 2 * s + sm) / DERIV_STEP_M ** 2                       # mm/m^2 = 1/km
        disp = -b_m * tilt_mm_m                                            # U = B dS/dy with S positive down
        half_rod = cfg.sensing.strain_rod_baseline_m / 2.0                 # strain over the A8 rod, as physics.strain
        u_plus = -b_m * (surface(monuments + half_rod + DERIV_STEP_M, day)[0]
                         - surface(monuments + half_rod - DERIV_STEP_M, day)[0]) / (2 * DERIV_STEP_M)
        u_minus = -b_m * (surface(monuments - half_rod + DERIV_STEP_M, day)[0]
                          - surface(monuments - half_rod - DERIV_STEP_M, day)[0]) / (2 * DERIV_STEP_M)
        strain = (u_plus - u_minus) / cfg.sensing.strain_rod_baseline_m * 1000.0   # mm/m -> microstrain
        tx_model, ty_model = physics.tilt(x_line, monuments - y0, float(day), P, K)
        e_model = physics.strain(x_line, monuments - y0, float(day), P, K, cfg.sensing.strain_rod_baseline_m, "y")
        for k, y in enumerate(monuments):
            key = (float(y), int(day))
            if key in measured:
                value, prov, basis, unc = measured[key], "real", "measured: JMMF 2022 digitised", 0.0
            else:
                value, prov, basis, unc = float(s[k]), "pinned", "physics fit + GP correction", float(sd[k])
                if value > last[float(y)] + MONOTONE_TOL_MM:               # ground only sinks (derived values)
                    max_rise = max(max_rise, value - last[float(y)])
                    value, monotone_fixes = last[float(y)], monotone_fixes + 1
                last[float(y)] = min(last[float(y)], value)
            rows.append({
                "day": int(day), "monument_distance_m": float(y), "y_panel_m": round(float(y - y0), 2),
                "x_line_m": x_line, "face_x_m": float(face_x[day]), "face_ahead_of_line_m": round(float(face_x[day] - x_line), 1),
                "subsidence_mm": round(value, 1), "subsidence_prov": prov, "subsidence_basis": basis,
                "subsidence_sigma_mm": round(unc, 1),
                "subsidence_rate_mm_per_day": round(float(s[k] - s_prev[k]), 3),
                "tilt_y_urad": round(float(tilt_mm_m[k]) * 1000.0, 0),
                "curvature_y_per_km": round(float(curv[k]), 4),
                "disp_y_mm": round(float(disp[k]), 1),
                "strain_y_ustrain": round(float(strain[k]), 0),
                "derived_prov": "synthetic", "derived_basis": "derived from the real-anchored surface",
                "tilt_y_physics_urad": round(float(-ty_model[k]), 0),
                "strain_y_physics_ustrain": round(float(e_model[k]), 0),
                "tilt_x_urad": round(float(-tx_model[k]), 0), "tilt_x_prov": "synthetic",
                "tilt_x_basis": "physics model only (no along-panel survey)",
            })

    OUT.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0])
    with gzip.open(OUT / "survey_line_daily.csv.gz", "wt", newline="") as f:
        w = csv.DictWriter(f, fields)
        w.writeheader()
        w.writerows(rows)
    with open(OUT / "survey_line_preview.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fields)
        w.writeheader()
        w.writerows([r for r in rows if r["day"] in (0, 100, 210, 250, 690)])
    counts = {}
    for r in rows:
        counts[r["subsidence_prov"]] = counts.get(r["subsidence_prov"], 0) + 1
    summary = {
        "rows": len(rows), "monuments": len(monuments), "days": len(days),
        "subsidence_provenance": counts,
        "value_columns": {"real_or_pinned": 1, "derived_from_real_anchored_surface": 5, "model_only": 1},
        "gp_hyperparameters": gp.hyper,
        "leave_one_survey_day_out": folds,
        "cv_rms_mm": {"physics_only": round(float(np.sqrt(np.mean([f["physics_only_rms_mm"] ** 2 for f in folds]))), 1),
                      "physics_plus_gp": round(float(np.sqrt(np.mean([f["physics_plus_gp_rms_mm"] ** 2 for f in folds]))), 1)},
        "monotone_fixes": monotone_fixes,
        "largest_clamped_rise_mm": round(max_rise, 2),
        "pinned_fit": json.loads((ROOT / "data" / "fitted" / "adriyala_lw1_params.json").read_text())["params"],
    }
    (OUT / "validation.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({k: summary[k] for k in ("rows", "subsidence_provenance", "gp_hyperparameters", "cv_rms_mm", "monotone_fixes", "largest_clamped_rise_mm")}, indent=2))
    for f_ in folds:
        print(f_)


if __name__ == "__main__":
    main()
