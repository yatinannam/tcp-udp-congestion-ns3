import Section, { ChartBlock, Stat } from './Section';
import BarChart from '../components/charts/BarChart';
import { EmptyChart } from '../components/charts/common';
import { fmt, num, summaryRow } from '../lib/data';

const COLOR = { tcp: '#2a78d6', udp: '#eb6834' };

export default function Baseline({ data }) {
  const tcp = summaryRow(data, 'baseline-tcp', 'tcp');
  const udp = summaryRow(data, 'baseline-udp', 'udp');
  const complete = tcp && udp;
  const g = (r) => num(r?.app_goodput_mbps);
  const d = (r) => num(r?.mean_delay_ms);
  const j = (r) => num(r?.mean_jitter_ms);
  const requested = num((tcp ?? udp)?.requested_rate_mbps);
  const capacity = num((tcp ?? udp)?.bottleneck_mbps);
  const drops = [tcp, udp].map((r) => num(r?.bottleneck_queue_drops)).filter((v) => v !== null);

  return (
    <Section
      id="baseline"
      kicker="Experiment A"
      title="Low load: both protocols keep up"
      aside={
        complete ? (
          <>
            <ChartBlock title="Goodput at the receiver" note="Separate runs, one flow each.">
              <BarChart
                ariaLabel="Baseline goodput for TCP and UDP"
                bars={[
                  { label: 'TCP', value: g(tcp), color: COLOR.tcp },
                  { label: 'UDP', value: g(udp), color: COLOR.udp },
                ]}
                yLabel="Mbps"
                refLine={requested !== null ? { value: requested, label: `Requested rate (${requested} Mbps)` } : null}
                format={(v) => v.toFixed(3)}
                unit=" Mbps"
              />
            </ChartBlock>
            <ChartBlock title="Mean one-way delay">
              <BarChart
                ariaLabel="Baseline mean delay for TCP and UDP"
                bars={[
                  { label: 'TCP', value: d(tcp), color: COLOR.tcp },
                  { label: 'UDP', value: d(udp), color: COLOR.udp },
                ]}
                yLabel="ms"
                height={200}
                unit=" ms"
              />
            </ChartBlock>
          </>
        ) : (
          <EmptyChart command="python3 scripts/run_experiments.py --only baseline" />
        )
      }
    >
      <p>
        Each protocol sends {requested ?? '?'} Mbps of 1024-byte packets, paced by the same application, over a{' '}
        {capacity ?? '?'} Mbps bottleneck. The link has ten times the capacity needed, so this run shows the protocols
        without congestion.
      </p>
      {complete && (
        <>
          <p>
            TCP delivered {fmt(g(tcp), 3)} Mbps and UDP {fmt(g(udp), 3)} Mbps. Delay is {fmt(d(tcp))} ms and{' '}
            {fmt(d(udp))} ms, close to the 12 ms of propagation along the path plus the time to transmit each packet.
            {drops.every((v) => v === 0) ? ' The queue never dropped a packet.' : ''}
          </p>
          <dl className="grid grid-cols-2 gap-6 pt-2">
            <Stat label="TCP jitter" value={`${fmt(j(tcp), 4)} ms`} color={COLOR.tcp} />
            <Stat label="UDP jitter" value={`${fmt(j(udp), 4)} ms`} color={COLOR.udp} />
          </dl>
          <p className="text-sm text-muted">
            The workloads match in rate and payload, not packet for packet: TCP also carries a handshake, ACKs going
            the other way and a larger header, which is why its goodput is slightly lower.
          </p>
        </>
      )}
    </Section>
  );
}
