import { useRef, useState } from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { CHART, Legend, Tooltip, useWidth } from './common';
import { prefersReducedMotion } from '../../lib/motion';

const M = { top: 22, right: 12, bottom: 30, left: 52 };

/** Vertical bars with value labels. bars: [{ label, value, color }] */
export default function BarChart({ bars, yLabel, refLine, height = 240, format = (v) => v.toFixed(2), unit = '', ariaLabel }) {
  const [wrapRef, width] = useWidth();
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const innerW = Math.max(width - M.left - M.right, 10);
  const innerH = height - M.top - M.bottom;
  const max = Math.max(...bars.map((b) => b.value), refLine?.value ?? 0) * 1.2 || 1;
  const x = scaleBand().domain(bars.map((b) => b.label)).range([0, innerW]).padding(0.45);
  const y = scaleLinear().domain([0, max]).nice().range([innerH, 0]);

  useGSAP(
    () => {
      if (!width || prefersReducedMotion()) return;
      gsap.from(svgRef.current.querySelectorAll('[data-bar]'), {
        scaleY: 0,
        transformOrigin: '50% 100%',
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.12,
        scrollTrigger: { trigger: svgRef.current, start: 'top 85%', once: true },
      });
    },
    { dependencies: [width > 0], scope: svgRef },
  );

  return (
    <figure>
      {refLine && <Legend items={[{ label: refLine.label, color: CHART.ref, dashed: true }]} />}
      <div ref={wrapRef} className="relative">
        {width > 0 && (
          <svg ref={svgRef} width={width} height={height} role="img" aria-label={ariaLabel}>
            <g transform={`translate(${M.left},${M.top})`}>
              {y.ticks(4).map((t) => (
                <g key={t} transform={`translate(0,${y(t)})`}>
                  <line x1={0} x2={innerW} stroke={CHART.grid} />
                  <text x={-8} dy="0.32em" textAnchor="end" fontSize={12} fill={CHART.muted} className="tabular">
                    {t}
                  </text>
                </g>
              ))}
              <text transform={`translate(${-40},${innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize={12.5} fill={CHART.muted}>
                {yLabel}
              </text>
              {bars.map((b) => (
                <g
                  key={b.label}
                  onPointerEnter={() => setHover(b)}
                  onPointerLeave={() => setHover(null)}
                >
                  {/* generous invisible hit target */}
                  <rect x={x(b.label) - 10} y={0} width={x.bandwidth() + 20} height={innerH} fill="transparent" />
                  <path
                    data-bar
                    d={roundedTop(x(b.label), y(b.value), x.bandwidth(), innerH - y(b.value), 4)}
                    fill={b.color}
                  />
                  <text x={x(b.label) + x.bandwidth() / 2} y={y(b.value) - 7} textAnchor="middle" fontSize={12.5} fill={CHART.ink} className="tabular">
                    {format(b.value)}
                  </text>
                  <text x={x(b.label) + x.bandwidth() / 2} y={innerH + 19} textAnchor="middle" fontSize={12.5} fill={CHART.muted}>
                    {b.label}
                  </text>
                </g>
              ))}
              <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke={CHART.axis} />
              {refLine && (
                <line x1={0} x2={innerW} y1={y(refLine.value)} y2={y(refLine.value)} stroke={CHART.ref} strokeDasharray="5 4" />
              )}
            </g>
          </svg>
        )}
        {hover && (
          <Tooltip x={M.left + x(hover.label) + x.bandwidth()} y={M.top + y(hover.value)} width={width}>
            <span className="tabular text-ink">
              {hover.label}: {format(hover.value)}
              {unit}
            </span>
          </Tooltip>
        )}
      </div>
    </figure>
  );
}

function roundedTop(x, y, w, h, r) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
