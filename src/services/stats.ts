import { logger } from "../logger";

// Our own usage counters: how many times something happened per day, nothing else
// (no IP addresses, cookies or visitor IDs). Stored in Upstash Redis through its REST API.
// Vercel's Upstash integration sets KV_REST_API_URL / KV_REST_API_TOKEN; Upstash's own
// names work too. Without them, counting is switched off and nothing breaks.

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

const TIMEOUT_MS = 2000;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function statsEnabled() {
  return redisConfig() !== null;
}

// Days are counted in this time zone (default: Norway)
export function dayKey(date: Date, timeZone = process.env.STATS_TIMEZONE || "Europe/Oslo"): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
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

// Never throws: counting must not break the site
export async function countEvent(name: StatsEvent, now = new Date()): Promise<void> {
  if (!statsEnabled()) return;
  try {
    await pipeline([["HINCRBY", `stats:${dayKey(now)}`, name, 1]]);
  } catch (e) {
    logger.warn({ err: (e as Error)?.message, event: name }, "Could not count event");
  }
}

export type DayCounts = { day: string; counts: Partial<Record<StatsEvent, number>> };

// Counts for the last `days` days, newest first
export async function readStats(days: number, now = new Date()): Promise<DayCounts[]> {
  const dayList: string[] = [];
  for (let i = 0; i < days; i++) dayList.push(dayKey(new Date(now.getTime() - i * 86_400_000)));
  const unique = [...new Set(dayList)]; // DST: two dates can't repeat, but be safe
  const results = await pipeline(unique.map((d) => ["HGETALL", `stats:${d}`]));
  return unique.map((day, i) => {
    // HGETALL over REST returns a flat list: [field, value, field, value, ...]
    const flat = (results[i] as string[] | null) ?? [];
    const counts: Partial<Record<StatsEvent, number>> = {};
    for (let j = 0; j + 1 < flat.length; j += 2) {
      if ((EVENTS as readonly string[]).includes(flat[j])) counts[flat[j] as StatsEvent] = Number(flat[j + 1]) || 0;
    }
    return { day, counts };
  });
}
