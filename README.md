# Performance Analysis of TCP and UDP Under Network Congestion Using NS-3

A small, reproducible NS-3 toolkit for a Computer Networks project. One C++
simulation program runs four experiments on a six-node dumbbell. Python scripts
run the experiments, merge the measurements into CSV files and draw the charts.

**Research question:** how do TCP and UDP behave as offered load approaches and
exceeds the capacity of a bottleneck link, and what changes when both compete
for the same congested link?

NS-3 is a discrete-event network simulator with real protocol implementations
(TCP NewReno, UDP, IPv4, queue discs). Experiments are repeatable, every
parameter is controlled, and the per-packet events that a physical testbed hides
can be measured.

## Topology

```
  TCP sender (n0) --\                                  /-- TCP receiver (n4)
     10.1.1.0/24     \                                /     10.1.4.0/24
                      RouterA (n2) ========= RouterB (n3)
     10.1.2.0/24     /       10.1.3.0/24 BOTTLENECK   \     10.1.5.0/24
  UDP sender (n1) --/                                  \-- UDP receiver (n5)

  access links: 100 Mbps, 1 ms      bottleneck: 5 Mbps (20 Mbps in baseline), 10 ms
  bottleneck queue: DropTail (FIFO queue disc), 50 packets, at RouterA's egress
```

Every data packet crosses RouterA -> RouterB. The access links are 20x faster
than the bottleneck, so the queue builds at RouterA and nowhere else.

## Experiments

| Run id | Mode | Bottleneck | Traffic | Shows |
|---|---|---|---|---|
| `baseline-tcp`, `baseline-udp` | `baseline` | 20 Mbps | one paced OnOff flow at 2 Mbps (separate runs) | low-load behaviour, protocol overhead |
| `udp-sweep-2/5/8` | `udp-sweep` | 5 Mbps | UDP CBR at 2, 5, 8 Mbps | offered load vs delivered goodput, loss, queueing delay |
| `tcp-bulk` | `tcp-bulk` | 5 Mbps | TCP BulkSend (greedy) | congestion window sawtooth, queue drops |
| `mixed` | `mixed` | 5 Mbps | TCP BulkSend + UDP CBR 3 Mbps | competition at a shared bottleneck |

Traffic runs from 1 s to 10 s. The simulation runs until 12 s so that packets
already in flight can drain.

## Theory in brief

- **TCP** is connection-oriented and reliable. The receiver acknowledges data,
  and lost segments are retransmitted. **Congestion control** (NewReno here)
  limits unacknowledged data to the *congestion window* (cwnd). Cwnd grows while
  ACKs arrive (slow start, then additive increase) and is roughly halved when a
  loss is detected, which produces the classic sawtooth.
- **UDP** is connectionless and unreliable. It has no ACKs, retransmissions or
  congestion control. A UDP application sends at whatever rate it chooses: its
  **offered load**.
- **Bottleneck and queue:** when packets arrive faster than the bottleneck can
  transmit them, they wait in the router queue (adding **queueing delay**). When
  the queue is full, DropTail discards new arrivals (**packet loss**).
- **Throughput vs goodput:** throughput counts all bits on the link (headers,
  retransmissions). **Goodput** counts only the application payload actually
  delivered to the receiver.
- **Delay** is the one-way time from sender IP layer to receiver IP layer.
  **Jitter** is the variation in delay between consecutive packets. **Loss** is
  the fraction of sent packets that never arrive.

## Setup (Windows 11 + WSL2 Ubuntu 24.04)

NS-3 does not build with the old MinGW toolchain on this PC, so everything runs
inside WSL2 Ubuntu. Open the Ubuntu terminal:

```bash
# 1. Tools (one-time, needs your sudo password)
sudo apt update && sudo apt install -y g++ cmake ninja-build python3 python3-matplotlib curl bzip2

# 2. NS-3.49 in the WSL home directory (building on /mnt/c is much slower)
cd ~ && curl -LO https://www.nsnam.org/releases/ns-3.49.tar.bz2
tar xjf ns-3.49.tar.bz2 && cd ns-3.49
./ns3 configure --enable-modules="point-to-point;internet;applications;traffic-control;flow-monitor"
./ns3 build
```

NS-3.49 requires g++ >= 11.1, CMake >= 3.25 and Python >= 3.10. Ubuntu 24.04
provides g++ 13, CMake 3.28 and Python 3.12. On native Linux the steps are the
same.

## Run

From the Ubuntu terminal, in the project folder:

```bash
cd /mnt/c/Users/ninja/OneDrive/Documents/Yatin/YUVAN-CN
export NS3_ROOT=~/ns-3.49

python3 scripts/run_experiments.py --quick              # smoke test: baseline-udp, udp-sweep-8, mixed
python3 scripts/run_experiments.py                      # full suite (7 runs) + plots
python3 scripts/run_experiments.py --only mixed         # one experiment group (or a run id)
python3 scripts/run_experiments.py --only mixed --set queuePackets=10   # change a parameter live
python3 scripts/analyze_results.py                      # regenerate charts from existing CSVs
```

The runner copies `simulation/tcp-udp-congestion.cc` into
`$NS3_ROOT/scratch/tcp-udp-congestion/`, builds it, runs the selected
experiments, merges the CSVs and calls the analysis script. It refuses to
overwrite a file in that folder that it did not create. If a run fails, it
prints the exact command and the error output, and it exits with a nonzero
status.

Running the simulator directly:

```bash
cd ~/ns-3.49
./ns3 run "tcp-udp-congestion --PrintHelp"
./ns3 run "tcp-udp-congestion --mode=udp-sweep --udpRateMbps=8 --outputDir=/tmp/sweep8"
./ns3 run "tcp-udp-congestion --mode=baseline --protocol=tcp --outputDir=/tmp/base-tcp"
```

### Simulator options

| Option | Default | Meaning |
|---|---|---|
| `--mode` | `mixed` | `baseline`, `udp-sweep`, `tcp-bulk`, `mixed` |
| `--protocol` | `tcp` | baseline transport: `tcp` or `udp` |
| `--bottleneckMbps` | 20 in baseline, else 5 | bottleneck rate |
| `--bottleneckDelayMs` | 10 | bottleneck one-way delay |
| `--queuePackets` | 50 | bottleneck FIFO capacity |
| `--udpRateMbps` | 8 in udp-sweep, 3 in mixed | UDP CBR rate |
| `--appRateMbps` | 2 | baseline paced rate |
| `--packetSize` | 1024 | application payload bytes (also the TCP segment size) |
| `--accessMbps`, `--accessDelayMs` | 100, 1 | access links (must stay faster than the bottleneck) |
| `--appStart`, `--appStop`, `--simStop` | 1, 10, 12 | seconds |
| `--binSize` | 0.5 | time-series bin width (s) |
| `--seed`, `--run` | 1, 1 | RNG settings (the scenario is deterministic) |
| `--outputDir`, `--runId` | | output folder and run label |
| `--pcap` | false | write bottleneck pcap files |

Invalid values (an unknown mode, a non-positive rate, `appStart >= appStop`,
`simStop <= appStop`, a queue < 1, or access links no faster than the
bottleneck) stop the program with an error message.

## Results website (frontend)

`frontend/` is a single-page site (Vite, React, Tailwind, GSAP, Lenis and
ReactBits components) that presents the measured results. It reads the merged
CSVs only: `npm run sync` copies `results/*.csv` into `frontend/public/data/`,
and this runs automatically before `dev` and `build`. Any experiment that
hasn't been run shows an empty panel with the command to run it.

It runs on Windows with Node.js (v24 is installed). WSL is not needed.

```powershell
cd frontend
npm install          # first time only
npm run dev          # http://localhost:5173
npm run build        # static site in frontend/dist (opens from any folder)
```

The site opens on the **Lab** tab, an interactive playground. Visitors set the
bottleneck speed, router buffer, link delay, the TCP sender and the UDP rate.
They predict the result, run it, and earn XP by completing missions such as
causing bufferbloat or starving TCP. Progress is saved in the browser. Every
Lab result is a real NS-3 run: `scripts/build_lab_dataset.py` simulates all
684 knob combinations ahead of time (about 3 minutes in WSL) and writes
`results/lab/lab-data.json` plus `results/lab/lab-summary.csv`:

```bash
python3 scripts/build_lab_dataset.py      # in WSL, with NS3_ROOT set
```

The **Report** tab is the guided write-up of the 7 main experiments. Its hero
replays any run's measured time series. Packets cross the topology,
the Router A queue fills to its measured occupancy, and drops fall away at the
measured rate. After re-running an experiment in WSL, refresh the page to see
the new numbers (or run `npm run sync` if the dev server is not running).

## Results and output files

| Path | Contents |
|---|---|
| `results/summary.csv` | one row per flow per run: goodput, bytes, FlowMonitor counters, delay, jitter, UDP loss, queue drops |
| `results/timeseries.csv` | per 0.5 s bin: goodput per flow, cwnd (TCP), cumulative queue drops and peak queue length (`flow=bottleneck` rows) |
| `results/cwnd.csv` | every congestion-window change from the NS-3 trace |
| `results/runs/<run_id>/` | raw per-run output: the three CSVs, `flowmon.xml`, `console.log`, optional pcap |
| `results/plots/*.png` | charts |

Re-running a run replaces only that run's rows in the merged CSVs, so there
are no duplicates. Other runs' rows are kept.

### Observations

Measured with the default parameters on NS-3.49 (`results/summary.csv`). Re-running reproduces them exactly.

- **Baseline (2 Mbps on 20 Mbps):** TCP 1.992 Mbps, UDP 1.997 Mbps goodput. Both
  have about 12.6 ms mean delay (12 ms propagation plus transmission time),
  jitter near 0, and no queue drops. There is no congestion, so the
  protocols behave almost identically.
- **UDP sweep (5 Mbps bottleneck):** at 2 Mbps offered, 1.996 Mbps was delivered
  with 0% loss and 13.9 ms delay. At 5 Mbps, 4.850 Mbps was delivered with 1.9%
  loss and 85 ms delay. The 5 Mbps payload plus headers is about 5.15 Mbps on the
  wire, slightly above capacity. At 8 Mbps, 4.850 Mbps was delivered with 38.7%
  loss and 98 ms delay. Delivered goodput is capped at about 4.85 Mbps, which is
  5 Mbps x 1024/1054 bytes of payload per frame. The queue stays full, so delay
  is capped near 50 packets of queueing.
- **TCP bulk:** 4.724 Mbps goodput and 35 queue drops. The congestion window
  shows slow start, then a loss, then NewReno's additive-increase sawtooth.
- **Mixed (bulk TCP + 3 Mbps UDP):** UDP 2.958 Mbps (0.4% loss), TCP 1.845 Mbps,
  4.80 Mbps in total. TCP backed off and took the capacity the unresponsive UDP
  flow left, while UDP kept close to its configured rate.

## Project layout

```
README.md  requirements.txt
simulation/tcp-udp-congestion.cc      single configurable NS-3 program
scripts/run_experiments.py           build + run + merge + plot
scripts/analyze_results.py           charts from the CSVs
docs/METHODOLOGY.md                  variables, formulas, limitations
docs/DEMO_SCRIPT.md                  five-minute demo walkthrough
results/                             generated output
frontend/                            results website (React + GSAP + Lenis)
```

## References

- NS-3 releases: https://www.nsnam.org/releases/
- NS-3 tutorial: https://www.nsnam.org/docs/tutorial/html/
- NS-3 model library: https://www.nsnam.org/docs/models/html/
- FlowMonitor: https://www.nsnam.org/docs/models/html/flow-monitor.html
- RFC 6582, The NewReno Modification to TCP's Fast Recovery Algorithm
- RFC 5681, TCP Congestion Control
- RFC 768, User Datagram Protocol
- Kurose & Ross, *Computer Networking: A Top-Down Approach*, chapter 3
