import axios from "axios";
import { MatchedPoint } from "../domain/types";
import { logger } from "../logger";
import { accumulateDistances } from "../domain/geo";
import { HttpError } from "../errors";
import { lookupMapboxTerrain } from "./mapboxTerrain";

type ElevationSource = "mapbox" | "opentopodata";

// Which source to use. Mapbox terrain tiles by default (fast, worldwide, uses the server's
// MAPBOX_TOKEN); OpenTopoData is the automatic fallback if Mapbox fails.
// Set ELEVATION_SOURCE=opentopodata to use only OpenTopoData.
function primarySource(): ElevationSource {
  return process.env.ELEVATION_SOURCE === "opentopodata" || !process.env.MAPBOX_TOKEN ? "opentopodata" : "mapbox";
}

if (process.env.ELEVATION_PROVIDER) {
  logger.warn("ELEVATION_PROVIDER in .env is no longer used and can be removed");
}

// ---- OpenTopoData (fallback). Public API limits: max 100 locations per request,
// max 1 request/second, ~1000 requests per day.
const BATCH_SIZE = 100;
const MIN_INTERVAL_MS = 1100;
// Elevation is sampled along the route at most this many times, then interpolated for
// every GPS point. Short routes keep one sample per 25 m.
const MAX_SAMPLES = 2000;
const MIN_SAMPLE_SPACING_M = 25;

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
  opts?: { provider?: "none" | "auto" | ElevationSource }
): Promise<MatchedPoint[]> {
  const provider = opts?.provider ?? "auto";
  if (provider === "none") {
    // Skip elevation entirely
    return points.map(p => ({ ...p, elevationM: null }));
  }
  const source = provider === "auto" ? primarySource() : provider;
  return elevationAlongRoute(points, (samples) => lookupWithFallback(samples, source));
}

// Mapbox first; if it fails (bad token, network, outage) fall back to OpenTopoData
async function lookupWithFallback(samples: { lat: number; lng: number }[], source: ElevationSource) {
  if (source === "mapbox") {
    try {
      return await lookupMapboxTerrain(samples, process.env.MAPBOX_TOKEN!);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      logger.warn(
        { status, err: (e as Error)?.message,
          hint: status === 401 || status === 403
            ? "Mapbox rejected the token for terrain tiles: check that MAPBOX_TOKEN has no URL restrictions"
            : undefined },
        "Mapbox terrain lookup failed, falling back to OpenTopoData"
      );
    }
  }
  return lookup(samples);
}

// Total climb in metres. Elevation data is noisy, so (1) smooth it over a fixed distance
// and (2) only count a climb once it has risen at least `thresholdM` above the last low
// point (hysteresis). Without this, small up-and-down wiggles add up to lots of fake
// climbing. Points without data (e.g. over water) are skipped.
// Tuned so a real route came out ~6-7 % below the old method, in line with the one
// comparison with Strava's number we had. Strava's own method isn't public.
const GAIN_SMOOTHING_M = 100;
const GAIN_THRESHOLD_M = 1;

export function elevationGain(
  points: MatchedPoint[],
  opts: { smoothingM?: number; thresholdM?: number } = {}
): number | null {
  const smoothingM = opts.smoothingM ?? GAIN_SMOOTHING_M;
  const thresholdM = opts.thresholdM ?? GAIN_THRESHOLD_M;

  const allDists = points.every(p => typeof p.distanceOnRouteM === "number")
    ? points.map(p => p.distanceOnRouteM!)
    : accumulateDistances(points);
  const d: number[] = [], e: number[] = [];
  points.forEach((p, i) => {
    if (typeof p.elevationM === "number") { d.push(allDists[i]); e.push(p.elevationM); }
  });
  if (e.length < 2) return null;

  // 1) moving average over ±smoothingM/2 along the route (two pointers, O(n))
  const half = smoothingM / 2;
  const smooth: number[] = [];
  let from = 0, to = 0, sum = 0;
  for (let i = 0; i < e.length; i++) {
    while (to < e.length && d[to] <= d[i] + half) sum += e[to++];
    while (d[from] < d[i] - half) sum -= e[from++];
    smooth.push(sum / (to - from));
  }

  // 2) count rises of at least thresholdM from the lowest point since the last counted climb
  let gain = 0;
  let base = smooth[0];
  for (const v of smooth) {
    if (v - base >= thresholdM) { gain += v - base; base = v; }
    else if (v < base) base = v;
  }
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
    if (status === 429) {
      throw new HttpError(503, "Elevation lookups have hit the daily limit. Try again later.");
    }
    if (!err?.response) throw new HttpError(502, "The elevation service can't be reached right now.", err?.code);
    throw new HttpError(502, "The elevation service returned an error. Try again later.", { status });
  }
}

// ---- Request queue shared by all callers, so concurrent lookups (route stats + GPX
// download) never exceed the rate limit or fetch the same location twice.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
const inflight = new Map<string, Promise<void>>();

function scheduleBatch(keys: string[], abort: { failed: boolean }): Promise<void> {
  const run = async () => {
    if (abort.failed) throw new Error("Elevation lookup aborted after an earlier failure");
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const res = await getOpenTopoBatch(keys.join("|"));
      const results = res.data?.results || [];
      if (cache.size + keys.length > CACHE_MAX) cache.clear();
      keys.forEach((k, i) => {
        const e = results[i]?.elevation;
        cache.set(k, typeof e === "number" ? e : null);
      });
    } catch (e) {
      abort.failed = true;
      throw e;
    } finally {
      lastRequestAt = Date.now();
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

async function lookup(locations: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const keys = locations.map(key);
  const waitFor = new Set<Promise<void>>();
  const missing: string[] = [];
  for (const k of new Set(keys)) {
    if (cache.has(k)) continue;
    const pending = inflight.get(k);
    if (pending) waitFor.add(pending);
    else missing.push(k);
  }

  const groups = chunk(missing, BATCH_SIZE);
  if (groups.length > 1) logger.info({ requests: groups.length }, "Looking up elevation");
  const abort = { failed: false };
  for (const group of groups) {
    const p = scheduleBatch(group, abort);
    group.forEach(k => inflight.set(k, p));
    p.catch(() => {}).finally(() => group.forEach(k => { if (inflight.get(k) === p) inflight.delete(k); }));
    waitFor.add(p);
  }
  await Promise.all(waitFor);
  return keys.map(k => cache.get(k) ?? null);
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// Sample the route evenly, look the samples up, fill gaps, then interpolate every point
async function elevationAlongRoute(
  points: MatchedPoint[],
  lookupSamples: (samples: { lat: number; lng: number }[]) => Promise<(number | null)[]>
): Promise<MatchedPoint[]> {
  if (points.length === 0) return [];
  const dists = points.every(p => typeof p.distanceOnRouteM === "number")
    ? points.map(p => p.distanceOnRouteM!)
    : accumulateDistances(points);
  const total = dists[dists.length - 1];

  // 1) sample positions evenly along the route
  const spacing = Math.max(MIN_SAMPLE_SPACING_M, total / (MAX_SAMPLES - 1));
  const samples: { d: number; lat: number; lng: number }[] = [];
  let seg = 0;
  for (let k = 0; ; k++) {
    const d = Math.min(k * spacing, total);
    while (seg < points.length - 2 && dists[seg + 1] < d) seg++;
    const a = points[seg], b = points[seg + 1] ?? a;
    const len = (dists[seg + 1] ?? dists[seg]) - dists[seg];
    const t = len > 0 ? Math.min(Math.max((d - dists[seg]) / len, 0), 1) : 0;
    samples.push({ d, lat: lerp(a.lat, b.lat, t), lng: lerp(a.lng, b.lng, t) });
    if (d >= total) break;
  }

  // 2) look them up, and fill gaps (points with no data, e.g. lakes/fjords) from neighbours
  const raw = await lookupSamples(samples);
  const missing = raw.filter(v => v === null).length;
  logger.info({ samples: raw.length, withoutData: missing }, "Elevation lookup done");
  const values = fillGaps(raw);

  // 3) interpolate an elevation for every point by its distance along the route
  let j = 0;
  return points.map((p, i) => {
    const d = dists[i];
    while (j < samples.length - 2 && samples[j + 1].d < d) j++;
    const s0 = samples[j], s1 = samples[j + 1] ?? s0;
    const v0 = values[j], v1 = values[j + 1] ?? v0;
    let elevationM: number | null;
    if (v0 === null || v1 === null) elevationM = v0 ?? v1 ?? null;
    else {
      const span = s1.d - s0.d;
      elevationM = span > 0 ? lerp(v0, v1, Math.min(Math.max((d - s0.d) / span, 0), 1)) : v0;
    }
    return { ...p, elevationM };
  });
}

// Linear interpolation over null entries; leading/trailing gaps copy the nearest value.
// Stays all-null if there is no data at all.
function fillGaps(values: (number | null)[]): (number | null)[] {
  const out = [...values];
  const known = out.flatMap((v, i) => (v === null ? [] : [i]));
  if (known.length === 0 || known.length === out.length) return out;
  for (let i = 0; i < known[0]; i++) out[i] = out[known[0]];
  for (let i = known[known.length - 1] + 1; i < out.length; i++) out[i] = out[known[known.length - 1]];
  for (let k = 1; k < known.length; k++) {
    const a = known[k - 1], b = known[k];
    for (let i = a + 1; i < b; i++) out[i] = lerp(out[a]!, out[b]!, (i - a) / (b - a));
  }
  return out;
}
