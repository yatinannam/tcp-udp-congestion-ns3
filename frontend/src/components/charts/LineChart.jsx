import { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { line, curveStepAfter, curveLinear } from 'd3-shape';
import { bisector } from 'd3-array';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Axes, CHART, Legend, MARGIN, Tooltip, useWidth } from './common';
import { prefersReducedMotion } from '../../lib/motion';

const bisectX = bisector((p) => p.x).center;

/**
 * Line chart for measured series.
 * series: [{ key, label, color, points: [{x, y}], step?, markers?, labelPoints? }]
 * refs:   [{ y?, diagonal?, label }]  horizontal reference lines or a y = x line
 */
export default function LineChart({
  series,
  refs = [],
  xLabel,
  yLabel,
  xDomain,
  yDomain,
  height = 280,
  formatX = (v) => v,
  formatY = (v) => v,
  formatTip = (v) => v.toFixed(2),
  tipUnit = '',
  ariaLabel,
}) {
  const [wrapRef, width] = useWidth();
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 10);
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const { x, y } = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const xd = xDomain ?? [Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))];
    const yd = yDomain ?? [0, Math.max(...all.map((p) => p.y)) * 1.15 || 1];
    return {
      x: scaleLinear().domain(xd).range([0, innerW]),
      y: scaleLinear().domain(yd).nice().range([innerH, 0]),
    };
  }, [series, xDomain, yDomain, innerW, innerH]);

  // Draw each line in once when the chart first scrolls into view.
  useGSAP(
    () => {
      if (!width || prefersReducedMotion()) return;
      const paths = svgRef.current?.querySelectorAll('[data-draw]');
      if (!paths?.length) return;
      paths.forEach((p) => {
        const len = p.getTotalLength();
        gsap.fromTo(
          p,
          { strokeDasharray: len, strokeDashoffset: len },
          {
            strokeDashoffset: 0,
            duration: 1.4,
            ease: 'power2.inOut',
            scrollTrigger: { trigger: svgRef.current, start: 'top 80%', once: true },
            onComplete: () => gsap.set(p, { clearProps: 'strokeDasharray,strokeDashoffset' }),
          },
        );
      });
    },
    { dependencies: [width > 0], scope: svgRef },
  );

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left - MARGIN.left;
    if (px < 0 || px > innerW) return setHover(null);
    const xv = x.invert(px);
    const rows = series.map((s) => {
      const i = bisectX(s.points, xv);
      return { s, p: s.points[i] };
    }).filter((r) => r.p);
    if (!rows.length) return setHover(null);
    setHover({ px: x(rows[0].p.x), rows });
  };

  return (
    <figure>
      {series.length > 1 || refs.length ? (
        <Legend
          items={[
            ...series.map((s) => ({ label: s.label, color: s.color })),
            ...refs.map((r) => ({ label: r.label, color: CHART.ref, dashed: true })),
          ]}
        />
      ) : null}
      <div ref={wrapRef} className="relative">
        {width > 0 && (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            className="touch-pan-y"
          >
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              <Axes x={x} y={y} width={width} height={height} xLabel={xLabel} yLabel={yLabel} formatX={formatX} formatY={formatY} />
              {refs.map((r) =>
                r.diagonal ? (
                  <line
                    key={r.label}
                    x1={x(Math.max(x.domain()[0], y.domain()[0]))}
                    y1={y(Math.max(x.domain()[0], y.domain()[0]))}
                    x2={x(Math.min(x.domain()[1], y.domain()[1]))}
                    y2={y(Math.min(x.domain()[1], y.domain()[1]))}
                    stroke={CHART.ref}
                    strokeDasharray="5 4"
                  />
                ) : (
                  <line key={r.label} x1={0} x2={innerW} y1={y(r.y)} y2={y(r.y)} stroke={CHART.ref} strokeDasharray="5 4" />
                ),
              )}
              {series.map((s) => {
                const gen = line()
                  .x((p) => x(p.x))
                  .y((p) => y(p.y))
                  .curve(s.step ? curveStepAfter : curveLinear);
                return (
                  <g key={s.key}>
                    <path data-draw d={gen(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                    {s.markers &&
                      s.points.map((p) => (
                        <circle key={p.x} cx={x(p.x)} cy={y(p.y)} r={5} fill={s.color} stroke="#f8fafb" strokeWidth={2} />
                      ))}
                    {s.labelPoints &&
                      s.points.map((p) => {
                        const nearRight = x(p.x) > innerW - 48; // keep edge labels inside the plot
                        return (
                          <text
                            key={`l${p.x}`}
                            x={x(p.x) + (nearRight ? -9 : 8)}
                            y={y(p.y) - 9}
                            textAnchor={nearRight ? 'end' : 'start'}
                            fontSize={12}
                            fill={CHART.ink}
                            className="tabular"
                          >
                            {s.labelPoints(p)}
                          </text>
                        );
                      })}
                  </g>
                );
              })}
              {hover && (
                <g pointerEvents="none">
                  <line x1={hover.px} x2={hover.px} y1={0} y2={innerH} stroke={CHART.axis} />
                  {hover.rows.map(({ s, p }) => (
                    <circle key={s.key} cx={x(p.x)} cy={y(p.y)} r={4.5} fill={s.color} stroke="#f8fafb" strokeWidth={2} />
                  ))}
                </g>
              )}
            </g>
          </svg>
        )}
        {hover && (
          <Tooltip x={hover.px + MARGIN.left} y={MARGIN.top + innerH / 3} width={width}>
            <div className="tabular mb-1 text-muted">
              {xLabel.replace(/ \(.*\)$/, '')}: {formatX(hover.rows[0].p.x)}
            </div>
            {hover.rows.map(({ s, p }) => (
              <div key={s.key} className="tabular flex items-center gap-2 text-ink">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}: {formatTip(p.y)}
                {tipUnit}
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </figure>
  );
}
