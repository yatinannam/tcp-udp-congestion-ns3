import { useEffect, useState } from 'react';
import { loadResults } from './lib/data';
import { loadLab } from './lib/lab';
import Lab from './sections/Lab';
import { useSmoothScroll } from './lib/motion';
import Hero, { Nav } from './sections/Hero';
import Setup from './sections/Setup';
import Baseline from './sections/Baseline';
import UdpSweep from './sections/UdpSweep';
import TcpBulk from './sections/TcpBulk';
import Mixed from './sections/Mixed';
import Method from './sections/Method';

export default function App() {
  const [data, setData] = useState(null);
  const [lab, setLab] = useState(undefined);
  const [error, setError] = useState(null);
  const [view, setView] = useState(() => (window.location.hash === '#report' ? 'report' : 'lab'));
  useSmoothScroll();

  useEffect(() => {
    loadResults().then(setData).catch((e) => setError(e.message));
    loadLab().then(setLab);
    const onHash = () => setView(window.location.hash === '#report' ? 'report' : 'lab');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  if (error) {
    return <p className="p-8 text-ink">Could not load the results: {error}</p>;
  }
  if (!data || lab === undefined) {
    return <p className="p-8 text-muted">Loading simulation results…</p>;
  }
  if (view === 'lab') {
    return (
      <>
        <Nav view="lab" />
        {lab ? (
          <Lab lab={lab} />
        ) : (
          <main className="mx-auto max-w-2xl px-4 py-24">
            <h1 className="display text-4xl">Lab data missing</h1>
            <p className="mt-4 text-muted">
              Run <code>python3 scripts/build_lab_dataset.py</code> in WSL, then <code>npm run sync</code> here and reload.
            </p>
          </main>
        )}
      </>
    );
  }
  if (!data.summary.length) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-24">
        <h1 className="display text-4xl">No results yet</h1>
        <p className="mt-4 text-muted">
          Run <code>python3 scripts/run_experiments.py</code> in WSL to simulate the experiments, then run{' '}
          <code>npm run sync</code> here and reload.
        </p>
      </main>
    );
  }

  return (
    <>
      <Nav view="report" />
      <Hero data={data} />
      <main>
        <Setup data={data} />
        <Baseline data={data} />
        <UdpSweep data={data} />
        <TcpBulk data={data} />
        <Mixed data={data} />
        <Method />
      </main>
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-8">
          <p>Performance Analysis of TCP and UDP Under Network Congestion Using NS-3</p>
          <a className="text-ink underline decoration-rule underline-offset-4 hover:decoration-ink" href="https://github.com/yatinannam/tcp-udp-congestion-ns3">
            Source on GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
