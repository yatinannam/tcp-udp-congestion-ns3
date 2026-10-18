import Section, { ChartBlock } from './Section';
import LineChart from '../components/charts/LineChart';
import { EmptyChart } from '../components/charts/common';
import { fmt, num } from '../lib/data';

const UDP = '#eb6834';

export default function UdpSweep({ data }) {
  const rows = data.summary
    .filter((r) => r.experiment === 'udp-sweep' && r.flow === 'udp')
    .map((r) => ({
      offered: num(r.requested_rate_mbps),
      goodput: num(r.app_goodput_mbps),
      loss: num(r.udp_loss_pct),
      delay: num(r.mean_delay_ms),
      drops: num(r.bottleneck_queue_drops),
      capacity: num(r.bottleneck_mbps),
    }))
    .filter((r) => r.offered !== null)
    .sort((a, b) => a.offered - b.offered);

  const enough = rows.length >= 2;
  const capacity = rows[0]?.capacity;
  const xMax = enough ? Math.max(...rows.map((r) => r.offered)) * 1.1 : 1;
  const pts = (key) => rows.filter((r) => r[key] !== null).map((r) => ({ x: r.offered, y: r[key] }));
  const top = rows[rows.length - 1];
  const low = rows[0];

  return (
    <Section
      id="overload"
      kicker="Experiment B"
      title="Overload: sending faster does not deliver more"
      aside={
        enough ? (
          <>
            <ChartBlock title="Offered load against delivered goodput">
              <LineChart
                ariaLabel="UDP offered rate versus delivered goodput"
                series={[
                  {
                    key: 'g',
                    label: 'UDP delivered',
                    color: UDP,
                    points: pts('goodput'),
                    markers: true,
                    labelPoints: (p) => p.y.toFixed(2),
                  },
                ]}
                refs={[
                  { diagonal: true, label: 'Delivered = offered' },
                  ...(capacity ? [{ y: capacity, label: `Capacity (${capacity} Mbps)` }] : []),
                ]}
                xDomain={[0, xMax]}
                yDomain={[0, xMax]}
                xLabel="Offered UDP rate (Mbps)"
                yLabel="Delivered goodput (Mbps)"
                tipUnit=" Mbps"
              />
            </ChartBlock>
            <div className="grid gap-10 sm:grid-cols-2">
              <ChartBlock title="Estimated loss">
                <LineChart
                  ariaLabel="UDP offered rate versus estimated packet loss"
                  series={[{ key: 'l', label: 'Loss', color: UDP, points: pts('loss'), markers: true, labelPoints: (p) => `${p.y.toFixed(1)}%` }]}
                  xDomain={[0, xMax]}
                  height={240}
                  xLabel="Offered rate (Mbps)"
                  yLabel="Loss (%)"
                  formatTip={(v) => v.toFixed(2)}
                  tipUnit="%"
                />
              </ChartBlock>
              <ChartBlock title="Mean delay">
                <LineChart
                  ariaLabel="UDP offered rate versus mean delay"
                  series={[{ key: 'd', label: 'Delay', color: UDP, points: pts('delay'), markers: true, labelPoints: (p) => `${p.y.toFixed(0)} ms` }]}
                  xDomain={[0, xMax]}
                  height={240}
                  xLabel="Offered rate (Mbps)"
                  yLabel="Delay (ms)"
                  formatTip={(v) => v.toFixed(1)}
                  tipUnit=" ms"
                />
              </ChartBlock>
            </div>
            <table className="tabular w-full text-left text-sm">
              <caption className="mb-2 text-left text-muted">Measured values</caption>
              <thead className="text-muted">
                <tr className="border-b border-rule">
                  <th className="py-2 font-medium">Offered</th>
                  <th className="py-2 font-medium">Delivered</th>
                  <th className="py-2 font-medium">Loss</th>
                  <th className="py-2 font-medium">Delay</th>
                  <th className="py-2 font-medium">Queue drops</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.offered} className="border-b border-rule/60">
                    <td className="py-2">{r.offered} Mbps</td>
                    <td className="py-2">{fmt(r.goodput, 3)} Mbps</td>
                    <td className="py-2">{fmt(r.loss, 1)}%</td>
                    <td className="py-2">{fmt(r.delay, 1)} ms</td>
                    <td className="py-2">{r.drops?.toLocaleString() ?? 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <EmptyChart command="python3 scripts/run_experiments.py --only udp-sweep" />
        )
      }
    >
      <p>
        One UDP source sends at a fixed rate over the {capacity ?? '?'} Mbps bottleneck. Three separate runs use{' '}
        {rows.map((r) => r.offered).join(', ') || '2, 5 and 8'} Mbps. The rate the source asks for is not the rate
        that arrives, and the gap between the two is the point of this experiment.
      </p>
      {enough && (
        <>
          <p>
            At {low.offered} Mbps everything arrives: {fmt(low.goodput, 2)} Mbps delivered, {fmt(low.loss, 1)}% loss,{' '}
            {fmt(low.delay, 1)} ms delay. At {top.offered} Mbps the receiver still gets only {fmt(top.goodput, 2)} Mbps.
            The other {fmt(top.loss, 1)}% of packets are dropped at Router A, and the ones that survive wait in a full
            queue, so delay rises to {fmt(top.delay, 0)} ms.
          </p>
          <p>
            Delivered goodput levels off just under {capacity} Mbps because every packet on the wire also carries UDP,
            IP and link headers. For the same reason, offering exactly {capacity} Mbps of payload is already a slight
            overload.
          </p>
        </>
      )}
    </Section>
  );
}
