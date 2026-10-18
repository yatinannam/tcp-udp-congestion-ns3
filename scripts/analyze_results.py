#!/usr/bin/env python3
"""Generate charts from results/summary.csv, timeseries.csv and cwnd.csv.

Only measured values are plotted. A chart whose input rows are missing is
skipped with a message instead of being drawn from placeholders.
"""

import argparse
import csv
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Reference palette, light mode: categorical slots 1-3 plus neutral ink.
COLORS = {"tcp": "#2a78d6", "udp": "#eb6834", "queue": "#1baf7a"}
INK = "#52514e"
REF = "#8a8984"
LABELS = {"tcp": "TCP", "udp": "UDP"}

plt.rcParams.update({
    "figure.dpi": 120,
    "savefig.dpi": 150,
    "font.size": 10,
    "axes.titlesize": 11,
    "axes.edgecolor": REF,
    "axes.labelcolor": INK,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.color": "#e4e3df",
    "grid.linewidth": 0.8,
    "xtick.color": INK,
    "ytick.color": INK,
    "legend.frameon": False,
    "lines.linewidth": 2,
})


# --------------------------------------------------------------------------- data

def load_csv(path, required=True):
    if not path.is_file():
        if required:
            raise SystemExit(f"ERROR: {path} not found. Run scripts/run_experiments.py first.")
        return []
    with open(path, newline="") as fh:
        rows = list(csv.DictReader(fh))
    if required and not rows:
        raise SystemExit(f"ERROR: {path} is empty. Run scripts/run_experiments.py first.")
    return rows


def num(value):
    """CSV cell -> float, or None when blank/unparseable (never a fake zero)."""
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def where(rows, **conds):
    return [r for r in rows if all(r.get(k) == v for k, v in conds.items())]


def save(fig, out_dir, name):
    path = out_dir / name
    fig.tight_layout()
    fig.savefig(path, metadata={"Software": None})
    plt.close(fig)
    print(f"wrote plots/{name}")


def skip(name, reason):
    print(f"skipped {name}: {reason}")


def bar_labels(ax, bars, values, fmt):
    for bar, v in zip(bars, values):
        ax.annotate(fmt.format(v), (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                    xytext=(0, 3), textcoords="offset points", ha="center", va="bottom", color=INK)


# --------------------------------------------------------------------------- charts

def sweep_points(summary, metric):
    pts = []
    for r in where(summary, experiment="udp-sweep", flow="udp"):
        x, y = num(r["requested_rate_mbps"]), num(r[metric])
        if x is not None and y is not None:
            pts.append((x, y, num(r["bottleneck_mbps"])))
    return sorted(pts)


def plot_udp_goodput(summary, out_dir):
    name = "1_udp_offered_vs_goodput.png"
    pts = sweep_points(summary, "app_goodput_mbps")
    if len(pts) < 2:
        return skip(name, "need at least 2 udp-sweep runs")
    xs, ys, caps = zip(*pts)
    fig, ax = plt.subplots(figsize=(6, 4.2))
    lim = max(xs) * 1.1
    ax.plot([0, lim], [0, lim], ls="--", lw=1, color=REF, label="delivered = offered")
    if len(set(caps)) == 1 and caps[0] is not None:
        ax.axhline(caps[0], ls=":", lw=1, color=INK, label=f"bottleneck capacity ({caps[0]:g} Mbps)")
    ax.plot(xs, ys, marker="o", ms=8, color=COLORS["udp"], label="UDP delivered goodput")
    for x, y in zip(xs, ys):
        ax.annotate(f"{y:.2f}", (x, y), xytext=(6, -12), textcoords="offset points", color=INK)
    ax.set(xlim=(0, lim), ylim=(0, lim), xlabel="Requested UDP sending rate (Mbps)",
           ylabel="Delivered application goodput (Mbps)",
           title="UDP offered load vs delivered goodput")
    ax.legend(loc="upper left")
    save(fig, out_dir, name)


def plot_udp_loss(summary, out_dir):
    name = "2_udp_offered_vs_loss.png"
    pts = sweep_points(summary, "udp_loss_pct")
    if len(pts) < 2:
        return skip(name, "need at least 2 udp-sweep runs with loss data")
    xs, ys, _ = zip(*pts)
    fig, ax = plt.subplots(figsize=(6, 4.2))
    ax.plot(xs, ys, marker="o", ms=8, color=COLORS["udp"])
    for x, y in zip(xs, ys):
        ax.annotate(f"{y:.1f}%", (x, y), xytext=(6, 4), textcoords="offset points", color=INK)
    ax.set(xlim=(0, max(xs) * 1.1), ylim=(0, max(max(ys) * 1.2, 5)),
           xlabel="Requested UDP sending rate (Mbps)", ylabel="Estimated packet loss (%)",
           title="UDP offered load vs estimated loss\n(app Tx packets - sink Rx packets) / Tx")
    save(fig, out_dir, name)


def plot_udp_delay(summary, out_dir):
    name = "3_udp_offered_vs_delay.png"
    pts = sweep_points(summary, "mean_delay_ms")
    if len(pts) < 2:
        return skip(name, "need at least 2 udp-sweep runs with delay data")
    xs, ys, _ = zip(*pts)
    fig, ax = plt.subplots(figsize=(6, 4.2))
    ax.plot(xs, ys, marker="o", ms=8, color=COLORS["udp"])
    for x, y in zip(xs, ys):
        ax.annotate(f"{y:.1f} ms", (x, y), xytext=(6, 4), textcoords="offset points", color=INK)
    ax.set(xlim=(0, max(xs) * 1.1), ylim=(0, max(ys) * 1.25), xlabel="Requested UDP sending rate (Mbps)",
           ylabel="Mean one-way delay (ms)", title="UDP offered load vs mean delay (FlowMonitor, IP layer)")
    save(fig, out_dir, name)


def baseline_rows(summary):
    rows = {}
    for r in where(summary, experiment="baseline"):
        rows[r["flow"]] = r
    return rows


def plot_baseline_goodput(summary, out_dir):
    name = "4_baseline_goodput.png"
    rows = baseline_rows(summary)
    flows = [f for f in ("tcp", "udp") if f in rows and num(rows[f]["app_goodput_mbps"]) is not None]
    if len(flows) < 2:
        return skip(name, "need both baseline-tcp and baseline-udp")
    vals = [num(rows[f]["app_goodput_mbps"]) for f in flows]
    req = num(rows[flows[0]]["requested_rate_mbps"])
    cap = num(rows[flows[0]]["bottleneck_mbps"])
    fig, ax = plt.subplots(figsize=(5, 4.2))
    bars = ax.bar([LABELS[f] for f in flows], vals, width=0.5, color=[COLORS[f] for f in flows])
    if req is not None:
        ax.axhline(req, ls="--", lw=1, color=REF, label=f"requested rate ({req:g} Mbps)")
        ax.legend(loc="lower right")
    bar_labels(ax, bars, vals, "{:.3f}")
    ax.set(ylabel="Application goodput (Mbps)", ylim=(0, max(vals + [req or 0]) * 1.3),
           title=f"Matched-rate baseline: paced OnOff at {req:g} Mbps\n"
                 f"(separate runs, {cap:g} Mbps bottleneck)")
    save(fig, out_dir, name)


def plot_baseline_delay_jitter(summary, out_dir):
    name = "5_baseline_delay_jitter.png"
    rows = baseline_rows(summary)
    flows = [f for f in ("tcp", "udp") if f in rows]
    delays = [num(rows[f]["mean_delay_ms"]) for f in flows]
    jitters = [num(rows[f]["mean_jitter_ms"]) for f in flows]
    if len(flows) < 2 or None in delays or None in jitters:
        return skip(name, "need delay and jitter for both baseline flows")
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(8, 4.2))
    for ax, vals, label, fmt in ((a1, delays, "Mean one-way delay (ms)", "{:.2f}"),
                                 (a2, jitters, "Mean jitter (ms)", "{:.3f}")):
        bars = ax.bar([LABELS[f] for f in flows], vals, width=0.5, color=[COLORS[f] for f in flows])
        bar_labels(ax, bars, vals, fmt)
        ax.set(ylabel=label, ylim=(0, max(vals) * 1.3 if max(vals) > 0 else 1))
    a1.set_title("Delay")
    a2.set_title("Jitter (delay variation)")
    fig.suptitle("Baseline delay and jitter (FlowMonitor, IP layer; TCP includes retransmitted packets)",
                 fontsize=10, color=INK)
    save(fig, out_dir, name)


def plot_mixed_goodput(summary, out_dir):
    name = "6_mixed_goodput.png"
    rows = {r["flow"]: r for r in where(summary, experiment="mixed")}
    flows = [f for f in ("tcp", "udp") if f in rows and num(rows[f]["app_goodput_mbps"]) is not None]
    if len(flows) < 2:
        return skip(name, "need both flows of the mixed run")
    vals = [num(rows[f]["app_goodput_mbps"]) for f in flows]
    cap = num(rows["tcp"]["bottleneck_mbps"])
    udp_req = num(rows["udp"]["requested_rate_mbps"])
    fig, ax = plt.subplots(figsize=(5.5, 4.2))
    labels = ["TCP (BulkSend)", f"UDP (CBR {udp_req:g} Mbps)" if udp_req else "UDP"]
    bars = ax.bar(labels, vals, width=0.5, color=[COLORS[f] for f in flows])
    bar_labels(ax, bars, vals, "{:.3f}")
    if cap is not None:
        ax.axhline(cap, ls=":", lw=1, color=INK, label=f"bottleneck capacity ({cap:g} Mbps)")
        ax.legend(loc="upper right")
    ax.set(ylabel="Application goodput (Mbps)", ylim=(0, (cap or max(vals)) * 1.25),
           title=f"Mixed competition: total {sum(vals):.2f} Mbps delivered")
    save(fig, out_dir, name)


def plot_cwnd(cwnd, out_dir):
    run_ids = sorted({r["run_id"] for r in cwnd})
    if not run_ids:
        return skip("7_cwnd_*.png", "no congestion-window samples in cwnd.csv")
    for run_id in run_ids:
        pts = [(num(r["time_s"]), num(r["cwnd_bytes"])) for r in where(cwnd, run_id=run_id)]
        pts = [(t, c) for t, c in pts if t is not None and c is not None]
        if len(pts) < 2:
            skip(f"7_cwnd_{run_id}.png", "too few samples")
            continue
        ts, cs = zip(*pts)
        fig, ax = plt.subplots(figsize=(7, 3.8))
        ax.step(ts, [c / 1024 for c in cs], where="post", color=COLORS["tcp"])
        ax.set(xlabel="Simulation time (s)", ylabel="Congestion window (KiB)",
               title=f"TCP NewReno congestion window - {run_id} (from CongestionWindow trace)")
        ax.set_ylim(bottom=0)
        save(fig, out_dir, f"7_cwnd_{run_id}.png")


def plot_mixed_timeseries(ts_rows, summary, out_dir):
    name = "8_mixed_goodput_timeseries.png"
    rows = where(ts_rows, run_id="mixed")
    series = {}
    for f in ("tcp", "udp"):
        pts = [(num(r["time_s"]), num(r["goodput_mbps"]), num(r["bin_s"])) for r in where(rows, flow=f)]
        series[f] = [p for p in pts if None not in p]
    if not all(series.values()):
        return skip(name, "mixed time series missing")
    fig, ax = plt.subplots(figsize=(7.5, 4))
    for f, pts in series.items():
        ts, gs, bins = zip(*pts)
        ax.step([t + b for t, b in zip(ts, bins)], gs, where="pre", color=COLORS[f], label=LABELS[f])
    cap = next((num(r["bottleneck_mbps"]) for r in where(summary, experiment="mixed")), None)
    if cap:
        ax.axhline(cap, ls=":", lw=1, color=INK, label=f"capacity ({cap:g} Mbps)")
    ax.set(xlabel="Simulation time (s)", ylabel="Goodput per bin (Mbps)",
           title=f"Mixed run: receiver goodput over time ({series['tcp'][0][2]:g} s bins)")
    ax.set_ylim(bottom=0)
    ax.legend(loc="upper right")
    save(fig, out_dir, name)


def plot_queue(ts_rows, out_dir):
    run_ids = sorted({r["run_id"] for r in ts_rows if r["flow"] == "bottleneck"})
    if not run_ids:
        return skip("9_queue_*.png", "no bottleneck rows in timeseries.csv")
    for run_id in run_ids:
        pts = [(num(r["time_s"]), num(r["queue_len_max_pkts"]), num(r["queue_drops_cum"]))
               for r in where(ts_rows, run_id=run_id, flow="bottleneck")]
        pts = [p for p in pts if None not in p]
        if not pts:
            skip(f"9_queue_{run_id}.png", "no queue samples")
            continue
        ts, qlen, drops = zip(*pts)
        fig, (a1, a2) = plt.subplots(2, 1, figsize=(7, 5), sharex=True)
        a1.step(ts, qlen, where="post", color=COLORS["queue"])
        a1.set(ylabel="Peak queue (packets)", title=f"Bottleneck queue - {run_id}")
        a1.set_ylim(bottom=0)
        a2.step(ts, drops, where="post", color=INK)
        a2.set(xlabel="Simulation time (s)", ylabel="Cumulative drops (packets)")
        a2.set_ylim(bottom=0)
        save(fig, out_dir, f"9_queue_{run_id}.png")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--results-dir", type=Path, default=PROJECT_ROOT / "results")
    args = p.parse_args(argv)
    results = args.results_dir.resolve()

    summary = load_csv(results / "summary.csv")
    ts_rows = load_csv(results / "timeseries.csv", required=False)
    cwnd = load_csv(results / "cwnd.csv", required=False)
    out_dir = results / "plots"
    out_dir.mkdir(parents=True, exist_ok=True)

    plot_udp_goodput(summary, out_dir)
    plot_udp_loss(summary, out_dir)
    plot_udp_delay(summary, out_dir)
    plot_baseline_goodput(summary, out_dir)
    plot_baseline_delay_jitter(summary, out_dir)
    plot_mixed_goodput(summary, out_dir)
    plot_cwnd(cwnd, out_dir)
    plot_mixed_timeseries(ts_rows, summary, out_dir)
    plot_queue(ts_rows, out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
