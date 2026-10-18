import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { RUNS, num, runSeries, summaryRow } from '../lib/data';
import { prefersReducedMotion } from '../lib/motion';

// Logical drawing spaces; the canvas is scaled to its container. Narrow screens
// get a vertical dumbbell so labels stay readable.
const LAYOUTS = {
  wide: {
    W: 1000,
    H: 400,
    vertical: false,
    nodes: {
      tcpTx: { x: 90, y: 70, label: 'TCP sender' },
      udpTx: { x: 90, y: 300, label: 'UDP sender' },
      A: { x: 370, y: 185, label: 'Router A' },
      B: { x: 630, y: 185, label: 'Router B' },
      tcpRx: { x: 910, y: 70, label: 'TCP receiver' },
      udpRx: { x: 910, y: 300, label: 'UDP receiver' },
    },
  },
  narrow: {
    W: 420,
    H: 620,
    vertical: true,
    nodes: {
      tcpTx: { x: 95, y: 78, label: 'TCP sender' },
      udpTx: { x: 325, y: 78, label: 'UDP sender' },
      A: { x: 210, y: 215, label: 'Router A' },
      B: { x: 210, y: 400, label: 'Router B' },
      tcpRx: { x: 95, y: 525, label: 'TCP receiver' },
      udpRx: { x: 325, y: 525, label: 'UDP receiver' },
    },
  },
};
const NARROW_BELOW = 560; // container width in CSS px
const C = {
  ink: '#13233a',
  muted: '#566579',
  rule: '#cad4dd',
  panel: '#f8fafb',
  tcp: '#2a78d6',
  udp: '#eb6834',
  queue: '#1baf7a',
  drop: '#8a97a6',
};
const DOT_PACKETS = 20; // one dot stands for this many packets
const DOT_SPEED = 260; // logical px per simulated second
const SPEEDS = [0.5, 1, 2];

function flowPaths(n) {
  return {
    tcp: { in: [n.tcpTx, n.A], out: [n.A, n.B, n.tcpRx] },
    udp: { in: [n.udpTx, n.A], out: [n.A, n.B, n.udpRx] },
  };
}

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

function pointAt(pts, dist) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist <= seg) return { x: a.x + ((b.x - a.x) * dist) / seg, y: a.y + ((b.y - a.y) * dist) / seg };
    dist -= seg;
  }
  return pts[pts.length - 1];
}

/** Everything the animation needs about one run, derived from the CSVs. */
function buildRunModel(data, runId) {
  const series = runSeries(data, runId);
  if (!series) return null;
  const flows = ['tcp', 'udp'].filter((f) => summaryRow(data, runId, f));
  const first = summaryRow(data, runId, flows[0]);
  const packetBytes = num(first.packet_size_bytes) ?? 1024;
  return {
    runId,
    series,
    flows,
    bin: series.bin,
    nBins: series.bottleneck.length,
    simStop: num(first.sim_stop_s) ?? 12,
    appStart: num(first.app_start_s) ?? 1,
    appStop: num(first.app_stop_s) ?? 10,
    capacity: num(first.bottleneck_mbps),
    delayMs: num(first.bottleneck_delay_ms),
    queueSize: num(first.queue_packets) ?? 50,
    toDots: (mbps) => (mbps * 1e6) / (8 * packetBytes) / DOT_PACKETS,
    rows: Object.fromEntries(flows.map((f) => [f, summaryRow(data, runId, f)])),
  };
}

function snapshot(model, t) {
  const b = Math.min(Math.max(Math.floor(t / model.bin), 0), model.nBins - 1);
  const bn = model.series.bottleneck[b];
  const prevDrops = b > 0 ? model.series.bottleneck[b - 1].drops ?? 0 : 0;
  const goodput = {};
  for (const f of model.flows) goodput[f] = model.series.flows[f]?.[b]?.goodput ?? null;
  return {
    goodput,
    qlen: bn.qlen ?? 0,
    drops: bn.drops ?? 0,
    dropsInBin: Math.max((bn.drops ?? 0) - prevDrops, 0),
  };
}

function offeredMbps(model, flow, snap, t) {
  if (t < model.appStart || t > model.appStop) return 0;
  const requested = num(model.rows[flow].requested_rate_mbps);
  // BulkSend has no target rate: its sending rate follows what TCP delivers.
  return requested ?? snap.goodput[flow] ?? 0;
}

function drawScene(ctx, model, sim, scale, L) {
  const n = L.nodes;
  const fs = (px) => Math.max(px, 11 / scale); // keep labels readable on phones
  const text = (str, x, y, { weight = 500, size = 13, color = C.muted, align = 'center' } = {}) => {
    ctx.font = `${weight} ${fs(size)}px Archivo`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(str, x, y);
  };
  ctx.clearRect(0, 0, L.W, L.H);
  ctx.lineCap = 'round';

  const active = new Set(model.flows);
  const access = [
    [n.tcpTx, n.A, 'tcp'],
    [n.udpTx, n.A, 'udp'],
    [n.B, n.tcpRx, 'tcp'],
    [n.B, n.udpRx, 'udp'],
  ];
  for (const [a, b, f] of access) {
    ctx.strokeStyle = active.has(f) ? '#9fb0c0' : C.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Bottleneck link
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(n.A.x, n.A.y);
  ctx.lineTo(n.B.x, n.B.y);
  ctx.stroke();
  const linkLabel = `${model.capacity} Mbps, ${model.delayMs} ms`;
  if (L.vertical) {
    const midY = (n.A.y + n.B.y) / 2;
    text('Bottleneck', n.A.x - 18, midY - 8, { weight: 600, color: C.ink, align: 'right' });
    text(linkLabel, n.A.x - 18, midY + 10, { weight: 600, color: C.ink, align: 'right' });
  } else {
    text(`Bottleneck ${linkLabel}`, (n.A.x + n.B.x) / 2, n.A.y - 20, { weight: 600, size: 14, color: C.ink });
  }

  // Particles
  for (const p of sim.particles) {
    if (p.kind === 'drop') {
      ctx.globalAlpha = Math.max(1 - p.age / p.life, 0);
      ctx.fillStyle = C.drop;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    const pt = pointAt(p.path, p.dist);
    ctx.fillStyle = C[p.flow];
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Queue gauge beside the bottleneck: one slot per packet of buffer.
  const slots = model.queueSize;
  const fillSlot = (i) => (i < sim.snap.qlen ? C.queue : '#dfe6ec');
  if (L.vertical) {
    const gx = n.A.x + 18;
    const gy = n.A.y + 30;
    const gh = n.B.y - n.A.y - 60;
    const slotH = gh / slots;
    for (let i = 0; i < slots; i++) {
      ctx.fillStyle = fillSlot(i);
      ctx.fillRect(gx, gy + i * slotH + 0.5, 16, Math.max(slotH - 1, 1));
    }
    const midY = (n.A.y + n.B.y) / 2;
    text('Router A queue', gx + 26, midY - 8, { align: 'left' });
    text(`${sim.snap.qlen} of ${slots} packets`, gx + 26, midY + 10, { align: 'left', color: C.ink, weight: 600 });
  } else {
    const gx = n.A.x + 26;
    const gw = n.B.x - n.A.x - 52;
    const gy = n.A.y + 40;
    const slotW = gw / slots;
    for (let i = 0; i < slots; i++) {
      ctx.fillStyle = fillSlot(i);
      ctx.fillRect(gx + i * slotW + 0.5, gy, Math.max(slotW - 1, 1), 16);
    }
    text(`Router A queue: ${sim.snap.qlen} of ${slots} packets`, gx, gy + 36, { align: 'left' });
  }

  // Nodes
  const isSender = (node) => node === n.tcpTx || node === n.udpTx;
  const host = (node, flow) => {
    const on = active.has(flow);
    ctx.fillStyle = C.panel;
    ctx.strokeStyle = on ? C[flow] : C.rule;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(node.x, node.y, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const above = L.vertical && isSender(node);
    text(node.label, node.x, above ? node.y - 50 : node.y + 42, { weight: 600, size: 14, color: on ? C.ink : C.drop });
  };
  const router = (node) => {
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.roundRect(node.x - 24, node.y - 24, 48, 48, 8);
    ctx.fill();
    if (L.vertical) text(node.label, node.x - 34, node.y + 5, { weight: 600, size: 14, color: C.ink, align: 'right' });
    else text(node.label, node.x, node.y - 50, { weight: 600, size: 14, color: C.ink });
  };
  host(n.tcpTx, 'tcp');
  host(n.udpTx, 'udp');
  host(n.tcpRx, 'tcp');
  host(n.udpRx, 'udp');
  router(n.A);
  router(n.B);

  // Live per-flow readouts next to the endpoints.
  for (const f of model.flows) {
    const tx = f === 'tcp' ? n.tcpTx : n.udpTx;
    const rx = f === 'tcp' ? n.tcpRx : n.udpRx;
    const requested = num(model.rows[f].requested_rate_mbps);
    const offered = requested !== null ? `${requested} Mbps offered` : L.vertical ? 'adaptive rate' : 'sends as fast as TCP allows';
    text(offered, tx.x, L.vertical ? tx.y - 32 : tx.y + 60);
    const g = sim.snap.goodput[f];
    text(g == null ? 'no data' : `${g.toFixed(2)} Mbps received`, rx.x, rx.y + 60);
  }
}

function stepParticles(sim, model, dt, L) {
  const snap = sim.snap;
  const paths = flowPaths(L.nodes);
  // Spawn: arrivals at Router A, departures over the bottleneck, and drops.
  for (const f of model.flows) {
    sim.acc[`${f}-in`] += model.toDots(offeredMbps(model, f, snap, sim.t)) * dt;
    sim.acc[`${f}-out`] += model.toDots(snap.goodput[f] ?? 0) * dt;
    for (const dir of ['in', 'out']) {
      const key = `${f}-${dir}`;
      while (sim.acc[key] >= 1) {
        sim.acc[key] -= 1;
        const path = paths[f][dir];
        sim.particles.push({ kind: 'move', flow: f, path, len: pathLength(path), dist: Math.random() * 6 });
      }
    }
  }
  sim.acc.drop += (snap.dropsInBin / model.bin / DOT_PACKETS) * dt;
  const A = L.nodes.A;
  const side = -1; // fall back toward the senders, clear of the queue label
  while (sim.acc.drop >= 1) {
    sim.acc.drop -= 1;
    sim.particles.push({
      kind: 'drop',
      x: A.x + side * (10 + Math.random() * 20),
      y: A.y + 10,
      vx: side * (20 + Math.random() * 50),
      vy: -60 - Math.random() * 60,
      age: 0,
      life: 1.4,
    });
  }
  // Move
  for (const p of sim.particles) {
    if (p.kind === 'drop') {
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.age += dt;
    } else {
      p.dist += DOT_SPEED * dt;
    }
  }
  sim.particles = sim.particles.filter((p) => (p.kind === 'drop' ? p.age < p.life : p.dist < p.len));
}

export default function Replay({ data }) {
  const available = useMemo(() => RUNS.filter((r) => data.timeseries.some((row) => row.run_id === r.id)), [data]);
  const [runId, setRunId] = useState(() => (available.find((r) => r.id === 'udp-sweep-8') ?? available[0])?.id);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [readout, setReadout] = useState({ t: 0, snap: null });
  const [layoutKey, setLayoutKey] = useState('wide');
  const L = LAYOUTS[layoutKey];

  const model = useMemo(() => (runId ? buildRunModel(data, runId) : null), [data, runId]);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const simRef = useRef(null);
  const stateRef = useRef({ playing, speed });
  stateRef.current = { playing, speed };

  const resetSim = useCallback(
    (t = 0) => {
      if (!model) return;
      simRef.current = {
        t,
        particles: [],
        acc: { 'tcp-in': 0, 'tcp-out': 0, 'udp-in': 0, 'udp-out': 0, drop: 0 },
        snap: snapshot(model, t),
        lastReadout: 0,
      };
      setReadout({ t, snap: simRef.current.snap, runId: model.runId });
    },
    [model],
  );

  useEffect(() => resetSim(0), [resetSim]);

  // Autoplay once the console scrolls into view (not with reduced motion).
  useEffect(() => {
    if (prefersReducedMotion() || !wrapRef.current) return undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setPlaying(true);
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(wrapRef.current);
    return () => io.disconnect();
  }, []);

  // Pick the wide or vertical layout from the container width.
  useEffect(() => {
    if (!wrapRef.current) return undefined;
    const ro = new ResizeObserver(([entry]) =>
      setLayoutKey(entry.contentRect.width < NARROW_BELOW ? 'narrow' : 'wide'),
    );
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [model]);

  // Render loop on GSAP's ticker (shared with Lenis).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model) return undefined;
    const ctx = canvas.getContext('2d');
    let scale = 1;
    if (simRef.current) simRef.current.particles = []; // paths belong to the old layout

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      scale = w / L.W;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(((w * L.H) / L.W) * dpr);
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const tick = (_time, deltaMs) => {
      const sim = simRef.current;
      if (!sim) return;
      const { playing: isPlaying, speed: s } = stateRef.current;
      if (isPlaying) {
        const dt = Math.min(deltaMs / 1000, 0.05) * s;
        sim.t = Math.min(sim.t + dt, model.simStop);
        sim.snap = snapshot(model, sim.t);
        stepParticles(sim, model, dt, L);
        if (sim.t - sim.lastReadout > 0.1 || sim.t >= model.simStop) {
          sim.lastReadout = sim.t;
          setReadout({ t: sim.t, snap: sim.snap, runId: model.runId });
        }
        if (sim.t >= model.simStop) setPlaying(false);
      }
      drawScene(ctx, model, sim, scale, L);
    };
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      ro.disconnect();
    };
  }, [model, L]);

  if (!model) {
    return (
      <div className="rounded-xl border border-rule bg-panel p-8 text-muted">
        No time-series data found. Run <code>python3 scripts/run_experiments.py</code> in WSL, then{' '}
        <code>npm run sync</code>.
      </div>
    );
  }

  const ended = readout.t >= model.simStop;
  const onPlay = () => {
    if (ended) resetSim(0);
    setPlaying((p) => !p || ended);
  };
  const onScrub = (e) => {
    const t = Number(e.target.value);
    setPlaying(false);
    resetSim(t);
  };
  // Ignore a readout left over from the previous run until the reset lands.
  const snap = readout.runId === model.runId ? readout.snap : null;

  return (
    <div ref={wrapRef} className="rounded-2xl border border-rule bg-panel/80 shadow-[0_1px_0_rgb(19_35_58/0.04)]">
      <div className="flex flex-wrap gap-1.5 border-b border-rule p-3" role="group" aria-label="Choose an experiment run">
        {available.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={r.id === runId}
            onClick={() => {
              setRunId(r.id);
              setPlaying(true);
            }}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              r.id === runId ? 'bg-ink text-panel' : 'text-ink hover:bg-rule/60'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <canvas
        ref={canvasRef}
        className="block w-full"
        style={{ aspectRatio: `${L.W} / ${L.H}` }}
        role="img"
        aria-label={`Animated replay of run ${runId}: packets crossing the dumbbell topology, the Router A queue and dropped packets, driven by the measured time series.`}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-rule px-4 py-3">
        <button
          type="button"
          onClick={onPlay}
          className="min-w-[5.5rem] rounded-full bg-ink px-4 py-2 text-sm font-semibold text-panel hover:bg-ink/85"
        >
          {playing ? 'Pause' : ended ? 'Replay' : 'Play'}
        </button>
        <label className="flex min-w-[12rem] flex-1 items-center gap-3 text-sm text-muted">
          <span className="sr-only">Simulation time</span>
          <input
            type="range"
            min={0}
            max={model.simStop}
            step={0.05}
            value={readout.t}
            onChange={onScrub}
            className="w-full accent-[#13233a]"
          />
          <span className="tabular whitespace-nowrap text-right text-ink">
            {readout.t.toFixed(1)} s of {model.simStop} s
          </span>
        </label>
        <div className="flex gap-1" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === speed}
              onClick={() => setSpeed(s)}
              className={`tabular rounded-md px-2 py-1 text-sm ${s === speed ? 'bg-rule text-ink' : 'text-muted hover:text-ink'}`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {snap && (
        <dl
          className="replay-stats tabular grid grid-cols-2 gap-px border-t border-rule bg-rule text-sm"
          style={{ '--cells': model.flows.length + 2 }}
        >
          {model.flows.map((f) => (
            <div key={f} className="bg-panel px-4 py-3">
              <dt className="text-muted">{f.toUpperCase()} received now</dt>
              <dd className="text-lg font-semibold" style={{ color: f === 'tcp' ? C.tcp : C.udp }}>
                {snap.goodput[f] == null ? 'n/a' : `${snap.goodput[f].toFixed(2)} Mbps`}
              </dd>
            </div>
          ))}
          <div className="bg-panel px-4 py-3">
            <dt className="text-muted">Queue peak this bin</dt>
            <dd className="text-lg font-semibold">{snap.qlen} / {model.queueSize}</dd>
          </div>
          <div className="bg-panel px-4 py-3">
            <dt className="text-muted">Packets dropped so far</dt>
            <dd className="text-lg font-semibold">{snap.drops.toLocaleString()}</dd>
          </div>
        </dl>
      )}
      <p className="border-t border-rule px-4 py-3 text-xs text-muted">
        Replays the measured {model.bin} s time series of this run. One dot stands for {DOT_PACKETS} packets.
        Grey dots are queue drops; the trace does not record which flow they belonged to.
      </p>
    </div>
  );
}
