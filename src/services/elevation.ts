import axios from "axios";
import { MatchedPoint } from "../domain/types";
import { logger } from "../logger";

// Public OpenTopoData API limits: max 100 locations per request, max 1 request/second.
const BATCH_SIZE = 100;
const MIN_INTERVAL_MS = 1100;

// Simple sleep helper
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Chunk helper
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// In-memory cache so "snap" followed by "download" doesn't look up the same points twice
const cache = new Map<string, number | null>();
const CACHE_MAX = 200_000;
const key = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

export async function enrichElevation(
  points: MatchedPoint[],
  opts?: { provider?: "none" | "opentopodata" }
): Promise<MatchedPoint[]> {
  const provider = (opts?.provider || process.env.ELEVATION_PROVIDER || "opentopodata").toLowerCase();

  if (provider === "none") {
    // Skip elevation entirely
    return points.map(p => ({ ...p, elevationM: null }));
  }
  if (provider !== "opentopodata") {
    throw new Error(`Unknown elevation provider "${provider}" (supported: opentopodata, none)`);
  }
  return elevationOpenTopo(points);
}

// Total climb in metres. The 25 m elevation model is noisy, so smooth before summing
// (otherwise flat routes show lots of fake climbing).
export function elevationGain(points: MatchedPoint[], window = 5): number | null {
  const ele = points.map(p => p.elevationM);
  if (ele.length === 0 || ele.some(e => typeof e !== "number")) return null;
  const vals = ele as number[];
  const half = Math.floor(window / 2);
  const smooth = vals.map((_, i) => {
    const from = Math.max(0, i - half), to = Math.min(vals.length, i + half + 1);
    let s = 0;
    for (let j = from; j < to; j++) s += vals[j];
    return s / (to - from);
  });
  let gain = 0;
  for (let i = 1; i < smooth.length; i++) gain += Math.max(0, smooth[i] - smooth[i - 1]);
  return gain;
}

// Exponential backoff for OpenTopoData (handles 429/503)
async function getOpenTopoBatch(locations: string, attempt = 1): Promise<any> {
  try {
    const url = `https://api.opentopodata.org/v1/eudem25m?locations=${locations}`;
    return await axios.get(url, { timeout: 15000 });
  } catch (err: any) {
    const status = err?.response?.status;
    if ((status === 429 || status === 503) && attempt < 6) {
      const waitMs = 1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
      logger.warn({ attempt, waitMs, status }, "OpenTopoData rate limited – backing off");
      await sleep(waitMs);
      return getOpenTopoBatch(locations, attempt + 1);
    }
    throw err;
  }
}

async function elevationOpenTopo(points: MatchedPoint[]): Promise<MatchedPoint[]> {
  const missing = [...new Set(points.map(key))].filter(k => !cache.has(k));

  let first = true;
  for (const group of chunk(missing, BATCH_SIZE)) {
    if (!first) await sleep(MIN_INTERVAL_MS);
    first = false;

    const res = await getOpenTopoBatch(group.join("|"));
    const results = res.data?.results || [];
    if (cache.size + group.length > CACHE_MAX) cache.clear();
    group.forEach((k, i) => {
      const e = results[i]?.elevation;
      cache.set(k, typeof e === "number" ? e : null);
    });
  }

  return points.map(p => ({ ...p, elevationM: cache.get(key(p)) ?? null }));
}
