import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import Replay from '../components/Replay';
import CountUp from '../components/reactbits/CountUp/CountUp';
import {
  MISSIONS,
  applyRun,
  explain,
  freshProgress,
  levelOf,
  loadProgress,
  metrics,
  predictionActual,
  predictionTarget,
  runKey,
  saveProgress,
  scorePrediction,
  toReplayData,
} from '../lib/lab';

const COLOR = { tcp: '#2a78d6', udp: '#eb6834' };
const DEFAULT_CFG = { bottleneck: 5, queue: 50, delay: 20, tcp: 1, udp: 3 };

// ----------------------------------------------------------------------------- controls

function Segmented({ label, help, options, value, onChange, unit }) {
  return (
    <fieldset>
      <legend className="font-semibold">{label}</legend>
      <p className="mb-2 text-sm text-muted">{help}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={o === value}
            onClick={() => onChange(o)}
            className={`tabular rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              o === value ? 'border-ink bg-ink text-panel' : 'border-rule bg-panel hover:border-ink/40'
            }`}
          >
            {o} {unit}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Toggle({ label, help, on, onChange, color }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-sm text-muted">{help}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className="relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{ background: on ? color : '#cad4dd' }}
      >
        <span
          className="absolute top-1 h-5 w-5 rounded-full bg-panel transition-[left]"
          style={{ left: on ? '1.6rem' : '0.25rem' }}
        />
      </button>
    </div>
  );
}

function UdpSlider({ values, value, onChange, bottleneck }) {
  const index = Math.max(values.indexOf(value), 0);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="font-semibold">UDP sender</p>
        <p className="tabular font-semibold" style={{ color: value ? COLOR.udp : undefined }}>
          {value ? `${value} Mbps` : 'Off'}
        </p>
      </div>
      <p className="mb-2 text-sm text-muted">Sends at a fixed rate and never slows down.</p>
      <input
        type="range"
        min={0}
        max={values.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(values[Number(e.target.value)])}
        aria-label="UDP sending rate"
        aria-valuetext={value ? `${value} Mbps` : 'Off'}
        className="w-full accent-[#eb6834]"
      />
      <div className="tabular flex justify-between text-xs text-muted">
        <span>Off</span>
        <span>{values[values.length - 1]} Mbps</span>
      </div>
      {value > bottleneck && (
        <p className="mt-1 text-sm text-udp">That is more than the {bottleneck} Mbps link can carry.</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- progress

function ProgressBar({ progress, onReset }) {
  const level = levelOf(progress.xp);
  const done = Object.keys(progress.completed).length;
  const barRef = useRef(null);
  useEffect(() => {
    gsap.to(barRef.current, { width: `${Math.round(level.fraction * 100)}%`, duration: 0.8, ease: 'power2.out' });
  }, [level.fraction]);
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-rule bg-panel px-5 py-4">
      <div>
        <p className="text-sm text-muted">Level {level.index}</p>
        <p className="condensed text-xl font-bold">{level.name}</p>
      </div>
      <div className="min-w-[12rem] flex-1">
        <div className="tabular mb-1 flex justify-between text-sm text-muted">
          <span>{progress.xp} XP</span>
          <span>{level.next ? `next level at ${level.next}` : 'top level'}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-rule/60">
          <div ref={barRef} className="h-full w-0 rounded-full bg-queue" />
        </div>
      </div>
      <p className="tabular text-sm">
        <span className="font-semibold">{done}</span> of {MISSIONS.length} missions
      </p>
      <button type="button" onClick={onReset} className="text-sm text-muted underline underline-offset-4 hover:text-ink">
        Reset progress
      </button>
    </div>
  );
}

function Toasts({ items }) {
  const ref = useRef(null);
  useEffect(() => {
    const last = ref.current?.lastElementChild;
    if (last) gsap.fromTo(last, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'back.out(1.6)' });
  }, [items.length]);
  return (
    <div ref={ref} className="pointer-events-none fixed bottom-4 right-4 z-30 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.key} className="rounded-xl bg-ink px-4 py-3 text-panel shadow-lg">
          <p className="text-sm text-panel/70">Mission complete, +{t.xp} XP</p>
          <p className="font-semibold">{t.title}</p>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------- results

function Scorecard({ run, outcome }) {
  const m = metrics(run);
  const tiles = [];
  if (m.tcp) tiles.push({ label: 'TCP goodput', value: m.tcp.goodput, unit: 'Mbps', digits: 2, color: COLOR.tcp });
  if (m.udp) tiles.push({ label: 'UDP goodput', value: m.udp.goodput, unit: 'Mbps', digits: 2, color: COLOR.udp });
  if (m.udp) tiles.push({ label: 'UDP loss', value: m.udp.loss, unit: '%', digits: 1 });
  tiles.push({ label: 'Average delay', value: m.delay, unit: 'ms', digits: 0 });
  tiles.push({ label: 'Link used', value: m.util * 100, unit: '%', digits: 0 });

  return (
    <div className="space-y-5">
      <dl className="flex flex-wrap gap-px overflow-hidden rounded-2xl border border-rule bg-rule">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-[9rem] flex-1 bg-panel px-4 py-3">
            <dt className="text-sm text-muted">{t.label}</dt>
            <dd className="tabular text-2xl font-bold" style={t.color ? { color: t.color } : undefined}>
              <CountUp to={t.value ?? 0} decimals={t.digits} duration={1.2} trigger="load" />
              <span className="ml-1 text-sm font-semibold text-muted">{t.unit}</span>
            </dd>
          </div>
        ))}
      </dl>

      {outcome.prediction && (
        <p className="rounded-xl border border-rule bg-panel px-4 py-3">
          You predicted {outcome.prediction.target.label} of{' '}
          <strong>
            {outcome.prediction.guess.toFixed(outcome.prediction.target.digits)} {outcome.prediction.target.unit}
          </strong>
          . The simulation measured{' '}
          <strong>
            {outcome.prediction.actual.toFixed(outcome.prediction.target.digits + 1)} {outcome.prediction.target.unit}
          </strong>
          . Score <strong>{outcome.prediction.score}</strong> / 100.
        </p>
      )}

      <div>
        <h3 className="mb-2 font-semibold">What happened</h3>
        <ul className="list-disc space-y-1.5 pl-5">
          {explain(m).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {outcome.unlocked.length > 0 && (
        <div className="rounded-xl border border-queue/50 bg-queue/10 px-4 py-3">
          {outcome.unlocked.map((mi) => (
            <p key={mi.id}>
              <strong>{mi.title}</strong> unlocked. {mi.lesson}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Missions({ progress }) {
  return (
    <ul className="grid gap-x-10 gap-y-1 md:grid-cols-2">
      {MISSIONS.map((m) => {
        const done = !!progress.completed[m.id];
        const counter = m.target ? `${Math.min(m.progress(progress), m.target)} / ${m.target}` : null;
        return (
          <li key={m.id} className="flex gap-3 border-b border-rule py-3">
            <span
              aria-hidden
              className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[0.7rem] font-bold ${
                done ? 'border-queue bg-queue text-panel' : 'border-rule'
              }`}
            >
              {done ? '✓' : ''}
            </span>
            <div className="min-w-0">
              <p className="font-semibold">
                {m.title} <span className="tabular ml-1 text-sm font-normal text-muted">{m.xp} XP</span>
                <span className="sr-only">{done ? ', completed' : ', not completed'}</span>
              </p>
              <p className="text-sm text-muted">
                {m.goal}
                {counter && !done ? ` (${counter})` : ''}
              </p>
              {done && <p className="mt-1 text-sm">{m.lesson}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Log({ progress, runs, onLoad }) {
  if (!progress.log.length) return <p className="text-muted">Your experiments will be listed here.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[34rem] text-left text-sm">
        <thead className="text-muted">
          <tr className="border-b border-rule">
            <th className="py-2 font-medium">Link</th>
            <th className="py-2 font-medium">Buffer</th>
            <th className="py-2 font-medium">Senders</th>
            <th className="py-2 font-medium">TCP</th>
            <th className="py-2 font-medium">UDP (loss)</th>
            <th className="py-2 font-medium">Delay</th>
            <th className="py-2 font-medium">Guess</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {progress.log.map((e) => {
            const run = runs[e.id];
            if (!run) return null;
            const m = metrics(run);
            return (
              <tr key={e.id} className="border-b border-rule/60">
                <td className="py-2">{e.cfg.bottleneck} Mbps, {e.cfg.delay} ms</td>
                <td className="py-2">{e.cfg.queue} pkts</td>
                <td className="py-2">{[e.cfg.tcp ? 'TCP' : null, e.cfg.udp ? `UDP ${e.cfg.udp}` : null].filter(Boolean).join(' + ')}</td>
                <td className="py-2">{m.tcp ? `${m.tcp.goodput.toFixed(2)} Mbps` : '-'}</td>
                <td className="py-2">{m.udp ? `${m.udp.goodput.toFixed(2)} Mbps (${m.udp.loss.toFixed(1)}%)` : '-'}</td>
                <td className="py-2">{m.delay?.toFixed(0)} ms</td>
                <td className="py-2">{e.prediction ?? '-'}</td>
                <td className="py-2 text-right">
                  <button type="button" onClick={() => onLoad(e.cfg)} className="underline underline-offset-4 hover:text-tcp">
                    Load
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------------------------------- page

export default function Lab({ lab }) {
  const { meta, runs } = lab;
  const grid = meta.grid;
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [predictOn, setPredictOn] = useState(true);
  const target = predictionTarget(cfg);
  const [guess, setGuess] = useState((target.max - target.min) / 2);
  const [active, setActive] = useState(null); // { id, nonce, prediction }
  const [outcome, setOutcome] = useState(null);
  const [progress, setProgress] = useState(loadProgress);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [toasts, setToasts] = useState([]);
  const finishedRef = useRef(null);
  const resultsRef = useRef(null);

  // Keep the guess inside the range when the prediction target changes.
  useEffect(() => {
    setGuess((target.max - target.min) / 2);
  }, [target.key, target.max, target.min]);
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  const id = runKey(cfg);
  const valid = cfg.tcp || cfg.udp;
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  const run = () => {
    if (!valid || !runs[id]) return;
    finishedRef.current = null;
    setOutcome(null);
    setActive({
      id,
      nonce: Date.now(),
      prediction: predictOn ? { target, guess } : null,
    });
  };

  const finish = useCallback(() => {
    if (!active || finishedRef.current === active.nonce) return;
    finishedRef.current = active.nonce;
    const r = runs[active.id];
    const m = metrics(r);
    let prediction = null;
    if (active.prediction) {
      const { target: t, guess: g } = active.prediction;
      const actual = predictionActual(t, m);
      if (actual !== null) prediction = { target: t, guess: g, actual, score: scorePrediction(t, g, m) };
    }
    const res = applyRun(progressRef.current, r, m, prediction);
    progressRef.current = res.progress;
    setProgress(res.progress);
    setOutcome({ id: active.id, prediction, unlocked: res.unlocked, gained: res.gained });
    if (res.unlocked.length) {
      const added = res.unlocked.map((mi) => ({ key: `${mi.id}-${active.nonce}`, title: mi.title, xp: mi.xp }));
      setToasts((tq) => [...tq, ...added]);
      setTimeout(() => setToasts((tq) => tq.filter((t) => !added.includes(t))), 4500);
    }
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }, [active, runs]);

  const replayData = useMemo(() => {
    const showId = active?.id ?? (valid ? id : null);
    return showId && runs[showId] ? { id: showId, data: toReplayData(runs[showId], meta) } : null;
  }, [active, id, valid, runs, meta]);

  const running = active && finishedRef.current !== active.nonce && !outcome;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-8 sm:pt-14">
      <h1 className="display max-w-[20ch] text-[clamp(2.2rem,5vw,4rem)]">Break the network</h1>
      <p className="mt-4 max-w-[64ch] text-lg text-muted">
        Set up the link, choose who sends, predict what will happen, then run it. Every result is a real NS-3
        simulation of this exact setup ({Object.keys(runs).length} configurations, simulated ahead of time).
      </p>

      <div className="mt-8">
        <ProgressBar
          progress={progress}
          onReset={() => {
            if (window.confirm('Reset your XP, missions and experiment log?')) setProgress(freshProgress());
          }}
        />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="space-y-6 rounded-2xl border border-rule bg-panel/70 p-5">
          <Segmented
            label="Bottleneck speed"
            help="The slow link between the two routers."
            options={grid.bottleneck}
            value={cfg.bottleneck}
            unit="Mbps"
            onChange={(v) => set({ bottleneck: v })}
          />
          <Segmented
            label="Router buffer"
            help="Packets Router A can hold before it starts dropping."
            options={grid.queue}
            value={cfg.queue}
            unit="pkts"
            onChange={(v) => set({ queue: v })}
          />
          <Segmented
            label="Link delay"
            help="One-way travel time across the bottleneck."
            options={grid.delay}
            value={cfg.delay}
            unit="ms"
            onChange={(v) => set({ delay: v })}
          />
          <hr className="border-rule" />
          <Toggle
            label="TCP sender"
            help="Downloads as fast as congestion control allows."
            on={!!cfg.tcp}
            onChange={(on) => set({ tcp: on ? 1 : 0 })}
            color={COLOR.tcp}
          />
          <UdpSlider values={grid.udp} value={cfg.udp} bottleneck={cfg.bottleneck} onChange={(v) => set({ udp: v })} />
          <hr className="border-rule" />
          <div>
            <Toggle
              label="Predict first"
              help="Guess before you run. Closer guesses earn more XP."
              on={predictOn}
              onChange={setPredictOn}
              color="#1baf7a"
            />
            {predictOn && valid && (
              <label className="mt-3 block">
                <span className="flex justify-between text-sm">
                  <span>{target.label}</span>
                  <span className="tabular font-semibold">
                    {Number(guess).toFixed(target.digits)} {target.unit}
                  </span>
                </span>
                <input
                  type="range"
                  min={target.min}
                  max={target.max}
                  step={target.step}
                  value={guess}
                  onChange={(e) => setGuess(Number(e.target.value))}
                  className="w-full accent-[#1baf7a]"
                />
              </label>
            )}
          </div>
          <button
            type="button"
            onClick={run}
            disabled={!valid}
            className="w-full rounded-xl bg-ink px-5 py-3.5 text-lg font-semibold text-panel transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted"
          >
            {valid ? 'Run experiment' : 'Turn on at least one sender'}
          </button>
        </div>

        <div className="min-w-0 space-y-6">
          {replayData ? (
            <Replay
              key={active ? active.nonce : replayData.id}
              data={replayData.data}
              fixedRunId={replayData.id}
              autoplay={active ? 'now' : 'off'}
              onFinish={active ? finish : undefined}
            />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-rule text-muted">
              Turn on a sender to see the network.
            </div>
          )}
          {running && (
            <button type="button" onClick={finish} className="text-sm text-muted underline underline-offset-4 hover:text-ink">
              Skip to results
            </button>
          )}
          <div ref={resultsRef}>
            {outcome && runs[outcome.id] && <Scorecard run={runs[outcome.id]} outcome={outcome} />}
          </div>
        </div>
      </div>

      <section className="mt-20">
        <h2 className="display text-[clamp(1.7rem,3vw,2.4rem)]">Missions</h2>
        <p className="mb-4 mt-2 text-muted">Each one teaches a different congestion effect. Find a configuration that triggers it.</p>
        <Missions progress={progress} />
      </section>

      <section className="mt-16">
        <h2 className="display text-[clamp(1.7rem,3vw,2.4rem)]">Your experiments</h2>
        <p className="mb-4 mt-2 text-muted">Most recent first. Load one to put its settings back on the knobs.</p>
        <Log progress={progress} runs={runs} onLoad={(c) => setCfg({ ...c })} />
      </section>

      <Toasts items={toasts} />
    </div>
  );
}
