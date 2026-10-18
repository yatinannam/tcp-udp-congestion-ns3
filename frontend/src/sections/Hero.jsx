import SplitText from '../components/reactbits/SplitText/SplitText';
import Replay from '../components/Replay';
import { scrollToId } from '../lib/motion';

const NAV = [
  ['setup', 'Setup'],
  ['baseline', 'Baseline'],
  ['overload', 'UDP overload'],
  ['tcp', 'TCP adapts'],
  ['competition', 'Competition'],
  ['method', 'Method'],
];

export function Nav({ view }) {
  const tab = (id, label) => (
    <a
      href={id === 'lab' ? '#lab' : '#report'}
      aria-current={view === id ? 'page' : undefined}
      className={`rounded-full px-3 py-1 text-sm font-medium ${view === id ? 'bg-ink text-panel' : 'text-ink hover:bg-rule/60'}`}
    >
      {label}
    </a>
  );
  return (
    <nav className="sticky top-0 z-20 border-b border-rule/70 bg-paper/85 backdrop-blur" aria-label="Main">
      <div className="mx-auto flex max-w-6xl items-center gap-5 overflow-x-auto px-4 py-2.5 sm:px-8">
        <span className="condensed shrink-0 font-bold">TCP vs UDP</span>
        <div className="flex shrink-0 gap-1">
          {tab('lab', 'Lab')}
          {tab('report', 'Report')}
        </div>
        {view === 'report' && (
          <ul className="flex gap-4 text-sm text-muted">
            {NAV.map(([id, label]) => (
              <li key={id} className="shrink-0">
                <a
                  href={`#${id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToId(id);
                  }}
                  className="hover:text-ink"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

export default function Hero({ data }) {
  return (
    <header className="plot-grid">
      <div className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-8 sm:pt-14">
        <SplitText
          tag="h1"
          text="TCP and UDP on a congested link"
          className="display max-w-[18ch] text-[clamp(2.3rem,5.4vw,4.4rem)]"
          splitType="words"
          delay={70}
          duration={1}
          textAlign="left"
          trigger="load"
        />
        <p className="mt-5 max-w-[64ch] text-lg text-muted">
          Seven NS-3 simulations of a six-node network whose traffic must squeeze through one 5 Mbps link.
          Pick a run below to replay what the simulator measured: how fast each flow got through, how full
          the router queue was, and how many packets were dropped.
        </p>
        <div className="mt-8">
          <Replay data={data} />
        </div>
      </div>
    </header>
  );
}
