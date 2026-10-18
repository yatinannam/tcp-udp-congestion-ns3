import { useEffect, useRef, useState } from 'react';

export const CHART = {
  ink: '#13233a',
  muted: '#566579',
  grid: '#dde4ea',
  axis: '#9fb0c0',
  ref: '#8a97a6',
};

export const MARGIN = { top: 16, right: 18, bottom: 46, left: 58 };

/** Track an element's width so SVG charts can lay out in real pixels. */
export function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function Tooltip({ x, y, width, children }) {
  if (x === null) return null;
  const flip = x > width - 170;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-lg border border-rule bg-panel px-3 py-2 text-xs shadow-sm"
      style={{ left: x, top: y, transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}
    >
      {children}
    </div>
  );
}

export function Axes({ x, y, width, height, xLabel, yLabel, xTicks = 6, yTicks = 5, formatX, formatY }) {
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;
  return (
    <g>
      {y.ticks(yTicks).map((t) => (
        <g key={`y${t}`} transform={`translate(0,${y(t)})`}>
          <line x1={0} x2={innerW} stroke={CHART.grid} />
          <text x={-8} dy="0.32em" textAnchor="end" fontSize={12} fill={CHART.muted} className="tabular">
            {formatY ? formatY(t) : t}
          </text>
        </g>
      ))}
      <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke={CHART.axis} />
      {x.ticks(xTicks).map((t) => (
        <text key={`x${t}`} x={x(t)} y={innerH + 18} textAnchor="middle" fontSize={12} fill={CHART.muted} className="tabular">
          {formatX ? formatX(t) : t}
        </text>
      ))}
      <text x={innerW / 2} y={innerH + 38} textAnchor="middle" fontSize={12.5} fill={CHART.muted}>
        {xLabel}
      </text>
      <text transform={`translate(${-44},${innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize={12.5} fill={CHART.muted}>
        {yLabel}
      </text>
    </g>
  );
}

export function Legend({ items }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          <span
            className="inline-block h-[3px] w-4 rounded-full"
            style={{ background: it.dashed ? 'transparent' : it.color, borderTop: it.dashed ? `2px dashed ${it.color}` : 'none' }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function EmptyChart({ height = 260, command }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-rule px-6 text-center text-sm text-muted"
      style={{ height }}
    >
      <p>
        Not measured yet. Run <code>{command}</code> in WSL, then <code>npm run sync</code>.
      </p>
    </div>
  );
}
