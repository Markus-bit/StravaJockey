import type { CSSProperties, ReactNode } from "react";
import {
  Activity, Bike, Calendar, Clock, Footprints, Gauge, Heart, Hexagon, Ruler, Timer, TrendingUp,
} from "lucide-react";
import {
  type ActivitySettings, type PaceUnit, type Sport,
  DEFAULT_PACE, SLIDER_RANGE, UNITS_FOR_SPORT,
  defaultActivityName, formatDuration, formatPaceValue, fromUnitValue, heartRateLabel,
  hrVariabilityLabel, isSpeedUnit, paceVariabilityLabel, toUnitValue, usesMiles,
} from "./activity";

const ICON = 20;

type Props = {
  settings: ActivitySettings;
  onChange: (patch: Partial<ActivitySettings>) => void;
  distanceM: number | null;
  elevationGainM: number | null;
  elevationLoading: boolean;
  busy: boolean;
  downloading: boolean;
  onDownload: () => void;
  onClear: () => void;
};

export default function RunDetails({
  settings: s, onChange, distanceM, elevationGainM, elevationLoading, busy, downloading, onDownload, onClear,
}: Props) {
  const isRun = s.sport === "run";
  const word = isRun ? "Run" : "Ride";
  const speed = isSpeedUnit(s.paceUnit);
  const miles = usesMiles(s.paceUnit);
  const range = SLIDER_RANGE[s.paceUnit];
  const unitValue = toUnitValue(s.paceSecPerKm, s.paceUnit);
  const PaceIcon = isRun ? Footprints : Gauge;

  function setSport(sport: Sport) {
    if (sport === s.sport) return;
    onChange({ sport, paceUnit: UNITS_FOR_SPORT[sport][0], paceSecPerKm: DEFAULT_PACE[sport] });
  }

  const distanceText =
    distanceM === null ? "–" : `${(distanceM / 1000 / (miles ? 1.609344 : 1)).toFixed(2)} ${miles ? "mi" : "km"}`;
  const durationText = distanceM === null ? "–" : formatDuration((distanceM / 1000) * s.paceSecPerKm);
  const elevationText =
    elevationLoading ? "…" : elevationGainM === null ? "–" : `${elevationGainM}m`;

  return (
    <section className="controls-panel run-details">
      <div className="rd-header">
        <h2>{word} Details</h2>
        <div className="sport-toggle">
          <span className={isRun ? "active" : ""}>Run</span>
          <Switch
            checked={!isRun}
            onChange={(bike) => setSport(bike ? "bike" : "run")}
            label="Switch between run and bike"
            neutral
          />
          <span className={!isRun ? "active" : ""}>Bike</span>
        </div>
      </div>

      <div className="stats-card">
        <h3>{word} Stats</h3>
        <div className="stats-grid">
          <Stat icon={<Ruler size={ICON} />} value={distanceText} label="Distance" />
          <Stat icon={<Timer size={ICON} />} value={durationText} label="Duration" />
          <Stat icon={<TrendingUp size={ICON} />} value={elevationText} label="Elevation Gain" />
          <Stat
            icon={isRun ? <Footprints size={ICON} /> : <Bike size={ICON} />}
            value={formatPaceValue(s.paceSecPerKm, s.paceUnit)}
            label={s.paceUnit}
          />
        </div>
      </div>

      <div className="rd-row">
        <span className="rd-label">{speed ? "Speed Unit" : "Pace Unit"}</span>
        <select
          className="rd-select"
          value={s.paceUnit}
          onChange={(e) => onChange({ paceUnit: e.target.value as PaceUnit })}
        >
          {UNITS_FOR_SPORT[s.sport].map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      <Slider
        icon={<PaceIcon size={ICON} />}
        label={`Average ${speed ? "Speed" : "Pace"} (${s.paceUnit})`}
        valueText={`${formatPaceValue(s.paceSecPerKm, s.paceUnit)} ${s.paceUnit}`}
        min={range.min}
        max={range.max}
        step={range.step}
        value={Math.min(Math.max(unitValue, range.min), range.max)}
        onChange={(v) => onChange({ paceSecPerKm: fromUnitValue(v, s.paceUnit) })}
      />

      <Slider
        icon={<Hexagon size={ICON} />}
        label={`${speed ? "Speed" : "Pace"} Inconsistency`}
        valueText={`${s.paceVariabilityPct}%`}
        min={0}
        max={50}
        step={1}
        value={s.paceVariabilityPct}
        onChange={(v) => onChange({ paceVariabilityPct: v })}
        hint={paceVariabilityLabel(s.paceVariabilityPct)}
      />

      <div className="rd-row">
        <span className="rd-label">Include Heart Rate Data</span>
        <Switch
          checked={s.hrEnabled}
          onChange={(hrEnabled) => onChange({ hrEnabled })}
          label="Include heart rate data"
        />
      </div>

      {s.hrEnabled && (
        <>
          <Slider
            icon={<Heart size={ICON} />}
            label="Average Heart Rate"
            valueText={`${s.hrAvgBpm} bpm`}
            min={80}
            max={200}
            step={1}
            value={s.hrAvgBpm}
            onChange={(v) => onChange({ hrAvgBpm: v })}
            hint={heartRateLabel(s.hrAvgBpm)}
          />
          <Slider
            icon={<Activity size={ICON} />}
            label="Heart Rate Variability"
            valueText={`${s.hrVariabilityPct}%`}
            min={0}
            max={30}
            step={1}
            value={s.hrVariabilityPct}
            onChange={(v) => onChange({ hrVariabilityPct: v })}
            hint={hrVariabilityLabel(s.hrVariabilityPct)}
          />
        </>
      )}

      <label className="rd-field">
        <span className="rd-label">{word} Name</span>
        <input
          className="rd-input"
          type="text"
          value={s.name}
          maxLength={200}
          placeholder={defaultActivityName(s.sport, s.hour)}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>

      <label className="rd-field">
        <span className="rd-label">Date</span>
        <div className="rd-input rd-input--icon">
          <Calendar size={ICON} />
          <input
            type="date"
            value={s.date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
        </div>
      </label>

      <div className="rd-field">
        <span className="rd-label">Start Time</span>
        <div className="time-row">
          <Clock size={ICON} className="muted-icon" />
          <select
            className="rd-select"
            aria-label="Start hour"
            value={s.hour}
            onChange={(e) => onChange({ hour: Number(e.target.value) })}
          >
            {range24().map((h) => (
              <option key={h} value={h}>{pad2(h)}</option>
            ))}
          </select>
          <span className="time-sep">:</span>
          <select
            className="rd-select"
            aria-label="Start minute"
            value={s.minute}
            onChange={(e) => onChange({ minute: Number(e.target.value) })}
          >
            {range60().map((m) => (
              <option key={m} value={m}>{pad2(m)}</option>
            ))}
          </select>
        </div>
      </div>

      <label className="rd-field">
        <span className="rd-label">Description</span>
        <textarea
          className="rd-input"
          rows={3}
          maxLength={2000}
          placeholder={`How did the ${word.toLowerCase()} go?`}
          value={s.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>

      <div className="action-row">
        <button onClick={onDownload} disabled={busy}>
          {downloading ? "Generating…" : "Download GPX"}
        </button>
        <button className="secondary" onClick={onClear} disabled={busy}>
          Clear
        </button>
      </div>
      {downloading && (
        <p className="rd-hint">Looking up elevation for the route. Long routes can take up to ~30 seconds.</p>
      )}
    </section>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-icon">{icon}</span>
      <strong>{value}</strong>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function Slider(props: {
  icon: ReactNode;
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <div className="rd-slider">
      <div className="rd-slider-head">
        <span className="rd-slider-label">
          <span className="accent-icon">{props.icon}</span>
          {props.label}
        </span>
        <span className="rd-slider-value">{props.valueText}</span>
      </div>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.hint && <p className="rd-hint">{props.hint}</p>}
    </div>
  );
}

function Switch({
  checked, onChange, label, neutral = false,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; neutral?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? " on" : ""}${neutral ? " neutral" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

const pad2 = (n: number) => n.toString().padStart(2, "0");
const range24 = () => Array.from({ length: 24 }, (_, i) => i);
const range60 = () => Array.from({ length: 60 }, (_, i) => i);
