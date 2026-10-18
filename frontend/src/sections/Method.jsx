import Section from './Section';

const FORMULAS = [
  ['Goodput', 'payload bytes received between 1 s and 10 s × 8 ÷ 9 s ÷ 10⁶'],
  ['Mean delay', 'sum of packet delays ÷ received packets (FlowMonitor)'],
  ['Mean jitter', 'sum of delay differences ÷ (received packets − 1)'],
  ['UDP loss', '(packets sent − packets received) ÷ packets sent'],
  ['Queue drops', 'counted from the Drop trace of Router A’s FIFO queue'],
];

const LIMITS = [
  'FlowMonitor measures at the IP layer, so TCP delay includes retransmitted packets.',
  'TCP loss is not reported as data lost: TCP resends it. The cost appears as lower goodput and window cuts instead.',
  'A TCP goodput bin can briefly exceed the link rate when held-back data is released after a retransmission.',
  'There is no randomness in the scenario, so every run is exactly repeatable and the seed has no effect.',
  'One flow per protocol, one queue size, DropTail only. The results show mechanisms, not general rules.',
];

export default function Method() {
  return (
    <Section
      id="method"
      title="How the numbers were measured"
      aside={
        <div className="space-y-8">
          <div>
            <h3 className="mb-3 font-semibold">Reproduce it</h3>
            <pre className="overflow-x-auto rounded-xl bg-ink p-5 text-sm leading-relaxed text-panel">
              <code>{`# in WSL Ubuntu, from the project folder
export NS3_ROOT=~/ns-3.49
python3 scripts/run_experiments.py           # all 7 runs + charts
python3 scripts/run_experiments.py --only mixed --set queuePackets=10

# on Windows, in frontend/
npm run dev                                  # syncs the CSVs, starts the site`}</code>
            </pre>
          </div>
          <div>
            <h3 className="mb-3 font-semibold">Limits</h3>
            <ul className="list-disc space-y-2 pl-5 text-[0.98rem]">
              {LIMITS.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        </div>
      }
    >
      <p>
        Everything on this page is read from <code>results/summary.csv</code>, <code>timeseries.csv</code> and{' '}
        <code>cwnd.csv</code>, written by the NS-3.49 simulation. A missing run shows up as an empty panel, never as
        an invented value.
      </p>
      <dl className="divide-y divide-rule border-y border-rule">
        {FORMULAS.map(([k, v]) => (
          <div key={k} className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
            <dt className="font-semibold">{k}</dt>
            <dd className="text-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
