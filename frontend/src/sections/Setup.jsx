import Section from './Section';
import { num } from '../lib/data';

export default function Setup({ data }) {
  // Parameters are read back from the runs, so a changed experiment shows here too.
  const congested = data.summary.find((r) => r.experiment !== 'baseline') ?? data.summary[0];
  const baseline = data.summary.find((r) => r.experiment === 'baseline');
  const tcp = data.summary.find((r) => r.protocol === 'TCP');
  const v = (row, key, unit = '') => (row && num(row[key]) !== null ? `${num(row[key])}${unit}` : 'n/a');

  const rows = [
    ['Access links (4)', '100 Mbps, 1 ms each way (simulator default)'],
    [
      'Bottleneck link',
      `${v(congested, 'bottleneck_mbps', ' Mbps')}, ${v(congested, 'bottleneck_delay_ms', ' ms')}` +
        (baseline ? ` (${v(baseline, 'bottleneck_mbps', ' Mbps')} in the baseline)` : ''),
    ],
    ['Router A queue', `DropTail FIFO, ${v(congested, 'queue_packets', ' packets')}`],
    ['Packet payload', v(congested, 'packet_size_bytes', ' bytes')],
    ['Traffic', `${v(congested, 'app_start_s', ' s')} to ${v(congested, 'app_stop_s', ' s')}, simulation ends at ${v(congested, 'sim_stop_s', ' s')}`],
    ['TCP variant', tcp?.tcp_variant?.replace('ns3::', '') || 'n/a'],
  ];

  return (
    <Section
      id="setup"
      title="One shared bottleneck"
      aside={
        <dl className="divide-y divide-rule rounded-2xl border border-rule bg-panel">
          {rows.map(([k, val]) => (
            <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-5 py-3.5">
              <dt className="text-muted">{k}</dt>
              <dd className="tabular">{val}</dd>
            </div>
          ))}
        </dl>
      }
    >
      <p className="text-xl leading-snug">
        How do TCP and UDP behave as traffic approaches and exceeds the capacity of a bottleneck link, and what
        changes when both share it?
      </p>
      <p>
        Two senders connect to Router A over fast links. Router A forwards everything to Router B over a single
        slow link, then Router B delivers to two receivers. The fast links are twenty times quicker than the
        bottleneck, so packets can only pile up in one place: the queue at Router A. When that queue is full, new
        packets are dropped.
      </p>
      <p>
        TCP waits for acknowledgements, resends lost data and slows down when it sees loss. UDP does none of that:
        it sends at whatever rate the application chooses. The four experiments below test what that difference
        means in practice.
      </p>
      <p className="text-sm text-muted">
        Goodput is application data that actually reached the receiver, measured from 1 s to 10 s. Delay and jitter
        come from NS-3&rsquo;s FlowMonitor at the IP layer.
      </p>
    </Section>
  );
}

