import Section, { ChartBlock } from './Section';
import LineChart from '../components/charts/LineChart';
import { EmptyChart } from '../components/charts/common';
import CountUp from '../components/reactbits/CountUp/CountUp';
import { fmt, num, runSeries, summaryRow } from '../lib/data';

const COLOR = { tcp: '#2a78d6', udp: '#eb6834' };

function CapacitySplit({ tcp, udp, capacity }) {
  const unused = Math.max(capacity - tcp - udp, 0);
  const parts = [
    { key: 'tcp', label: 'TCP', value: tcp, color: COLOR.tcp },
    { key: 'udp', label: 'UDP', value: udp, color: COLOR.udp },
    { key: 'unused', label: 'Headers and idle', value: unused, color: '#dfe6ec' },
  ];
  return (
    <figure>
      <div className="flex h-12 gap-[2px] overflow-hidden rounded-lg" role="img" aria-label={`Of ${capacity} Mbps: TCP ${tcp.toFixed(2)}, UDP ${udp.toFixed(2)}, ${unused.toFixed(2)} headers and idle.`}>
        {parts.map((p) => (
          <div key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value.toFixed(2)} Mbps`} />
        ))}
      </div>
      <figcaption className="tabular mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label} {p.value.toFixed(2)} Mbps
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export default function Mixed({ data }) {
  const tcp = summaryRow(data, 'mixed', 'tcp');
  const udp = summaryRow(data, 'mixed', 'udp');
  const series = runSeries(data, 'mixed');
  const complete = tcp && udp && series;
  const g = (r) => num(r?.app_goodput_mbps) ?? 0;
  const capacity = num(tcp?.bottleneck_mbps);
  const udpReq = num(udp?.requested_rate_mbps);
  const simStop = num(tcp?.sim_stop_s) ?? 12;
  const line = (f) =>
    (series?.flows[f] ?? []).filter((p) => p.goodput !== null).map((p) => ({ x: p.t, y: p.goodput }));

  return (
    <Section
      id="competition"
      kicker="Experiment D"
      title="Sharing the link: TCP yields, UDP does not"
      aside={
        complete ? (
          <>
            <div className="grid grid-cols-2 gap-6">
              {[
                ['tcp', 'TCP goodput'],
                ['udp', 'UDP goodput'],
              ].map(([f, label]) => (
                <div key={f}>
                  <p className="text-sm text-muted">{label}</p>
                  <p className="display tabular text-[clamp(2.2rem,5vw,3.6rem)]" style={{ color: COLOR[f] }}>
                    <CountUp to={g(f === 'tcp' ? tcp : udp)} decimals={2} duration={1.6} />
                    <span className="ml-2 text-lg font-semibold text-muted">Mbps</span>
                  </p>
                </div>
              ))}
            </div>
            {capacity && <CapacitySplit tcp={g(tcp)} udp={g(udp)} capacity={capacity} />}
            <ChartBlock title="Goodput over time" note="Application data received in each 0.5 s bin.">
              <LineChart
                ariaLabel="TCP and UDP goodput over time in the mixed run"
                series={[
                  { key: 'tcp', label: 'TCP', color: COLOR.tcp, points: line('tcp'), step: true },
                  { key: 'udp', label: 'UDP', color: COLOR.udp, points: line('udp'), step: true },
                ]}
                refs={capacity ? [{ y: capacity, label: `Capacity (${capacity} Mbps)` }] : []}
                xDomain={[0, simStop]}
                yDomain={[0, (capacity ?? 5) * 1.15]}
                xLabel="Simulation time (s)"
                yLabel="Goodput (Mbps)"
                tipUnit=" Mbps"
              />
            </ChartBlock>
          </>
        ) : (
          <EmptyChart command="python3 scripts/run_experiments.py --only mixed" />
        )
      }
    >
      <p>
        Now both senders run at once. TCP sends as fast as it is allowed, and UDP offers a constant{' '}
        {udpReq ?? '?'} Mbps. Both go through the same {capacity ?? '?'} Mbps link and the same queue.
      </p>
      {complete && (
        <>
          <p>
            UDP got {fmt(g(udp), 2)} Mbps through, losing {fmt(num(udp.udp_loss_pct), 1)}% of its packets. TCP got{' '}
            {fmt(g(tcp), 2)} Mbps, roughly what was left. When the queue overflowed, TCP saw the loss and shrank its
            window. UDP saw nothing and kept sending at the same rate.
          </p>
          <p>
            That is what &ldquo;no congestion control&rdquo; means in practice: an unresponsive flow keeps its share,
            and responsive flows around it give way.
          </p>
          <p className="text-sm text-muted">
            The two senders are not equally provisioned, so this is not a fairness measurement. The split depends
            on the configured UDP rate. Re-run with <code>--set udpRateMbps=4.5</code> to see it change.
          </p>
        </>
      )}
    </Section>
  );
}
