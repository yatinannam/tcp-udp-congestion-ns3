import Section, { ChartBlock, Stat } from './Section';
import LineChart from '../components/charts/LineChart';
import { EmptyChart } from '../components/charts/common';
import { cwndSeries, fmt, num, runSeries, summaryRow } from '../lib/data';

const TCP = '#2a78d6';
const QUEUE = '#1baf7a';

export default function TcpBulk({ data }) {
  const row = summaryRow(data, 'tcp-bulk', 'tcp');
  const cwnd = cwndSeries(data, 'tcp-bulk').map((p) => ({ x: p.x, y: p.y / 1024 }));
  const series = runSeries(data, 'tcp-bulk');
  const queue = series?.bottleneck.filter((p) => p.qlen !== null).map((p) => ({ x: p.t, y: p.qlen })) ?? [];
  const simStop = num(row?.sim_stop_s) ?? 12;
  const peak = cwnd.length ? Math.max(...cwnd.map((p) => p.y)) : null;

  return (
    <Section
      id="tcp"
      kicker="Experiment C"
      title="TCP finds the limit, backs off, tries again"
      aside={
        row && cwnd.length > 1 ? (
          <>
            <ChartBlock
              title="Congestion window"
              note="Every change recorded by the NS-3 CongestionWindow trace on the TCP sender."
            >
              <LineChart
                ariaLabel="TCP congestion window over time in the TCP bulk run"
                series={[{ key: 'c', label: 'Congestion window', color: TCP, points: cwnd, step: true }]}
                xDomain={[0, simStop]}
                xLabel="Simulation time (s)"
                yLabel="Window (KiB)"
                formatTip={(v) => v.toFixed(1)}
                tipUnit=" KiB"
              />
            </ChartBlock>
            {queue.length > 0 && (
              <ChartBlock title="Router A queue" note="Highest occupancy in each 0.5 s bin.">
                <LineChart
                  ariaLabel="Router A queue occupancy over time in the TCP bulk run"
                  series={[{ key: 'q', label: 'Queue', color: QUEUE, points: queue, step: true }]}
                  xDomain={[0, simStop]}
                  height={200}
                  xLabel="Simulation time (s)"
                  yLabel="Packets"
                  formatTip={(v) => v.toFixed(0)}
                  tipUnit=" packets"
                />
              </ChartBlock>
            )}
          </>
        ) : (
          <EmptyChart command="python3 scripts/run_experiments.py --only tcp-bulk" />
        )
      }
    >
      <p>
        A single TCP flow sends as much data as it is allowed to. Nobody tells it the link speed. Instead, TCP keeps
        growing its congestion window, the amount of data it may have in flight, until a packet is lost. It then
        cuts the window and starts growing it again.
      </p>
      {row && (
        <>
          <p>
            In the chart you can see slow start shoot the window up in the first few hundred milliseconds, overfill
            the queue and lose packets. After that NewReno grows the window slowly, by about one packet per round
            trip, until the queue overflows again.
          </p>
          <dl className="grid grid-cols-3 gap-6 pt-2">
            <Stat label="Goodput" value={`${fmt(num(row.app_goodput_mbps), 2)} Mbps`} color={TCP} />
            <Stat label="Peak window" value={`${fmt(peak, 0)} KiB`} />
            <Stat label="Queue drops" value={num(row.bottleneck_queue_drops)?.toLocaleString() ?? 'n/a'} />
          </dl>
          <p className="text-sm text-muted">
            TCP resends every dropped packet, so these drops cost time rather than data. The cost shows up as goodput
            below the link rate and a queue that keeps filling and draining.
          </p>
        </>
      )}
    </Section>
  );
}
