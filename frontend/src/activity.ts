// Settings for the generated activity + unit conversions used by the Run Details panel.

export type Sport = "run" | "bike";
export type PaceUnit = "min/km" | "min/mi" | "km/h" | "mph";

export interface ActivitySettings {
  sport: Sport;
  paceUnit: PaceUnit;
  paceSecPerKm: number;        // canonical pace, whatever unit is displayed
  paceVariabilityPct: number;  // 0–50
  hrEnabled: boolean;
  hrAvgBpm: number;
  hrVariabilityPct: number;    // 0–30
  name: string;
  date: string;                // yyyy-MM-dd (local)
  hour: number;
  minute: number;
}

const KM_PER_MI = 1.609344;

export const UNITS_FOR_SPORT: Record<Sport, PaceUnit[]> = {
  run: ["min/km", "min/mi"],
  bike: ["km/h", "mph"],
};

// Slider range per unit, in the unit's own numbers
export const SLIDER_RANGE: Record<PaceUnit, { min: number; max: number; step: number }> = {
  "min/km": { min: 2.5, max: 12, step: 0.05 },
  "min/mi": { min: 4, max: 19, step: 0.05 },
  "km/h": { min: 10, max: 45, step: 0.5 },
  "mph": { min: 6, max: 28, step: 0.5 },
};

export const DEFAULT_PACE: Record<Sport, number> = {
  run: 330,          // 5:30 min/km
  bike: 3600 / 25,   // 25 km/h
};

export function isSpeedUnit(u: PaceUnit) {
  return u === "km/h" || u === "mph";
}

export function usesMiles(u: PaceUnit) {
  return u === "min/mi" || u === "mph";
}

export function toUnitValue(secPerKm: number, unit: PaceUnit): number {
  switch (unit) {
    case "min/km": return secPerKm / 60;
    case "min/mi": return (secPerKm * KM_PER_MI) / 60;
    case "km/h": return 3600 / secPerKm;
    case "mph": return 3600 / secPerKm / KM_PER_MI;
  }
}

export function fromUnitValue(value: number, unit: PaceUnit): number {
  switch (unit) {
    case "min/km": return value * 60;
    case "min/mi": return (value * 60) / KM_PER_MI;
    case "km/h": return 3600 / value;
    case "mph": return 3600 / (value * KM_PER_MI);
  }
}

// "5:30" for pace units, "25.0" for speed units
export function formatPaceValue(secPerKm: number, unit: PaceUnit): string {
  const v = toUnitValue(secPerKm, unit);
  if (isSpeedUnit(unit)) return v.toFixed(1);
  let min = Math.floor(v);
  let sec = Math.round((v - min) * 60);
  if (sec === 60) { min += 1; sec = 0; }
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function formatDuration(totalSec: number): string {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Same naming style Strava uses for activities without a name
export function defaultActivityName(sport: Sport, hour: number): string {
  const part = hour < 5 ? "Night" : hour < 12 ? "Morning" : hour < 13 ? "Lunch" : hour < 18 ? "Afternoon" : hour < 22 ? "Evening" : "Night";
  return `${part} ${sport === "run" ? "Run" : "Ride"}`;
}

export function paceVariabilityLabel(pct: number): string {
  if (pct < 5) return "Very steady pace (treadmill-like)";
  if (pct < 15) return "Natural pace variation";
  if (pct < 30) return "Noticeable pace changes (rolling terrain or mixed effort)";
  return "High pace variability (challenging terrain or training)";
}

export function heartRateLabel(bpm: number): string {
  if (bpm < 110) return "Very light, recovery effort";
  if (bpm < 130) return "Light, easy effort";
  if (bpm < 145) return "Moderate, aerobic effort";
  if (bpm < 165) return "High intensity, vigorous effort";
  if (bpm < 180) return "Very hard, threshold effort";
  return "Maximum effort";
}

export function hrVariabilityLabel(pct: number): string {
  if (pct < 5) return "Very steady heart rate";
  if (pct < 15) return "Normal heart rate variation";
  return "High heart rate variability (intervals or challenging terrain)";
}

export function localDateString(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Local date + time -> ISO (UTC) string for the backend
export function startTimeISO(s: ActivitySettings): string {
  const [y, mo, d] = s.date.split("-").map(Number);
  const dt = y ? new Date(y, mo - 1, d, s.hour, s.minute) : new Date();
  return isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

export function initialSettings(): ActivitySettings {
  const now = new Date();
  return {
    sport: "run",
    paceUnit: "min/km",
    paceSecPerKm: DEFAULT_PACE.run,
    paceVariabilityPct: 15,
    hrEnabled: true,
    hrAvgBpm: 150,
    hrVariabilityPct: 10,
    name: "",
    date: localDateString(now),
    hour: now.getHours(),
    minute: now.getMinutes(),
  };
}
