#!/usr/bin/env python3
"""Simulate every knob combination of the interactive Lab and pack the results.

The Lab page cannot run NS-3 in a browser, so every configuration a visitor can
pick is simulated here ahead of time with the same NS-3 program. Outputs:

  results/lab/lab-data.json     compact per-run metrics + time series (read by the site)
  results/lab/lab-summary.csv   one row per flow per run (for checking by hand)

Raw per-run folders go to --work-dir (default: ~/tcp-udp-lab-runs, outside the
OneDrive project folder). Runs whose output already exists are reused unless
--force is given.
"""

import argparse
import csv
import itertools
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_experiments as rx  # noqa: E402  (shared NS-3 helpers)

GRID = {
    "bottleneck": [2, 5, 10],         # Mbps
    "queue": [10, 25, 50, 100],       # packets
    "delay": [5, 20, 50],             # ms, bottleneck one-way
    "udp": [0, 1, 2, 3, 4, 5, 6, 8, 10, 12],  # Mbps, 0 = UDP sender off
    "tcp": [0, 1],                    # TCP bulk sender off/on
}
CWND_BUCKET_S = 0.1  # downsampling window for the congestion window trace
OUTPUT_DIR = rx.PROJECT_ROOT / "results" / "lab"


def run_id(cfg):
    return f"b{cfg['bottleneck']}-q{cfg['queue']}-d{cfg['delay']}-t{cfg['tcp']}-u{cfg['udp']}"


def configurations():
    keys = list(GRID)
    for values in itertools.product(*(GRID[k] for k in keys)):
        cfg = dict(zip(keys, values))
        if cfg["tcp"] or cfg["udp"]:  # at least one sender
            yield cfg


def simulator_args(cfg, out_dir):
    if cfg["tcp"] and cfg["udp"]:
        mode = "mixed"
    elif cfg["tcp"]:
        mode = "tcp-bulk"
    else:
        mode = "udp-sweep"
    args = [f"--mode={mode}", f"--bottleneckMbps={cfg['bottleneck']}", f"--queuePackets={cfg['queue']}",
            f"--bottleneckDelayMs={cfg['delay']}", f"--outputDir={out_dir}", f"--runId={run_id(cfg)}"]
    if cfg["udp"]:
        args.append(f"--udpRateMbps={cfg['udp']}")
    return args


def find_binary(ns3_root):
    matches = sorted((ns3_root / "build" / "scratch" / rx.TARGET).glob(f"ns3*-{rx.TARGET}-*"))
    matches = [m for m in matches if m.is_file() and os.access(m, os.X_OK)]
    if not matches:
        raise rx.RunnerError("simulator binary not found; build it first (drop --skip-build)")
    return matches[0]


def simulate(binary, ns3_root, cfg, work_dir, force):
    out_dir = work_dir / run_id(cfg)
    if not force and all((out_dir / f).is_file() for f in rx.CONSOLIDATED):
        return cfg, True, "cached"
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [str(binary)] + simulator_args(cfg, out_dir)
    ok, output = rx.run_command(cmd, ns3_root, out_dir / "console.log", rx.RUN_TIMEOUT_S)
    if ok and not all((out_dir / f).is_file() for f in rx.CONSOLIDATED):
        ok, output = False, output + "\nmissing output files"
    return cfg, ok, output


# --------------------------------------------------------------------------- packing

def num(value, digits=4):
    if value in (None, ""):
        return None
    return round(float(value), digits)


def downsample_cwnd(rows):
    """Keep the min and max of each bucket so the sawtooth's peaks and cuts survive."""
    buckets = {}
    for r in rows:
        t, c = float(r["time_s"]), int(r["cwnd_bytes"])
        buckets.setdefault(int(t / CWND_BUCKET_S), []).append((t, c))
    out = []
    for key in sorted(buckets):
        pts = buckets[key]
        lo, hi = min(pts, key=lambda p: p[1]), max(pts, key=lambda p: p[1])
        for t, c in sorted({lo, hi}):
            out.append([round(t, 3), c])
    return out


def pack_run(cfg, out_dir):
    _, summary = rx.read_csv(out_dir / "summary.csv")
    _, series = rx.read_csv(out_dir / "timeseries.csv")
    _, cwnd = rx.read_csv(out_dir / "cwnd.csv")
    flows = {}
    for r in summary:
        flows[r["flow"]] = {
            "goodput": num(r["app_goodput_mbps"]),
            "delay": num(r["mean_delay_ms"], 3),
            "jitter": num(r["mean_jitter_ms"], 4),
            "loss": num(r["udp_loss_pct"], 3),
            "tx": int(r["app_tx_packets"]) if r["app_tx_packets"] else None,
            "rx": int(r["app_rx_packets"]) if r["app_rx_packets"] else None,
        }
    ts = {"tcp": [], "udp": [], "qlen": [], "drops": []}
    for r in series:
        if r["flow"] == "bottleneck":
            ts["qlen"].append(int(r["queue_len_max_pkts"]))
            ts["drops"].append(int(r["queue_drops_cum"]))
        else:
            ts[r["flow"]].append(num(r["goodput_mbps"], 3))
    return {
        "cfg": cfg,
        "flows": flows,
        "drops": int(summary[0]["bottleneck_queue_drops"]),
        "ts": {k: v for k, v in ts.items() if v},
        "cwnd": downsample_cwnd(cwnd),
    }, summary


def write_outputs(packed, summaries, ns3_root):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    first = summaries[0][0]
    data = {
        "meta": {
            "ns3": ns3_root.name,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "grid": GRID,
            "packetSize": int(first["packet_size_bytes"]),
            "appStart": float(first["app_start_s"]),
            "appStop": float(first["app_stop_s"]),
            "simStop": float(first["sim_stop_s"]),
            "bin": 0.5,
            "tcpVariant": "TcpNewReno",
        },
        "runs": packed,
    }
    (OUTPUT_DIR / "lab-data.json").write_text(json.dumps(data, separators=(",", ":")))
    header = list(first.keys())
    with open(OUTPUT_DIR / "lab-summary.csv", "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        for rows in summaries:
            writer.writerows(rows)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ns3-root", default=os.environ.get("NS3_ROOT"))
    p.add_argument("--work-dir", type=Path, default=Path.home() / "tcp-udp-lab-runs")
    p.add_argument("--jobs", type=int, default=max((os.cpu_count() or 2) - 2, 1))
    p.add_argument("--force", action="store_true", help="re-simulate runs that already have output")
    p.add_argument("--skip-build", action="store_true")
    args = p.parse_args(argv)

    try:
        ns3_root = rx.validate_ns3_root(args.ns3_root)
        rx.install_source(ns3_root)
        if not args.skip_build:
            rx.build(ns3_root)
        binary = find_binary(ns3_root)
    except rx.RunnerError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    configs = list(configurations())
    print(f"Simulating {len(configs)} configurations with {args.jobs} parallel jobs ...")
    failed = []
    done = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(simulate, binary, ns3_root, c, args.work_dir, args.force) for c in configs]
        for fut in as_completed(futures):
            cfg, ok, output = fut.result()
            done += 1
            if not ok:
                failed.append(run_id(cfg))
                print(f"  FAILED {run_id(cfg)}")
                print("\n".join(f"    | {l}" for l in output.strip().splitlines()[-8:]))
            if done % 50 == 0 or done == len(configs):
                print(f"  {done}/{len(configs)} done")

    if failed:
        print(f"{len(failed)} run(s) failed; lab dataset NOT written.", file=sys.stderr)
        return 1

    packed, summaries = {}, []
    for cfg in configs:
        run, summary = pack_run(cfg, args.work_dir / run_id(cfg))
        packed[run_id(cfg)] = run
        summaries.append(summary)
    write_outputs(packed, summaries, ns3_root)
    size_kb = (OUTPUT_DIR / "lab-data.json").stat().st_size / 1024
    print(f"Wrote {OUTPUT_DIR / 'lab-data.json'} ({size_kb:.0f} KB, {len(packed)} runs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
