import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { type PaceUnit, formatPaceValue, isSpeedUnit, toUnitValue, usesMiles } from "./activity";

// Elevation, pace and heart rate along the route. Three single-series charts that
// share one x-axis (distance) and one hover position, which is also shown on the map.

export type ElevationProfile = { distM: number[]; elevationM: (number | null)[] };
export type ActivityPreview = {
  distM: number[];
  paceSecPerKm: number[];
  heartRateBpm: number[] | null;
  totalTimeSec: number;
  maxHeartRateBpm: number | null;
};

type Props = {
  distanceM: number | null;
  elevation: ElevationProfile | null;
  elevationLoading: boolean;
  elevationError: string | null;
  preview: ActivityPreview | null;
  paceUnit: PaceUnit;
  hrEnabled: boolean;
  hoverDistM: number | null;
  onHover: (d: number | null) => void;
};

export default function ActivityCharts(p: Props) {
  const miles = usesMiles(p.paceUnit);
  const speed = isSpeedUnit(p.paceUnit);
  const distUnit = miles ? "mi" : "km";
  const toDistUnit = (m: number) => m / 1000 / (miles ? 1.609344 : 1);
  const xFormat = (m: number) => `${trimNum(toDistUnit(m))} ${distUnit}`;
  const xUnitM = miles ? 1609.344 : 1000; // axis ticks on round km / mi
  const noRoute = p.distanceM === null;

  // ---- elevation
  const ele = p.elevation;
  const eleVals = ele?.elevationM.filter((v): v is number => v !== null) ?? [];
  const eleSummary = eleVals.length ? `${Math.round(Math.min(...eleVals))}–${Math.round(Math.max(...eleVals))} m` : "";

  // ---- pace / speed (in the selected unit)
  const pv = p.preview;
  const paceY = useMemo(
    () => pv?.paceSecPerKm.map((s) => toUnitValue(s, p.paceUnit)) ?? [],
    [pv, p.paceUnit]
  );
  const avgPaceSec = pv && p.distanceM ? pv.totalTimeSec / (p.distanceM / 1000) : null;
  const paceTick = (v: number) => (speed ? trimNum(v) : formatMinutes(v));
  const unitShort = p.paceUnit.replace("min", "").trim(); // "/km", "/mi", "km/h", "mph"

  // ---- heart rate
  const hr = pv?.heartRateBpm ?? null;
  const avgHr = hr && hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : null;

  return (
    <section className="charts-panel" aria-label="Activity charts">
      <ChartCard
        title="Elevation"
        summary={eleSummary}
        hoverText={(d) => valueAt(ele?.distM, ele?.elevationM, d, (v) => `${Math.round(v)} m`)}
        hoverDistM={p.hoverDistM}
        xFormat={xFormat}
        xUnitM={xUnitM}
        x={ele?.distM ?? []}
        y={ele?.elevationM ?? []}
        xMax={p.distanceM ?? 0}
        yTick={(v) => `${Math.round(v)}`}
        yUnit="m"
        minSpan={20}
        onHover={p.onHover}
        state={
          noRoute ? "Snap a route to see elevation"
            : p.elevationLoading ? "loading"
            : p.elevationError ? "Elevation not available"
            : !eleVals.length ? "No elevation data"
            : null
        }
      />
      <ChartCard
        title={speed ? "Speed" : "Pace"}
        summary={avgPaceSec ? `avg ${formatPaceValue(avgPaceSec, p.paceUnit)} ${unitShort}` : ""}
        hoverText={(d) => valueAt(pv?.distM, paceY, d, (v) => `${paceTick(v)} ${unitShort}`)}
        hoverDistM={p.hoverDistM}
        xFormat={xFormat}
        xUnitM={xUnitM}
        x={pv?.distM ?? []}
        y={paceY}
        xMax={p.distanceM ?? 0}
        yTick={paceTick}
        yUnit={unitShort}
        minSpan={speed ? (miles ? 2.5 : 4) : 1 /* km/h or mph, else minutes */}
        invert={!speed /* faster pace (lower number) at the top, like Strava */}
        onHover={p.onHover}
        state={noRoute ? `Snap a route to see ${speed ? "speed" : "pace"}` : !pv ? "loading" : null}
      />
      <ChartCard
        title="Heart Rate"
        summary={avgHr ? `avg ${avgHr} · max ${pv?.maxHeartRateBpm ?? "–"} bpm` : ""}
        hoverText={(d) => valueAt(pv?.distM, hr ?? undefined, d, (v) => `${Math.round(v)} bpm`)}
        hoverDistM={p.hoverDistM}
        xFormat={xFormat}
        xUnitM={xUnitM}
        x={pv?.distM ?? []}
        y={hr ?? []}
        xMax={p.distanceM ?? 0}
        yTick={(v) => `${Math.round(v)}`}
        yUnit="bpm"
        minSpan={20}
        onHover={p.onHover}
        state={
          noRoute ? "Snap a route to see heart rate"
            : !p.hrEnabled ? "Heart rate data is turned off"
            : !pv || !hr ? "loading"
            : null
        }
      />
    </section>
  );
}

// ---------------------------------------------------------------------------

function ChartCard(props: {
  title: string;
  summary: string;
  hoverText: (d: number) => string | null;
  hoverDistM: number | null;
  x: number[];
  y: (number | null)[];
  xMax: number;
  xFormat: (m: number) => string;
  xUnitM: number;
  yTick: (v: number) => string;
  yUnit: string;
  minSpan: number;
  invert?: boolean;
  onHover: (d: number | null) => void;
  state: string | null; // null = show chart, "loading", or a message
}) {
  const hovering = props.hoverDistM !== null && props.state === null;
  const readout = hovering ? props.hoverText(props.hoverDistM!) : null;
  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3>{props.title}</h3>
        <span className="chart-value" aria-live="off">
          {readout ? `${readout} · ${props.xFormat(props.hoverDistM!)}` : props.state === null ? props.summary : ""}
        </span>
      </div>
      {props.state === null ? (
        <LineChart {...props} />
      ) : (
        <div className="chart-empty">
          {props.state === "loading" ? (
            <span className="loading-dots" role="status" aria-label={`Loading ${props.title.toLowerCase()}`}>
              <span />
              <span />
              <span />
            </span>
          ) : (
            props.state
          )}
        </div>
      )}
    </div>
  );
}

const PAD = { left: 38, right: 8, top: 8, bottom: 20 };
const HEIGHT = 120;

function LineChart(props: {
  title: string;
  x: number[];
  y: (number | null)[];
  xMax: number;
  xFormat: (m: number) => string;
  xUnitM: number;
  yTick: (v: number) => string;
  yUnit: string;
  minSpan: number; // smallest y-axis range, so tiny variations don't fill the whole chart
  invert?: boolean;
  hoverDistM: number | null;
  onHover: (d: number | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);

  // Draw in real pixels (crisp 2px lines and text at any width)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(120, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { x, y, xMax, invert } = props;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const vals = y.filter((v): v is number => v !== null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < props.minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - props.minSpan / 2;
    hi = mid + props.minSpan / 2;
  }
  const ticks = niceTicks(lo, hi, 3);
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const sx = (d: number) => PAD.left + (xMax > 0 ? (d / xMax) * plotW : 0);
  const sy = (v: number) => {
    const t = (v - yMin) / (yMax - yMin || 1);
    return PAD.top + (invert ? t : 1 - t) * plotH;
  };
  const baseY = PAD.top + plotH;

  // Line + area, broken where values are missing
  const { line, area } = useMemo(() => {
    let line = "", area = "";
    let seg: [number, number][] = [];
    const flush = () => {
      if (seg.length > 1) {
        line += "M" + seg.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L");
        area += `M${seg[0][0].toFixed(1)},${baseY}L` + seg.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L") +
          `L${seg[seg.length - 1][0].toFixed(1)},${baseY}Z`;
      }
      seg = [];
    };
    x.forEach((d, i) => {
      const v = y[i];
      if (v === null || v === undefined) flush();
      else seg.push([sx(d), sy(v)]);
    });
    flush();
    return { line, area };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, width, yMin, yMax, invert, xMax]);

  const xTicks = niceTicks(0, xMax / props.xUnitM, 4)
    .map((t) => t * props.xUnitM)
    .filter((t) => t <= xMax * 0.97); // skip a tick that would collide with the right edge

  // Hover: snap to the nearest data point
  const hoverIdx = props.hoverDistM === null ? -1 : nearestIndex(x, props.hoverDistM);
  const hv = hoverIdx >= 0 ? y[hoverIdx] : null;

  function onPointer(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    if (px < -4 || px > plotW + 4 || xMax <= 0) return props.onHover(null);
    props.onHover(Math.min(Math.max(px / plotW, 0), 1) * xMax);
  }
  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = xMax / 50;
    const cur = props.hoverDistM ?? 0;
    props.onHover(Math.min(Math.max(cur + (e.key === "ArrowRight" ? step : -step), 0), xMax));
  }

  const summary = vals.length
    ? `${props.title}: from ${props.yTick(Math.min(...vals))} to ${props.yTick(Math.max(...vals))} ${props.yUnit} over ${props.xFormat(xMax)}`
    : props.title;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${summary}. Use the left and right arrow keys to move along the route.`}
        tabIndex={0}
        onPointerMove={onPointer}
        onPointerLeave={() => props.onHover(null)}
        onKeyDown={onKey}
        onBlur={() => props.onHover(null)}
      >
        {/* recessive grid + y ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} className="chart-grid" />
            <text x={PAD.left - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="chart-tick">
              {props.yTick(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={HEIGHT - 4} textAnchor={t === 0 ? "start" : "middle"} className="chart-tick">
            {props.xFormat(t)}
          </text>
        ))}
        <path d={area} className="chart-area" />
        <path d={line} className="chart-line" />
        {hoverIdx >= 0 && (
          <g pointerEvents="none">
            <line x1={sx(x[hoverIdx])} x2={sx(x[hoverIdx])} y1={PAD.top} y2={baseY} className="chart-crosshair" />
            {hv !== null && <circle cx={sx(x[hoverIdx])} cy={sy(hv)} r={4} className="chart-dot" />}
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------

function nearestIndex(xs: number[], d: number): number {
  if (!xs.length) return -1;
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < d) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - d) <= Math.abs(xs[hi] - d) ? lo : hi;
}

function valueAt(
  xs: number[] | undefined, ys: (number | null)[] | undefined, d: number, fmt: (v: number) => string
): string | null {
  if (!xs || !ys || !xs.length) return null;
  const v = ys[nearestIndex(xs, d)];
  return v === null || v === undefined ? null : fmt(v);
}

// Round, evenly spaced axis ticks covering [min, max]
function niceTicks(min: number, max: number, count: number): number[] {
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5 && out.length < 12; v += step) out.push(Number(v.toFixed(6)));
  if (out[out.length - 1] < max) out.push(Number((out[out.length - 1] + step).toFixed(6)));
  return out;
}

function trimNum(v: number) {
  return v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
}

// minutes (decimal) -> "5:30"
function formatMinutes(v: number) {
  let m = Math.floor(v);
  let s = Math.round((v - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${s.toString().padStart(2, "0")}`;
}
