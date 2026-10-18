#!/usr/bin/env python3
"""Build the NS-3 simulation and run the TCP/UDP congestion experiments.

Results policy: each run writes to results/runs/<run_id>/ (cleared before the
run). The consolidated results/summary.csv, timeseries.csv and cwnd.csv are
keyed by run_id: re-running a run replaces its rows, other runs' rows are kept.
A failed run has its rows removed so stale data never reaches the plots.
"""

import argparse
import csv
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SIM_SOURCE = PROJECT_ROOT / "simulation" / "tcp-udp-congestion.cc"
ANALYZE_SCRIPT = PROJECT_ROOT / "scripts" / "analyze_results.py"
TARGET = "tcp-udp-congestion"
MARKER = "// TCP-UDP-CONGESTION-DEMO"
RUN_TIMEOUT_S = 300

# run_id -> simulator arguments. Mode defaults (bottleneck rate, UDP rate)
# live in the C++ program; they are spelled out here for clarity.
RUNS = {
    "baseline-tcp": {"mode": "baseline", "protocol": "tcp", "bottleneckMbps": 20, "appRateMbps": 2},
    "baseline-udp": {"mode": "baseline", "protocol": "udp", "bottleneckMbps": 20, "appRateMbps": 2},
    "udp-sweep-2": {"mode": "udp-sweep", "bottleneckMbps": 5, "udpRateMbps": 2},
    "udp-sweep-5": {"mode": "udp-sweep", "bottleneckMbps": 5, "udpRateMbps": 5},
    "udp-sweep-8": {"mode": "udp-sweep", "bottleneckMbps": 5, "udpRateMbps": 8},
    "tcp-bulk": {"mode": "tcp-bulk", "bottleneckMbps": 5},
    "mixed": {"mode": "mixed", "bottleneckMbps": 5, "udpRateMbps": 3},
}
GROUPS = {
    "baseline": ["baseline-tcp", "baseline-udp"],
    "udp-sweep": ["udp-sweep-2", "udp-sweep-5", "udp-sweep-8"],
    "tcp-bulk": ["tcp-bulk"],
    "mixed": ["mixed"],
}
QUICK = ["baseline-udp", "udp-sweep-8", "mixed"]
CONSOLIDATED = ["summary.csv", "timeseries.csv", "cwnd.csv"]


class RunnerError(Exception):
    """A setup problem that should stop the runner with a clear message."""


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ns3-root", default=os.environ.get("NS3_ROOT"),
                   help="NS-3 source directory containing ./ns3 (or set $NS3_ROOT)")
    sel = p.add_mutually_exclusive_group()
    sel.add_argument("--quick", action="store_true", help=f"smoke test: {', '.join(QUICK)}")
    sel.add_argument("--only", nargs="+", metavar="NAME", choices=list(dict.fromkeys([*GROUPS, *RUNS])),
                     help="experiment groups or run ids to run, e.g. --only mixed udp-sweep-8")
    p.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                   help="override a simulator argument for every selected run, e.g. --set queuePackets=20")
    p.add_argument("--pcap", action="store_true", help="also write bottleneck pcap files")
    p.add_argument("--results-dir", type=Path, default=PROJECT_ROOT / "results")
    p.add_argument("--skip-build", action="store_true", help="do not run ./ns3 build")
    p.add_argument("--no-plots", action="store_true", help="do not call analyze_results.py")
    return p.parse_args(argv)


def select_runs(args):
    if args.quick:
        return list(QUICK)
    if not args.only:
        return list(RUNS)
    selected = []
    for name in args.only:
        for run_id in GROUPS.get(name, [name]):
            if run_id not in selected:
                selected.append(run_id)
    return selected


def parse_overrides(pairs):
    overrides = {}
    for item in pairs:
        key, sep, value = item.partition("=")
        if not sep or not key or not value:
            raise RunnerError(f"--set expects KEY=VALUE, got '{item}'")
        if key in ("outputDir", "runId", "mode"):
            raise RunnerError(f"--set {key} is managed by the runner")
        overrides[key] = value
    return overrides


def validate_ns3_root(path):
    if not path:
        raise RunnerError("NS-3 location unknown: pass --ns3-root or set NS3_ROOT")
    root = Path(path).expanduser().resolve()
    if not (root / "ns3").is_file() or not (root / "scratch").is_dir():
        raise RunnerError(f"'{root}' does not look like an NS-3 source tree (no ./ns3 or scratch/)")
    return root


def install_source(ns3_root):
    """Copy the simulation into scratch/<TARGET>/ without clobbering foreign files."""
    dest_dir = ns3_root / "scratch" / TARGET
    dest = dest_dir / SIM_SOURCE.name
    if dest_dir.exists():
        foreign = [f.name for f in dest_dir.iterdir() if f.name != SIM_SOURCE.name]
        if foreign:
            raise RunnerError(f"{dest_dir} contains files this project did not create: {foreign}")
        if dest.exists() and not dest.read_text(errors="replace").startswith(MARKER):
            raise RunnerError(f"refusing to overwrite {dest}: it was not created by this project")
    dest_dir.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.read_bytes() != SIM_SOURCE.read_bytes():
        shutil.copyfile(SIM_SOURCE, dest)
        print(f"Installed {SIM_SOURCE.name} -> {dest}")


def run_command(cmd, cwd, log_path=None, timeout=None):
    """Run a command (argument list, no shell). Returns (ok, combined output)."""
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        output = proc.stdout + proc.stderr
        ok = proc.returncode == 0
    except subprocess.TimeoutExpired as exc:
        output = f"TIMEOUT after {timeout}s\n{exc.stdout or ''}{exc.stderr or ''}"
        ok = False
    if log_path:
        log_path.write_text(output)
    return ok, output


def report_failure(cmd, output, lines=25):
    print(f"  FAILED command: {shlex.join(cmd)}")
    for line in output.strip().splitlines()[-lines:]:
        print(f"    | {line}")


def build(ns3_root):
    print("Building NS-3 (./ns3 build) ...")
    cmd = ["./ns3", "build"]
    ok, output = run_command(cmd, ns3_root)
    if not ok:
        report_failure(cmd, output, lines=40)
        raise RunnerError("build failed")


def simulator_command(run_id, run_dir, overrides, pcap):
    params = dict(RUNS[run_id])
    params.update(overrides)
    params["outputDir"] = str(run_dir)
    params["runId"] = run_id
    if pcap:
        params["pcap"] = "true"
    program = shlex.join([TARGET] + [f"--{k}={v}" for k, v in params.items()])
    return ["./ns3", "run", "--no-build", program]


def execute_run(ns3_root, results_dir, run_id, overrides, pcap):
    run_dir = results_dir / "runs" / run_id
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    cmd = simulator_command(run_id, run_dir, overrides, pcap)
    print(f"Running {run_id} ...")
    ok, output = run_command(cmd, ns3_root, run_dir / "console.log", RUN_TIMEOUT_S)
    missing = [name for name in CONSOLIDATED if not (run_dir / name).is_file()]
    if ok and missing:
        ok = False
        output += f"\nexpected output files missing: {missing}"
    if not ok:
        report_failure(cmd, output)
        return False
    for line in output.splitlines():
        if line.startswith("[") or "WARNING" in line or "queue drops" in line:
            print(f"  {line}")
    return True


def read_csv(path):
    with open(path, newline="") as fh:
        reader = csv.DictReader(fh)
        return list(reader.fieldnames or []), list(reader)


def run_order(run_id):
    keys = list(RUNS)
    return (keys.index(run_id) if run_id in keys else len(keys), run_id)


def merge_results(results_dir, succeeded, failed):
    """Replace rows of the touched runs in each consolidated CSV."""
    for name in CONSOLIDATED:
        dest = results_dir / name
        header, rows = read_csv(dest) if dest.is_file() else ([], [])
        touched = set(succeeded) | set(failed)
        rows = [r for r in rows if r.get("run_id") not in touched]
        for run_id in succeeded:
            new_header, new_rows = read_csv(results_dir / "runs" / run_id / name)
            header = new_header or header
            rows.extend(new_rows)
        if not header:
            continue
        rows.sort(key=lambda r: run_order(r.get("run_id", "")))  # stable: keeps time order
        with open(dest, "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=header, restval="", extrasaction="ignore",
                                    lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)


def main(argv=None):
    args = parse_args(argv)
    try:
        overrides = parse_overrides(args.set)
        ns3_root = validate_ns3_root(args.ns3_root)
        install_source(ns3_root)
        if not args.skip_build:
            build(ns3_root)
    except RunnerError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    results_dir = args.results_dir.resolve()
    selected = select_runs(args)
    succeeded, failed = [], []
    for run_id in selected:
        ok = execute_run(ns3_root, results_dir, run_id, overrides, args.pcap)
        (succeeded if ok else failed).append(run_id)

    merge_results(results_dir, succeeded, failed)

    plots_ok = True
    if not args.no_plots:
        print("Generating plots ...")
        cmd = [sys.executable, str(ANALYZE_SCRIPT), "--results-dir", str(results_dir)]
        plots_ok, output = run_command(cmd, PROJECT_ROOT)
        print("\n".join(f"  {line}" for line in output.strip().splitlines()))

    print("\n=== Summary ===")
    for run_id in selected:
        print(f"  {run_id:<14} {'OK' if run_id in succeeded else 'FAILED'}")
    if not plots_ok:
        print("  analysis       FAILED")
    print(f"Results: {results_dir}")
    if failed or not plots_ok:
        print(f"{len(failed)} run(s) failed; the suite is NOT complete.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
