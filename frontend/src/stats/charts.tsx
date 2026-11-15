import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fmt, fmtDay } from "./data";

// Hand-made SVG charts for the stats dashboard. Colors come from CSS variables in stats.css
// (light and dark values); every value shown on hover is also in the table at the bottom.

// ---------------------------------------------------------------- helpers

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// Clean axis maximum and step (1, 2, 5 × 10^n), at least 4 so small counts get whole-number ticks
function niceScale(max: number, ticks = 4) {
  const raw = Math.max(max, ticks) / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  return { max: step * Math.ceil(Math.max(max, ticks) / step), step };
}

// Column with a 4px rounded data end and a square base
function columnPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

type Tip = { x: number; y: number; content: ReactNode } | null;

function Tooltip({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  // keep the tooltip inside its card
  useEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const parent = el.offsetParent as HTMLElement | null;
    const pw = parent?.clientWidth ?? 0;
    const w = el.offsetWidth;
    const left = tip.x - w / 2;
    setShift(left < 0 ? -left : left + w > pw ? pw - (left + w) : 0);
  }, [tip]);
  if (!tip) return null;
  return (
    <div ref={ref} className="viz-tip" style={{ left: tip.x + shift, top: tip.y }} role="status">
      {tip.content}
    </div>
  );
}

export function TipRow({ color, value, label, kind = "line" }: { color?: string; value: ReactNode; label: ReactNode; kind?: "line" | "box" }) {
  return (
    <div className="viz-tip-row">
      {color && <span className={kind === "line" ? "key-line" : "key-box"} style={{ background: color }} />}
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function Legend({ items, kind = "line" }: { items: { label: string; color: string }[]; kind?: "line" | "box" }) {
  return (
    <ul className="viz-legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className={kind === "line" ? "key-line" : "key-box"} style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function Empty({ children = "No data in this period yet" }: { children?: ReactNode }) {
  return <div className="viz-empty">{children}</div>;
}

// ---------------------------------------------------------------- line chart

export type LineSeries = { key: string; label: string; color: string; values: number[] };

export function LineChart({ days, series, height = 260, ariaLabel }: {
  days: string[]; series: LineSeries[]; height?: number; ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = days.length;
  const m = { l: 44, r: 16, t: 12, b: 28 };
  const w = Math.max(0, width - m.l - m.r);
  const h = height - m.t - m.b;
  const { max, step } = niceScale(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i: number) => m.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => m.t + h - (v / max) * h;

  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 72))));

  function pick(clientX: number) {
    const rect = ref.current!.getBoundingClientRect();
    const px = clientX - rect.left - m.l;
    setHover(Math.min(n - 1, Math.max(0, Math.round(n <= 1 ? 0 : (px / w) * (n - 1)))));
  }

  const tip: Tip =
    hover === null
      ? null
      : {
          x: x(hover),
          y: m.t,
          content: (
            <>
              <div className="viz-tip-title">{fmtDay(days[hover], { weekday: "short", day: "numeric", month: "short" })}</div>
              {series.map((s) => (
                <TipRow key={s.key} color={s.color} value={fmt(s.values[hover])} label={s.label} />
              ))}
            </>
          ),
        };

  return (
    <div className="viz" ref={ref}>
      {series.length > 1 && <Legend items={series} />}
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((i) => Math.max(0, (i ?? n) - 1));
            if (e.key === "ArrowRight") setHover((i) => Math.min(n - 1, (i ?? -1) + 1));
          }}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? "viz-base" : "viz-grid"} x1={m.l} x2={m.l + w} y1={y(v)} y2={y(v)} />
              <text className="viz-axis" x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end">{fmt(v)}</text>
            </g>
          ))}
          {days.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d} className="viz-axis" x={x(i)} y={height - 8} textAnchor="middle">{fmtDay(d)}</text>
            ) : null
          )}
          {series.length === 1 && n > 1 && (
            <path
              d={`M${x(0)},${y(0)}${series[0].values.map((v, i) => `L${x(i)},${y(v)}`).join("")}L${x(n - 1)},${y(0)}Z`}
              fill={series[0].color}
              opacity={0.1}
            />
          )}
          {series.map((s) => (
            <path
              key={s.key}
              d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hover !== null && (
            <>
              <line className="viz-cross" x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + h} />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color} className="viz-dot" />
              ))}
            </>
          )}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------- column chart

export function ColumnChart({ labels, values, color, height = 200, ariaLabel, tipLabel, valueLabel = "", labelEvery }: {
  labels: string[];
  values: number[];
  color: string;
  height?: number;
  ariaLabel: string;
  tipLabel?: (i: number) => ReactNode;
  valueLabel?: string;
  labelEvery?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const m = { l: 36, r: 8, t: 18, b: 26 };
  const w = Math.max(0, width - m.l - m.r);
  const h = height - m.t - m.b;
  const { max, step } = niceScale(Math.max(0, ...values));
  const slot = n ? w / n : 0;
  const bw = Math.min(24, Math.max(2, slot - 2)); // 2px surface gap between touching columns
  const y = (v: number) => m.t + h - (v / max) * h;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  // show every n-th label so they never collide (labels are ~6.5px per character)
  const labelW = Math.max(...labels.map((l) => l.length), 1) * 6.5 + 8;
  const every = Math.max(labelEvery ?? 1, Math.ceil(n / Math.max(1, Math.floor(w / labelW))));
  const top = values.length ? values.indexOf(Math.max(...values)) : -1;

  const tip: Tip =
    hover === null
      ? null
      : {
          x: m.l + slot * hover + slot / 2,
          y: Math.max(0, y(values[hover]) - 8),
          content: (
            <>
              <div className="viz-tip-title">{tipLabel ? tipLabel(hover) : labels[hover]}</div>
              <TipRow color={color} kind="box" value={fmt(values[hover])} label={valueLabel} />
            </>
          ),
        };

  return (
    <div className="viz" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? "viz-base" : "viz-grid"} x1={m.l} x2={m.l + w} y1={y(v)} y2={y(v)} />
              <text className="viz-axis" x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end">{fmt(v)}</text>
            </g>
          ))}
          {values.map((v, i) => {
            const cx = m.l + slot * i + slot / 2;
            return (
              <g key={labels[i]}>
                <path
                  d={columnPath(cx - bw / 2, y(v), bw, m.t + h - y(v))}
                  fill={color}
                  className={hover === i ? "viz-mark is-hover" : "viz-mark"}
                />
                {i === top && v > 0 && (
                  <text className="viz-value" x={cx} y={y(v) - 6} textAnchor="middle">{fmt(v)}</text>
                )}
                {i % every === 0 && (
                  <text className="viz-axis" x={cx} y={height - 8} textAnchor="middle">{labels[i]}</text>
                )}
                {/* hit area: the whole slot, taller than the column */}
                <rect
                  x={m.l + slot * i}
                  y={m.t}
                  width={slot}
                  height={h}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${labels[i]}: ${v}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------- horizontal bars (ranked lists)

export type BarRow = { key: string; label: ReactNode; value: number; note?: ReactNode; color?: string };

export function BarList({ rows, color, total, emptyText }: { rows: BarRow[]; color: string; total?: number; emptyText?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <Empty>{emptyText}</Empty>;
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.key} title={`${typeof r.label === "string" ? r.label : r.key}: ${r.value}`}>
          <div className="bar-label">{r.label}</div>
          <div className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} />
          </div>
          <div className="bar-value">
            {fmt(r.value)}
            {total ? <span className="bar-share">{Math.round((r.value / total) * 100)} %</span> : null}
            {r.note}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- segmented bar (one whole, split into parts)

export type Part = { key: string; label: string; value: number; color: string; ink: string };

export function SegmentedBar({ parts, ariaLabel }: { parts: Part[]; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <Empty />;
  const shown = parts.filter((p) => p.value > 0);
  const gaps = (shown.length - 1) * 2;
  let x = 0;
  return (
    <div className="viz" ref={ref}>
      <div className="seg-bar" role="img" aria-label={`${ariaLabel}: ${shown.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {width > 0 &&
          shown.map((p, i) => {
            const pw = ((width - gaps) * p.value) / total;
            const share = `${Math.round((p.value / total) * 100)} %`;
            const left = x;
            x += pw + 2;
            return (
              <div
                key={p.key}
                className={hover === i ? "seg is-hover" : "seg"}
                style={{ left, width: pw, background: p.color, color: p.ink }}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                title={`${p.label}: ${fmt(p.value)} (${share})`}
              >
                {pw > share.length * 8 + 16 ? share : ""}
              </div>
            );
          })}
      </div>
      <ul className="viz-legend seg-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="key-box" style={{ background: p.color }} />
            {p.label} <strong>{fmt(p.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- sparkline (stat tiles)

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const h = 32;
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => `${n <= 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2},${h - 3 - (v / max) * (h - 6)}`);
  return (
    <div className="spark" ref={ref} aria-hidden="true">
      {width > 0 && n > 1 && (
        <svg width={width} height={h}>
          <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
