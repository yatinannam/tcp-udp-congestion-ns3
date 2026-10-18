# Methodology

## Variables

**Controlled (same in every run unless overridden):** the six-node dumbbell;
100 Mbps / 1 ms access links; 10 ms bottleneck delay; DropTail FIFO queue disc
of 50 packets on RouterA's bottleneck egress; 1024-byte application payload
(also the TCP segment size); TCP NewReno with NS-3 default buffers and an
initial window of 10 segments; traffic 1-10 s; simulation end 12 s; seed 1,
run 1.

**Independent (what each experiment changes):**

| Experiment | Independent variable |
|---|---|
| baseline | transport protocol (TCP vs UDP) at the same 2 Mbps paced rate, 20 Mbps bottleneck |
| udp-sweep | UDP offered rate: 2, 5, 8 Mbps over 5 Mbps |
| tcp-bulk | none (observe TCP's own adaptation) |
| mixed | presence of a competing 3 Mbps UDP flow next to bulk TCP |

**Dependent (measured):** application goodput, bytes delivered, FlowMonitor
packet and byte counts, mean delay, mean jitter, estimated UDP loss,
bottleneck queue drops, peak queue length per bin, and the TCP congestion
window.

## Traffic models

- **Paced OnOff** (baseline, all UDP): `OnOffApplication` that is always on,
  sending `packetSize`-byte packets at a constant rate. Over TCP, when the send
  buffer is full the application caches the packet and retries (it never
  drops data). Whether 2 Mbps was sustained can be checked by comparing goodput
  with the requested rate.
- **BulkSend** (tcp-bulk, mixed TCP): `BulkSendApplication` with no byte limit.
  It writes as fast as TCP accepts data, so the sending rate is set entirely by
  congestion control.

The baseline workloads are matched in application rate and payload size, not
packet for packet: TCP adds ACKs, a 20-byte TCP header instead of 8 bytes of
UDP, a handshake and possible retransmissions.

## Formulas

**Application goodput** (receiver side, PacketSink `Rx` trace):

    goodput_Mbps = payload bytes received in [appStart, appStop] * 8 / (appStop - appStart) / 1e6

The window is 9 s for every run. Bytes that arrive during the 10-12 s drain
period appear in `app_rx_bytes_total` only.

**Time series:** payload bytes received in each fixed bin (default 0.5 s),
times 8, divided by the bin width. `time_s` is the start of the bin.

**Mean delay** (FlowMonitor, data direction only):

    mean_delay_ms = delaySum / rxPackets * 1000

**Mean jitter** (FlowMonitor; NS-3.49 accumulates jitter over rxPackets - 1 samples):

    mean_jitter_ms = jitterSum / (rxPackets - 1) * 1000     (blank if rxPackets < 2)

**Estimated UDP loss** (application counters):

    udp_loss_pct = (OnOff Tx packets - PacketSink Rx packets) / OnOff Tx packets * 100   (blank if Tx = 0)

For UDP, each sink receive event is exactly one datagram, so the counters are
comparable. FlowMonitor's `fm_tx_packets`, `fm_rx_packets` and
`fm_lost_packets` are reported alongside as an IP-layer cross-check.

**Queue drops:** counted from the bottleneck `FifoQueueDisc` `Drop` trace. The
device queue behind it is limited to 1 packet and also traced
(`device_queue_drops`, expected to be 0), which confirms the queue disc is the
only place packets are dropped.

**Congestion window:** the `CongestionWindow` trace of the TCP sender's socket,
connected 1 ms after the application starts (the socket does not exist
earlier). Every change is logged to `cwnd.csv`. The time series holds the last
value at the end of each bin.

## Flow identification

FlowMonitor classifies flows by 5-tuple. The data flows are TCP to port 5000
and UDP to port 6000. The reverse TCP ACK flow (source port 5000) is
excluded from delay and jitter statistics.

## Limitations

- FlowMonitor measures at the IP layer. For TCP, its packet counts and delay
  include retransmitted segments and are not application-level latency.
- FlowMonitor's `lostPackets` treats packets still in flight at the end as
  lost only after a timeout. The 2 s drain period reduces, but does not remove,
  this effect.
- A TCP goodput bin can briefly exceed the link rate (for example 5.37 Mbps
  in tcp-bulk at 1.5-2.0 s). After a loss, the receiver holds out-of-order
  segments until the retransmission fills the gap. It then hands them all to
  the application at once. This is head-of-line blocking, not a measurement
  error. The 9 s window average is unaffected.
- TCP loss is not reported as a percentage of application data lost. TCP
  retransmits, so all data that arrives is delivered. The cost of congestion
  appears as lower goodput, queue drops and cwnd reductions instead.
- Retransmissions are not counted directly. Use `--pcap` and inspect the
  capture in Wireshark if needed.
- The scenario has no random elements: changing `--seed` or `--run` is not
  expected to change results. The runs are exactly repeatable.
- One flow per protocol, one bottleneck, one queue size and DropTail only. The
  results illustrate the mechanisms and are not general claims about TCP vs
  UDP fairness.
- With BulkSend, TCP is greedy, while the UDP source is fixed at its configured
  rate. The two senders are not equally provisioned, so the mixed result is not
  a fairness measurement.
