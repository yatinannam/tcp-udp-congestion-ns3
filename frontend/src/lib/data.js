import Papa from 'papaparse';

// Run ids produced by scripts/run_experiments.py, in presentation order.
export const RUNS = [
  { id: 'baseline-tcp', label: 'Baseline TCP' },
  { id: 'baseline-udp', label: 'Baseline UDP' },
  { id: 'udp-sweep-2', label: 'UDP 2 Mbps' },
  { id: 'udp-sweep-5', label: 'UDP 5 Mbps' },
  { id: 'udp-sweep-8', label: 'UDP 8 Mbps' },
  { id: 'tcp-bulk', label: 'TCP bulk' },
  { id: 'mixed', label: 'TCP + UDP' },
];

export const FLOW_LABEL = { tcp: 'TCP', udp: 'UDP' };

/** CSV cell -> number, or null when blank. Missing values never become 0. */
export function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchCsv(name) {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) return null;
  const text = await res.text();
  // The dev server answers unknown paths with index.html; only accept real CSVs.
  if (!text.startsWith('run_id,')) return null;
  return Papa.parse(text.trim(), { header: true, skipEmptyLines: true }).data;
}

export async function loadResults() {
  const [summary, timeseries, cwnd] = await Promise.all(
    ['summary.csv', 'timeseries.csv', 'cwnd.csv'].map(fetchCsv),
  );
  return { summary: summary ?? [], timeseries: timeseries ?? [], cwnd: cwnd ?? [] };
}

export function summaryRow(data, runId, flow) {
  return data.summary.find((r) => r.run_id === runId && r.flow === flow) ?? null;
}

export function hasRun(data, runId) {
  return data.summary.some((r) => r.run_id === runId);
}

/** Per-bin series for one run: { bin, flows: { tcp: [...], udp: [...] }, bottleneck: [...] }. */
export function runSeries(data, runId) {
  const rows = data.timeseries.filter((r) => r.run_id === runId);
  if (!rows.length) return null;
  const out = { bin: num(rows[0].bin_s), flows: {}, bottleneck: [] };
  for (const r of rows) {
    const t = num(r.time_s);
    if (r.flow === 'bottleneck') {
      out.bottleneck.push({ t, drops: num(r.queue_drops_cum), qlen: num(r.queue_len_max_pkts) });
    } else {
      (out.flows[r.flow] ??= []).push({ t, goodput: num(r.goodput_mbps), cwnd: num(r.cwnd_bytes) });
    }
  }
  return out;
}

export function cwndSeries(data, runId) {
  return data.cwnd
    .filter((r) => r.run_id === runId)
    .map((r) => ({ x: num(r.time_s), y: num(r.cwnd_bytes) }))
    .filter((p) => p.x !== null && p.y !== null);
}

export function fmt(value, digits = 2) {
  return value === null || value === undefined ? 'n/a' : value.toFixed(digits);
}
