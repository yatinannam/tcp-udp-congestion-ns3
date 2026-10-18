# Five-minute demo script

Run the full suite once before the evaluation, so all charts already exist.
During the demo, re-run single experiments live.

```bash
cd /mnt/c/Users/ninja/OneDrive/Documents/Yatin/YUVAN-CN
export NS3_ROOT=~/ns-3.49
python3 scripts/run_experiments.py          # before the demo (~1 minute)
```

## 0. Topology (30 s)

Show the ASCII diagram in `README.md`. Point out that both senders share the
RouterA -> RouterB link and that the access links are much faster, so the
queue builds only at RouterA.

## 1. Low-load baseline (1 min)

```bash
python3 scripts/run_experiments.py --only baseline
```

- Charts: `results/plots/4_baseline_goodput.png`, `5_baseline_delay_jitter.png`
- Concept: at 2 Mbps on a 20 Mbps link there is no congestion. Both protocols
  should deliver close to the requested rate, and delay should be close to the
  propagation delay plus transmission time.
- Discuss: any difference here comes from protocol mechanics (TCP header size,
  ACKs, slow start at the beginning), not from congestion.

## 2. UDP overload (1.5 min)

```bash
python3 scripts/run_experiments.py --only udp-sweep
```

- Charts: `1_udp_offered_vs_goodput.png`, `2_udp_offered_vs_loss.png`,
  `3_udp_offered_vs_delay.png`, `9_queue_udp-sweep-8.png`
- Concept: requested rate is not delivered rate. Below capacity, delivered is
  roughly equal to offered. Above capacity, delivered goodput is capped by the
  link, the queue fills, and UDP keeps sending anyway, so the excess is dropped.
  Delay rises because packets wait in a full queue.
- Point at the dashed "delivered = offered" line and where the measured points
  leave it.

## 3. TCP adapting (1 min)

```bash
python3 scripts/run_experiments.py --only tcp-bulk
```

- Charts: `7_cwnd_tcp-bulk.png`, `9_queue_tcp-bulk.png`
- Concept: TCP probes for capacity. Cwnd grows until the queue overflows, a
  loss is detected, and cwnd is cut back. The resulting sawtooth matches the
  queue filling and the drops.

## 4. Mixed competition (1 min) -- the main demo

```bash
python3 scripts/run_experiments.py --only mixed
```

- Charts: `6_mixed_goodput.png`, `8_mixed_goodput_timeseries.png`,
  `7_cwnd_mixed.png`
- Concept: TCP reacts to drops by shrinking its window. The UDP source does not
  react and keeps offering 3 Mbps. Look at how the 5 Mbps is split between
  the flows, and whether UDP also loses packets. Read the actual numbers from
  the chart; do not assume a split.

## 5. Live parameter change (30 s, optional)

```bash
python3 scripts/run_experiments.py --only mixed --set queuePackets=10
python3 scripts/run_experiments.py --only mixed --set udpRateMbps=4.5
```

Ask the audience to predict the result first, then compare the charts. Re-run
without `--set` to restore the default results.

## Why real results may differ from expectations

- TCP's start-up (slow start) and the initial window affect short runs.
- With DropTail, TCP loses packets in bursts. NewReno's recovery then shapes
  the sawtooth, so it does not look like a perfect textbook triangle.
- Queue size sets both the maximum queueing delay (50 packets x ~1.7 ms at
  5 Mbps) and how much burst the link can absorb.
- FlowMonitor works at the IP layer, so TCP delay includes retransmitted
  packets.
- The mixed result depends on the configured rates. A greedy TCP and a fixed
  3 Mbps UDP flow are not a fair comparison.
