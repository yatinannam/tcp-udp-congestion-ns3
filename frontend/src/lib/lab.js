// Interactive lab: every configuration was simulated ahead of time by
// scripts/build_lab_dataset.py. Nothing here invents results; it only looks
// them up, scores the visitor and explains what the data shows.

export async function loadLab() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/lab-data.json`);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.startsWith('{')) return null; // dev server fallback page
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const runKey = (c) => `b${c.bottleneck}-q${c.queue}-d${c.delay}-t${c.tcp}-u${c.udp}`;

/** Shape one lab run like the report CSV rows so the Replay component can play it. */
export function toReplayData(run, meta) {
  const id = runKey(run.cfg);
  const base = {
    run_id: id,
    packet_size_bytes: meta.packetSize,
    sim_stop_s: meta.simStop,
    app_start_s: meta.appStart,
    app_stop_s: meta.appStop,
    bottleneck_mbps: run.cfg.bottleneck,
    bottleneck_delay_ms: run.cfg.delay,
    queue_packets: run.cfg.queue,
  };
  const summary = Object.keys(run.flows).map((flow) => ({
    ...base,
    flow,
    requested_rate_mbps: flow === 'udp' ? run.cfg.udp : '',
  }));
  const timeseries = [];
  run.ts.qlen.forEach((qlen, i) => {
    const t = i * meta.bin;
    for (const flow of Object.keys(run.flows)) {
      timeseries.push({ run_id: id, time_s: t, bin_s: meta.bin, flow, goodput_mbps: run.ts[flow]?.[i] ?? '' });
    }
    timeseries.push({
      run_id: id, time_s: t, bin_s: meta.bin, flow: 'bottleneck',
      queue_len_max_pkts: qlen, queue_drops_cum: run.ts.drops[i],
    });
  });
  return { summary, timeseries, cwnd: [] };
}

/** Derived numbers used by missions, the scorecard and the explanations. */
export function metrics(run) {
  const { cfg, flows, drops } = run;
  const tcp = flows.tcp ?? null;
  const udp = flows.udp ?? null;
  const total = (tcp?.goodput ?? 0) + (udp?.goodput ?? 0);
  const delays = [tcp?.delay, udp?.delay].filter((v) => v !== null && v !== undefined);
  return {
    cfg,
    tcp,
    udp,
    drops,
    total,
    util: total / cfg.bottleneck,
    delay: delays.length ? Math.max(...delays) : null,
    propagation: cfg.delay + 2, // one-way: bottleneck + two 1 ms access links
  };
}

// --------------------------------------------------------------------------- missions

export const MISSIONS = [
  {
    id: 'first',
    title: 'Hello, network',
    goal: 'Run any experiment.',
    xp: 10,
    check: () => true,
    lesson: 'Every result in the lab comes from a real NS-3 simulation of this exact setup.',
  },
  {
    id: 'ceiling',
    title: 'Hit the ceiling',
    goal: 'Run UDP alone, sending faster than the bottleneck can carry.',
    xp: 20,
    check: (m) => !m.cfg.tcp && m.cfg.udp > m.cfg.bottleneck,
    lesson: 'Delivered goodput stops at the link speed however fast UDP sends. The extra packets are dropped at Router A.',
  },
  {
    id: 'clean',
    title: 'Clean pipe',
    goal: 'Run UDP alone at 80% or more of the link speed with zero loss.',
    xp: 20,
    check: (m) => !m.cfg.tcp && m.cfg.udp >= 0.8 * m.cfg.bottleneck && m.udp?.loss === 0,
    lesson: 'Below capacity, the queue empties as fast as it fills, so nothing is dropped.',
  },
  {
    id: 'storm',
    title: 'Drop storm',
    goal: 'Make UDP lose more than half of its packets.',
    xp: 20,
    check: (m) => (m.udp?.loss ?? 0) > 50,
    lesson: 'UDP has no congestion control, so it keeps sending into a full queue.',
  },
  {
    id: 'bloat',
    title: 'Bufferbloat',
    goal: 'Push the average delay above 200 ms.',
    xp: 30,
    check: (m) => (m.delay ?? 0) > 200,
    lesson: 'A large buffer that stays full makes every packet wait. Fewer drops, but much slower responses.',
  },
  {
    id: 'snappy',
    title: 'Fast and snappy',
    goal: 'TCP alone: use 90% of the link with average delay under 40 ms.',
    xp: 30,
    check: (m) => m.cfg.tcp && !m.cfg.udp && m.util >= 0.9 && (m.delay ?? Infinity) < 40,
    lesson: 'With a short path and a modest buffer, TCP fills the link without building a long queue.',
  },
  {
    id: 'tiny',
    title: 'Buffer too small',
    goal: 'TCP alone: leave more than 20% of the link unused.',
    xp: 30,
    check: (m) => m.cfg.tcp && !m.cfg.udp && m.util < 0.8,
    lesson: 'If the buffer is smaller than the bandwidth-delay product, each loss halves TCP’s window and the link sits idle while it recovers.',
  },
  {
    id: 'starve',
    title: 'Starve TCP',
    goal: 'Run both senders and leave TCP with under 10% of the link.',
    xp: 30,
    check: (m) => m.cfg.tcp && m.cfg.udp && m.tcp && m.tcp.goodput < 0.1 * m.cfg.bottleneck,
    lesson: 'TCP backs off every time it sees loss; UDP never does. An aggressive UDP flow can crowd TCP out.',
  },
  {
    id: 'share',
    title: 'Fair share',
    goal: 'Run both senders and get their goodputs within 10% of each other.',
    xp: 40,
    check: (m) =>
      m.cfg.tcp && m.cfg.udp && m.tcp && m.udp &&
      Math.abs(m.tcp.goodput - m.udp.goodput) <= 0.1 * Math.max(m.tcp.goodput, m.udp.goodput),
    lesson: 'The split is set by the UDP rate: TCP takes roughly what UDP leaves.',
  },
  {
    id: 'oracle',
    title: 'Oracle',
    goal: 'Score 80 or more on three predictions.',
    xp: 40,
    target: 3,
    progress: (p) => p.goodPredictions,
    lesson: 'You can reason about congestion before you measure it.',
  },
  {
    id: 'explorer',
    title: 'Explorer',
    goal: 'Try 15 different configurations.',
    xp: 30,
    target: 15,
    progress: (p) => p.seen.length,
    lesson: 'Each knob changes a different part of the story: capacity, queueing, or who backs off.',
  },
];

// --------------------------------------------------------------------------- prediction

/** What the visitor predicts depends on who is sending. */
export function predictionTarget(cfg) {
  if (cfg.tcp) {
    return { key: 'tcp', label: 'TCP goodput', unit: 'Mbps', min: 0, max: cfg.bottleneck, step: 0.1, digits: 1 };
  }
  return { key: 'loss', label: 'UDP packet loss', unit: '%', min: 0, max: 100, step: 1, digits: 0 };
}

export function predictionActual(target, m) {
  return target.key === 'tcp' ? m.tcp?.goodput ?? null : m.udp?.loss ?? null;
}

/** 100 for exact, 0 when off by a whole range (50 loss points or the full link speed). */
export function scorePrediction(target, guess, m) {
  const actual = predictionActual(target, m);
  if (actual === null || guess === null) return null;
  const range = target.key === 'tcp' ? m.cfg.bottleneck : 50;
  return Math.max(0, Math.round(100 * (1 - Math.abs(guess - actual) / range)));
}

// --------------------------------------------------------------------------- progress

const STORE_KEY = 'tcpudp-lab-v1';
export const freshProgress = () => ({ xp: 0, completed: {}, seen: [], goodPredictions: 0, log: [] });

export function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return saved && typeof saved.xp === 'number' ? { ...freshProgress(), ...saved } : freshProgress();
  } catch {
    return freshProgress();
  }
}

export function saveProgress(p) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lasts for this visit only */
  }
}

export const LEVELS = [
  { at: 0, name: 'Packet' },
  { at: 60, name: 'Frame inspector' },
  { at: 150, name: 'Router tuner' },
  { at: 270, name: 'Congestion detective' },
  { at: 420, name: 'Network engineer' },
];

export function levelOf(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].at) i++;
  const next = LEVELS[i + 1];
  return {
    index: i + 1,
    name: LEVELS[i].name,
    floor: LEVELS[i].at,
    next: next?.at ?? null,
    fraction: next ? (xp - LEVELS[i].at) / (next.at - LEVELS[i].at) : 1,
  };
}

/** Fold one finished run into the visitor's progress. */
export function applyRun(prev, run, m, prediction) {
  const id = runKey(run.cfg);
  const p = {
    ...prev,
    completed: { ...prev.completed },
    seen: prev.seen.includes(id) ? prev.seen : [...prev.seen, id],
    goodPredictions: prev.goodPredictions + (prediction?.score >= 80 ? 1 : 0),
  };
  let gained = prediction?.score != null ? Math.round(prediction.score / 10) : 0;
  const unlocked = [];
  for (const mission of MISSIONS) {
    if (p.completed[mission.id]) continue;
    const done = mission.check ? mission.check(m) : mission.progress(p) >= mission.target;
    if (done) {
      p.completed[mission.id] = true;
      gained += mission.xp;
      unlocked.push(mission);
    }
  }
  p.xp = prev.xp + gained;
  p.log = [
    { id, cfg: run.cfg, prediction: prediction?.score ?? null, at: Date.now() },
    ...prev.log.filter((e) => e.id !== id),
  ].slice(0, 30);
  return { progress: p, gained, unlocked };
}

// --------------------------------------------------------------------------- explanations

const f = (v, d = 2) => (v === null || v === undefined ? 'n/a' : v.toFixed(d));

/** Plain-language observations computed from the run's numbers. */
export function explain(m) {
  const { cfg } = m;
  const out = [];
  if (m.udp) {
    if (cfg.udp > cfg.bottleneck) {
      out.push(
        `UDP asked for ${cfg.udp} Mbps on a ${cfg.bottleneck} Mbps link. ${f(m.udp.goodput)} Mbps arrived and ${f(m.udp.loss, 1)}% of its packets were dropped.`,
      );
    } else if (m.udp.loss > 0) {
      out.push(
        `UDP lost ${f(m.udp.loss, 1)}% of its packets while asking for ${cfg.udp} Mbps` +
          (cfg.tcp ? ', because TCP was filling the same queue.' : '. Headers add about 3%, so the real load was a little higher than the payload rate.'),
      );
    } else {
      out.push(`Every UDP packet arrived: the link had room for the ${cfg.udp} Mbps it offered.`);
    }
  }
  if (m.tcp) {
    if (cfg.udp) {
      const left = Math.max(cfg.bottleneck - (m.udp?.goodput ?? 0), 0);
      out.push(`UDP took ${f(m.udp?.goodput)} Mbps, leaving about ${f(left)} Mbps of the link. TCP delivered ${f(m.tcp.goodput)} Mbps.`);
    } else {
      // Bandwidth-delay product in packets: rate x round-trip time / bits per TCP packet on the wire.
      const rtt = (2 * (cfg.delay + 2)) / 1000;
      const bdp = Math.round((cfg.bottleneck * 1e6 * rtt) / (8 * 1066));
      let line = `TCP alone used ${Math.round(m.util * 100)}% of the link.`;
      if (m.util < 0.85 && cfg.queue < bdp) {
        line += ` The ${cfg.queue}-packet buffer is smaller than the bandwidth-delay product (about ${bdp} packets), so the link idled while TCP recovered from losses.`;
      }
      out.push(line);
    }
  }
  if (m.delay !== null) {
    const queueing = m.delay - m.propagation;
    out.push(
      queueing > 10
        ? `Average delay was ${f(m.delay, 0)} ms against ${m.propagation} ms of propagation: about ${f(queueing, 0)} ms spent waiting in Router A’s queue.`
        : `Average delay was ${f(m.delay, 1)} ms, close to the ${m.propagation} ms propagation delay: almost no queueing.`,
    );
  }
  out.push(m.drops ? `Router A dropped ${m.drops.toLocaleString()} packets.` : 'Router A never dropped a packet.');
  return out;
}
