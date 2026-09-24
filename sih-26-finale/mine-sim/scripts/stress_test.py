"""Stress test for the v1 simulator: physics, world, sizing, radio, sensors, provenance, run.

    cd mine-sim && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 scripts/stress_test.py

Prints PASS / WARN / FAIL per check, then a count. Exit code 1 if any FAIL.
WARN = works as coded, but a known open question (see project-updates/2026-09-14.md).
Takes about one minute. Writes only to a temp directory.
"""

import csv
import dataclasses
import hashlib
import math
import shutil
import sys
import tempfile
import warnings
from pathlib import Path

import numpy as np
import yaml
from scipy.integrate import quad
from scipy.special import erf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from minesim import physics  # noqa: E402
from minesim.config import load_config  # noqa: E402
from minesim.errors import ContractViolation  # noqa: E402
from minesim.radio import UPLINK_WINDOW_CLOSE_S, Superframe, deduplicate  # noqa: E402
from minesim.run import run_sim  # noqa: E402
from minesim.sensors import SCOUT_TIERS, read_node  # noqa: E402
from minesim.sizing import _tilt_detectable, size_network  # noqa: E402
from minesim.stream import replay_terrain  # noqa: E402
from minesim.world import WorldState  # noqa: E402

RESULTS = {"PASS": 0, "WARN": 0, "FAIL": 0}


def report(name, ok, detail, warn_only=False):
    status = "PASS" if ok else ("WARN" if warn_only else "FAIL")
    RESULTS[status] += 1
    print(f"{status:4}  {name:52} {detail}", flush=True)


def section(title):
    print(f"\n== {title} ==", flush=True)


def numeric_knothe(x, t, panel, knothe):
    """Direct quadrature of dS/dt = c (S_static - S), independent of the closed form."""
    a = math.sqrt(math.pi) / (panel.depth_m / knothe.tan_beta)
    t_stop = panel.length_m / knothe.advance_m_per_day

    def f_static(tau):
        face = min(knothe.advance_m_per_day * tau, panel.length_m)
        return 0.5 * (erf(a * x) - erf(a * (x - face)))

    c = knothe.time_coefficient
    lag, _ = quad(lambda tau: c * math.exp(-c * (t - tau)) * f_static(tau), 0.0, t, limit=500,
                  points=[t_stop] if t > t_stop else None)
    s_full = knothe.subsidence_factor * panel.seam_thickness_m * 1000.0
    return s_full * erf(a * panel.width_m / 2.0) * lag


def physics_checks(cfg):
    section("1. Physics  S(x,y,t)")
    # Section 1 checks the closed form of S(x,y,t) against the Knothe ODE, so it runs on ONE panel on
    # the axis. A district is a sum of these; section 1's identities are about the term, not the sum.
    one = physics.as_single_panel(cfg.panel)
    P, K = dataclasses.replace(one, inflection_offset_m=0.0), cfg.knothe   # classical panel for the ODE checks
    s_full = K.subsidence_factor * P.seam_thickness_m * 1000.0
    Pd, d = one, one.inflection_offset_m
    eff = dataclasses.replace(Pd, width_m=Pd.width_m - 2 * d, length_m=Pd.length_m - 2 * d, inflection_offset_m=0.0)
    xs_line = np.linspace(-300.0, Pd.length_m + 300.0, 601)
    diff = max(np.abs(physics.subsidence(xs_line, y, t, Pd, K)
                      - physics.subsidence(xs_line - d, y, t - 2 * d / K.advance_m_per_day, eff, K)).max()
               for t in (30.0, 300.0, 700.0) for y in (0.0, 80.0))
    report(f"offset d={d:g} m == Knothe on the effective panel", diff < 1e-9, f"max diff {diff:.1e} mm")

    err = max(abs(physics.subsidence(float(x), 0.0, float(t), P, K) - numeric_knothe(x, t, P, K))
              for t in (1, 50, 312, 624, 626, 690, 3000) for x in (-300, 0, 600, 1250, 2400, 2500, 3000))
    report("closed form == numeric Knothe integral", err < 0.05, f"max error {err:.1e} mm")

    Ps, Ks = dataclasses.replace(P, length_m=800.0), dataclasses.replace(K, advance_m_per_day=0.5, time_coefficient=0.2)
    err = max(abs(physics.subsidence(float(x), 0.0, float(t), Ps, Ks) - numeric_knothe(x, t, Ps, Ks))
              for t in (5, 400, 1700) for x in (-100, 400, 790, 1200))
    report("same, slow face + fast settling (c/v = 0.4)", err < 0.05, f"max error {err:.1e} mm")

    xs = np.arange(-2 * cfg.r, P.length_m + 2 * cfg.r, 5.0)[:, None]
    ys = np.arange(-P.width_m / 2 - 2 * cfg.r, P.width_m / 2 + 2 * cfg.r, 5.0)[None, :]
    prev = np.zeros((xs.shape[0], ys.shape[1]))
    bad = rise = step = 0.0
    for hour in range(1, 690 * 24 + 1):
        s = physics.subsidence(xs, ys, hour / 24.0, P, K)
        bad += np.count_nonzero(~np.isfinite(s)) + np.count_nonzero(s < 0)
        rise, step = max(rise, float((prev - s).max())), max(step, float((s - prev).max()))
        prev = s
    report("690 d hourly grid: finite and >= 0", bad == 0, f"{int(bad)} bad cells")
    report("ground only sinks (monotone in time)", rise < 1e-6, f"worst rise {rise:.1e} mm")
    report("no jumps in time", step < 5.0, f"max sink in one hour {step:.2f} mm")

    s = physics.subsidence(xs, ys, 312.0, P, K)
    cell_step = max(np.abs(np.diff(s, axis=0)).max(), np.abs(np.diff(s, axis=1)).max())
    bound = s_full / cfg.r * 5.0
    report("no cliffs between 5 m cells", cell_step <= bound * 1.01, f"max {cell_step:.1f} mm, bound {bound:.1f}")

    yy = np.linspace(0, 300, 31)
    asym = np.abs(physics.subsidence(1250.0, yy, 400.0, P, K) - physics.subsidence(1250.0, -yy, 400.0, P, K)).max()
    report("symmetric across the panel", asym < 1e-9, f"max asymmetry {asym:.1e} mm")

    a = math.sqrt(math.pi) / cfg.r
    xl = np.array([0.0, 100, 1250, 2400, 2500])
    static = s_full * erf(a * P.width_m / 2) * 0.5 * (erf(a * xl) - erf(a * (xl - P.length_m)))
    gap = np.abs(physics.subsidence(xl, 0.0, 5000.0, P, K) - static).max()
    report("long time -> static full-panel trough", gap < 0.01, f"max diff {gap:.1e} mm")

    peak = physics.subsidence(cfg.survey_line_x_m, np.linspace(-50, 50, 101), 690.0, Pd, K).max()
    report("peak at the survey line, day 690, vs field 1267 mm", abs(peak - 1267) / 1267 < 0.10,
           f"model {peak:.0f} mm ({100 * (peak - 1267) / 1267:+.1f}%) - was 930 mm (-27%)")

    yy = np.linspace(-600, 600, 2401)
    _, uy = physics.displacement(1250.0, yy, 400.0, P, K)
    report("horizontal movement points into the trough", uy[yy < -100][-1] > 0 and uy[yy > 100][0] < 0,
           f"u(-100)={uy[yy < -100][-1]:.0f} mm, u(+100)={uy[yy > 100][0]:.0f} mm")
    e = physics.strain(1250.0, yy, 400.0, P, K, cfg.sensing.strain_rod_baseline_m, "y")
    report("strain: compression centre, tension at ribs", e[1200] < 0 < e.max(),
           f"centre {e[1200]:.0f}, max tension {e.max():.0f} ustrain")
    report("strain integrates to zero net stretch", abs(np.trapezoid(e, yy) / 1000) < 1.0,
           f"{np.trapezoid(e, yy) / 1000:.3f} mm")

    nan_cases = 0
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for v in (0.25, 1, 4, 20):
            for c in (0.001, 0.013, 0.1, 1.0, 50.0):
                for depth in (50, 375, 1000):
                    Pp = dataclasses.replace(P, depth_m=depth)
                    Kp = dataclasses.replace(K, advance_m_per_day=v, time_coefficient=c)
                    xg = np.linspace(-2 * depth, P.length_m + 2 * depth, 400)
                    for t in (0.5, P.length_m / v / 2, 3 * P.length_m / v):
                        nan_cases += not np.all(np.isfinite(physics.subsidence(xg, 0.0, t, Pp, Kp)))
    report("180 extreme mine configs: no NaN / overflow", nan_cases == 0, f"{nan_cases} configs produced NaN")


def world_checks(cfg, layout):
    section("2. World state (terrain truth)")
    world = WorldState(cfg, layout)
    scouts = [n for n in layout.nodes if n.tier in SCOUT_TIERS]
    rising = worst = 0.0
    for k in range(690 * 24):
        rising += sum(1 for c in world.step().cells if c[2] > 0)
        if k % 97 == 0:
            for n in scouts:
                model = physics.subsidence(n.x_m, n.y_m, world.t_days, cfg.panel, cfg.knothe)
                worst = max(worst, abs(-world.z_at(n.x_m, n.y_m) - model))
    report("no cell ever rises (dz <= 0)", rising == 0, f"{int(rising)} rising deltas")
    report("node Z from grid tracks physics", worst < 5.0, f"max {worst:.2f} mm")
    return world


def sizing_radio_checks(cfg, layout, world):
    section("3. Sizing + radio")
    for spacing in (10.0, 25.0, 50.0, 100.0, 400.0):
        for kids in (1, 2, 8, 16):
            c2 = dataclasses.replace(cfg, layout=dataclasses.replace(cfg.layout, spacing_m=spacing,
                                                                      max_children_per_anchor=kids))
            name = f"spacing {spacing:g} m, {kids} children/anchor"
            try:
                lay = size_network(c2)
            except ContractViolation as exc:
                report(name, True, f"refuses loudly: {exc}")
                continue
            sc = [n for n in lay.nodes if n.tier in SCOUT_TIERS]
            anchors = {n.node_id for n in lay.nodes if n.tier == "anchor"}
            groups = {}
            for n in sc:
                groups.setdefault(n.parent_id, []).append(n.child_index)
            radio = Superframe(c2, lay)
            last = max(radio.slot_of(n.node_id)[2] for n in sc) + radio._uplink_ms / 1000.0
            ok = (all(n.parent_id in anchors and n.backup_parent_id in anchors and n.backup_parent_id != n.parent_id
                      for n in sc)
                  and all(sorted(v) == list(range(len(v))) and len(v) <= kids for v in groups.values())
                  and last <= UPLINK_WINDOW_CLOSE_S)
            report(name, ok, f"{len(sc)} scouts, {len(anchors)} anchors, INR {lay.cost.total_inr:,}")

    far = {n.tier for n in layout.nodes if n.line == "longitudinal" and n.x_m > cfg.survey_line_x_m + cfg.r}
    report("W2 identical far-field nodes share one tier", len(far) == 1, f"tiers {sorted(far)}")
    detectable = []
    for n in layout.nodes:
        if n.tier == "1A":
            peak = max(np.hypot(*physics.tilt(n.x_m, n.y_m, float(t), cfg.panel, cfg.knothe))
                       for t in range(0, cfg.sim.duration_days + 1, 5))
            detectable.append(_tilt_detectable(cfg, peak))
    report("W3 every tilt-only 1A node can see its tilt", all(detectable), f"{sum(detectable)}/{len(detectable)} 1A nodes")

    scouts = [n for n in layout.nodes if n.tier in SCOUT_TIERS]
    readings = [read_node(n, world, cfg, np.random.default_rng(1)) for n in scouts]
    for p, want in ((0.0, 1.0), (1.0, 0.0)):
        c2 = dataclasses.replace(cfg, radio=dataclasses.replace(cfg.radio, bernoulli_loss_prob=p))
        recs = Superframe(c2, layout).run(readings, world.epoch, np.random.default_rng(0))
        report(f"loss probability {p}", sum(r.delivered for r in recs) / len(recs) == want,
               f"delivery {sum(r.delivered for r in recs)}/{len(recs)}")
    c2 = dataclasses.replace(cfg, radio=dataclasses.replace(cfg.radio, tx_power_dbm=-60.0))
    recs = Superframe(c2, layout).run(readings, world.epoch, np.random.default_rng(0))
    report("weak transmitter fails the link-margin check", sum(r.delivered for r in recs) < len(recs),
           f"{sum(r.delivered for r in recs)}/{len(recs)} delivered at -60 dBm")
    radio, rng, recs = Superframe(cfg, layout), np.random.default_rng(3), []
    for epoch in range(1, 2001):
        recs += radio.run(readings, epoch, rng)
        if epoch == 1000:
            for n in scouts:
                radio.reboot(n.node_id)
    delivered = sum(r.delivered for r in recs)
    report("dedup on (node_id, epoch) survives reboots", len(deduplicate(recs)) == delivered,
           f"{len(deduplicate(recs))} unique of {delivered} delivered")


def provenance_checks(cfg):
    section("4. Sensors + provenance")
    worst = 0.0
    for n in [n for n in size_network(cfg).nodes if n.tier in SCOUT_TIERS]:
        for t in range(0, 691, 5):
            tx, ty = physics.tilt(n.x_m, n.y_m, float(t), cfg.panel, cfg.knothe)
            e = max(abs(physics.strain(n.x_m, n.y_m, float(t), cfg.panel, cfg.knothe, b, ax))
                    for b in (cfg.sensing.strain_rod_baseline_m, cfg.sensing.extensometer_baseline_m) for ax in "xy")
            worst = max(worst, abs(tx), abs(ty), e)
    report("tilt/strain fit the 16-bit radio payload", worst + 3500 < 32767, f"peak {worst:.0f} (limit 32767)")

    lay = size_network(cfg)
    world = WorldState(cfg, lay)
    for _ in range(24 * 210):
        world.step()
    tags, jump = {}, 0.0
    for n in [n for n in lay.nodes if n.tier in SCOUT_TIERS]:
        v = read_node(n, world, cfg, np.random.default_rng(0)).subsidence
        tags[v.provenance] = tags.get(v.provenance, 0) + 1
        if v.provenance == "real":
            jump = max(jump, abs(v.magnitude - (world.z_at(n.x_m, n.y_m) - n.z0_mm)))
    report("W1 nodes on the survey line carry real values", tags.get("real", 0) > 1, f"day 210 tags {tags}")
    report("W1 real value vs simulated terrain at that node", jump < 300.0, f"worst gap {jump:.0f} mm (was 1,198)")


def run_checks(cfg, tmp):
    section("5. Full run, determinism, mine swap, replay")
    digest = lambda d: hashlib.sha256((d / "nodes.csv").read_bytes()).hexdigest()[:12]  # noqa: E731
    s1 = run_sim(cfg, 3, tmp / "a")
    run_sim(cfg, 3, tmp / "b")
    run_sim(cfg, 3, tmp / "c", seed=7)
    report("same seed -> byte-identical nodes.csv", digest(tmp / "a") == digest(tmp / "b"), digest(tmp / "a"))
    report("different seed -> different noise", digest(tmp / "a") != digest(tmp / "c"), digest(tmp / "c"))
    rows = list(csv.DictReader(open(tmp / "a" / "nodes.csv")))
    report("rows = scouts x epochs", len(rows) == s1["scouts"] * s1["epochs"], f"{len(rows)} rows")
    tags = {r[k] for r in rows for k in ("subsidence_prov", "tilt_prov", "strain_prov", "disp_prov")}
    report("only real / pinned / synthetic tags", tags <= {"real", "pinned", "synthetic", ""}, str(sorted(tags)))
    for days in (0, 1 / 24, 0.5):
        try:
            s = run_sim(cfg, days, tmp / f"d{days:.3f}")
            report(f"run --days {days:.3g}", True, f"{s['epochs']} epochs")
        except Exception as exc:  # noqa: BLE001
            report(f"run --days {days:.3g}", False, f"{type(exc).__name__}: {exc}")

    cdir = tmp / "config"
    shutil.copytree(Path(__file__).resolve().parents[1] / "config", cdir)
    assumptions = yaml.safe_load((cdir / "assumptions.yaml").read_text())
    assumptions["mine"] = "illinois_lw"
    assumptions["layout"]["source"] = "v1"   # section 5 checks the v1 travelling cross
    (cdir / "assumptions.yaml").write_text(yaml.safe_dump(assumptions))
    s = run_sim(load_config(cdir / "assumptions.yaml"), 2, tmp / "illinois", cdir / "assumptions.yaml")
    report("swap mine yaml -> Illinois runs, no code change", s["scouts"] > 0,
           f"{s['nodes_per_tier']}, INR {s['cost_inr']['total']:,}")
    share_1c = s["nodes_per_tier"].get("1C", 0) / s["scouts"]
    report("W2 Illinois: 1C is a band, not most of the network", share_1c < 0.5,
           f"{100 * share_1c:.0f}% of scouts are 1C (was 85%)")

    daily = dataclasses.replace(cfg, sim=dataclasses.replace(cfg.sim, timestep_s=86400.0))
    s = run_sim(daily, 1500, tmp / "long", seed=1)
    world = WorldState(daily, size_network(daily))
    expect = -np.rint(world.model_subsidence_mm(1500.0)).astype(np.int32)
    report("1500 d past panel end: replay == model exactly", np.array_equal(replay_terrain(tmp / "long"), expect),
           f"peak {s['peak_subsidence_mm']} mm")


def plan_checks(cfg, tmp):
    section("6. Planned network (layout.source: plan, F4)")
    lay = size_network(cfg)
    sc = [n for n in lay.nodes if n.tier in SCOUT_TIERS]
    anchors = {n.node_id for n in lay.nodes if n.tier == "anchor"}
    radio = Superframe(cfg, lay)
    last = max(radio.slot_of(n.node_id)[2] for n in sc) + radio._uplink_ms / 1000.0
    report("plan layout: parents, backups, child_index 0..cap-1",
           all(n.parent_id in anchors and n.backup_parent_id in anchors and n.backup_parent_id != n.parent_id for n in sc)
           and all(0 <= n.child_index < cfg.layout.max_children_per_anchor for n in sc),
           f"{len(sc)} scouts, {len(anchors)} anchors, INR {lay.cost.total_inr:,}")
    report("plan layout: every scout slot inside the uplink window", last <= UPLINK_WINDOW_CLOSE_S, f"last slot ends {last:.2f} s")
    c1 = dataclasses.replace(cfg, layout=dataclasses.replace(cfg.layout, max_children_per_anchor=1))
    try:
        size_network(c1)
        report("plan layout: 1 child per anchor refuses loudly", False, "no error")
    except ContractViolation as exc:
        report("plan layout: 1 child per anchor refuses loudly", True, str(exc))
    digest = lambda d: hashlib.sha256((d / "nodes.csv").read_bytes()).hexdigest()[:12]  # noqa: E731
    s1 = run_sim(cfg, 1, tmp / "plan_a")
    run_sim(cfg, 1, tmp / "plan_b")
    rows = sum(1 for _ in open(tmp / "plan_a" / "nodes.csv")) - 1
    report("plan run: rows = scouts x epochs", rows == len(sc) * s1["epochs"], f"{rows} rows")
    report("plan run: same seed -> byte-identical nodes.csv", digest(tmp / "plan_a") == digest(tmp / "plan_b"), digest(tmp / "plan_a"))


def main():
    root = Path(__file__).resolve().parents[1]
    cfg_file = load_config(root / "config" / "assumptions.yaml")
    # Sections 1-5 were written for the v1 travelling cross (spacing sweeps, longitudinal line); run them on it.
    cfg = dataclasses.replace(cfg_file, layout=dataclasses.replace(cfg_file.layout, source="v1"))
    layout = size_network(cfg)
    tmp = Path(tempfile.mkdtemp(prefix="minesim-stress-"))
    try:
        physics_checks(cfg)
        world = world_checks(cfg, layout)
        sizing_radio_checks(cfg, layout, world)
        provenance_checks(cfg)
        run_checks(cfg, tmp)
        if cfg_file.layout.source == "plan":
            plan_checks(cfg_file, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\nRESULT: {RESULTS['PASS']} pass, {RESULTS['WARN']} warn, {RESULTS['FAIL']} fail")
    sys.exit(1 if RESULTS["FAIL"] else 0)


if __name__ == "__main__":
    main()
