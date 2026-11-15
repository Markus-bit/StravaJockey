import { logger } from "../logger";

// Our own usage counters: how many times something happened per day, nothing else
// (no IP addresses, cookies or visitor IDs). Stored in Upstash Redis through its REST API,
// one hash per day ("stats:2026-11-15") with a field per counter.
// Vercel's Upstash integration sets KV_REST_API_URL / KV_REST_API_TOKEN; Upstash's own
// names work too. Without them, counting is switched off and nothing breaks.
//
// Field names:
//   <event>                  e.g. "download_success"          (every event)
//   device:<d>, source:<s>, country:<CC>, hour_visit:<HH>      (visits)
//   sport:<s>, dist:<bucket>, pace_run:<bucket>, speed_bike:<bucket>, hr:<on|off>,
//   hour_download:<HH>, dl_country:<CC>                         (GPX files made, counted by the server)

export const EVENTS = [
  "visit",               // site opened (once per browser tab)
  "snap_click",          // "Snap to road" clicked
  "snap_success",
  "snap_error",
  "download_click",      // "Download GPX" clicked
  "download_success",    // file handed to the browser
  "download_error",
  "gpx_generated",       // counted by the server itself: works even when the browser blocks counting
  "help_how_it_works",
  "help_how_to_upload",
  "help_terms",
] as const;
export type StatsEvent = (typeof EVENTS)[number];

export const DEVICES = ["mobile", "tablet", "desktop"] as const;
export const SOURCES = [
  "direct", "google", "bing", "duckduckgo", "yahoo", "chatgpt", "facebook", "instagram",
  "reddit", "x", "youtube", "linkedin", "strava", "github", "other",
] as const;

// Bucket edges (lower bounds). Labels are "<lo>-<hi>" or "<lo>+".
export const DIST_EDGES_KM = [0, 5, 10, 15, 21, 30, 42, 60, 100];
export const RUN_PACE_EDGES_MIN = [0, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8]; // min/km
export const BIKE_SPEED_EDGES_KMH = [0, 15, 20, 25, 30, 35, 40];

export function bucket(value: number, edges: number[]): string {
  let i = 0;
  while (i + 1 < edges.length && value >= edges[i + 1]) i++;
  return i + 1 < edges.length ? `${edges[i]}-${edges[i + 1]}` : `${edges[i]}+`;
}

const TIMEOUT_MS = 2000;
const FIELD_RE = /^[a-z_]+(:[A-Za-z0-9.+-]{1,20})?$/;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function statsEnabled() {
  return redisConfig() !== null;
}

export function statsTimeZone() {
  return process.env.STATS_TIMEZONE || "Europe/Oslo";
}

// Days are counted in this time zone (default: Norway)
export function dayKey(date: Date, timeZone = statsTimeZone()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function hourOf(date: Date, timeZone = statsTimeZone()): string {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date);
  return h.padStart(2, "0");
}

// Two-letter country code from the hosting platform (Vercel sets x-vercel-ip-country).
// Only the country is kept, never the IP address.
export function countryFrom(header: string | string[] | undefined): string | null {
  const v = Array.isArray(header) ? header[0] : header;
  return v && /^[A-Z]{2}$/.test(v) ? v : null;
}

async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const cfg = redisConfig();
  if (!cfg) throw new Error("Stats storage is not configured");
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Upstash answered ${res.status}`);
  const out = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = out.find((r) => r.error);
  if (failed) throw new Error(`Upstash error: ${failed.error}`);
  return out.map((r) => r.result);
}

// Adds 1 to the event and to each extra field, for today. Never throws: counting must not
// break the site.
export async function countEvent(name: StatsEvent, extra: string[] = [], now = new Date()): Promise<void> {
  if (!statsEnabled()) return;
  const key = `stats:${dayKey(now)}`;
  const fields = [name, ...extra].filter((f) => FIELD_RE.test(f));
  try {
    await pipeline(fields.map((f) => ["HINCRBY", key, f, 1]));
  } catch (e) {
    logger.warn({ err: (e as Error)?.message, event: name }, "Could not count event");
  }
}

// Fields counted with a GPX file the server has just made
export function gpxFields(o: {
  sport: "run" | "bike";
  distanceKm: number;
  paceSecPerKm: number;
  heartRate: boolean;
  country: string | null;
  now?: Date;
}): string[] {
  const f = [
    `sport:${o.sport}`,
    `dist:${bucket(o.distanceKm, DIST_EDGES_KM)}`,
    `hr:${o.heartRate ? "on" : "off"}`,
    `hour_download:${hourOf(o.now ?? new Date())}`,
  ];
  if (o.sport === "run") f.push(`pace_run:${bucket(o.paceSecPerKm / 60, RUN_PACE_EDGES_MIN)}`);
  else f.push(`speed_bike:${bucket(3600 / o.paceSecPerKm, BIKE_SPEED_EDGES_KMH)}`);
  if (o.country) f.push(`dl_country:${o.country}`);
  return f;
}

export type DayCounts = { day: string; counts: Record<string, number> };

// All counters for the last `days` days, newest first
export async function readStats(days: number, now = new Date()): Promise<DayCounts[]> {
  const dayList: string[] = [];
  // step back in 24 h steps from midday so DST changes can't skip or repeat a date
  const noon = new Date(`${dayKey(now)}T12:00:00Z`).getTime();
  for (let i = 0; i < days; i++) dayList.push(dayKey(new Date(noon - i * 86_400_000), "UTC"));
  const results = await pipeline(dayList.map((d) => ["HGETALL", `stats:${d}`]));
  return dayList.map((day, i) => {
    // HGETALL over REST returns a flat list: [field, value, field, value, ...]
    const flat = (results[i] as string[] | null) ?? [];
    const counts: Record<string, number> = {};
    for (let j = 0; j + 1 < flat.length; j += 2) {
      if (FIELD_RE.test(flat[j])) counts[flat[j]] = Number(flat[j + 1]) || 0;
    }
    return { day, counts };
  });
}
