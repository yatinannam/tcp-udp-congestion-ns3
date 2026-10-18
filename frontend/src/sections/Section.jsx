/** Shared layout: experiment letter + heading + lead on the left, evidence on the right. */
export default function Section({ id, kicker, title, children, aside }) {
  return (
    <section id={id} className="border-t border-rule">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <div className="max-w-[62ch]">
          {kicker && <p className="mb-3 text-muted">{kicker}</p>}
          <h2 className="display text-[clamp(1.9rem,3.6vw,2.9rem)]">{title}</h2>
          <div className="mt-6 space-y-4 text-[1.02rem] leading-relaxed">{children}</div>
        </div>
        <div className="min-w-0 space-y-10">{aside}</div>
      </div>
    </section>
  );
}

export function Stat({ label, value, color }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="tabular mt-0.5 text-xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </dd>
    </div>
  );
}

export function ChartBlock({ title, note, children }) {
  return (
    <div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      {note && <p className="mb-3 text-sm text-muted">{note}</p>}
      {children}
    </div>
  );
}
