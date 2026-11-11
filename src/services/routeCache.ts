import type { LngLat, MatchedPoint } from "../domain/types";

// Short-lived in-memory cache of snapped routes, so one activity costs one Mapbox call
// instead of three (snap preview, elevation stats and GPX download all ask for the
// same route). Size is bounded by the total number of cached points, and entries
// expire after a while.

const TTL_MS = 30 * 60_000;
const MAX_TOTAL_POINTS = 1_000_000; // roughly 50–80 MB at most

type Entry = { route: MatchedPoint[]; expires: number };
const cache = new Map<string, Entry>(); // Map keeps insertion order -> oldest first
const inflight = new Map<string, Promise<MatchedPoint[]>>();
let totalPoints = 0;

export const routeCacheStats = { hits: 0, misses: 0 };

export function routeKey(points: LngLat[], profile: string, preferMatch?: boolean): string {
  const pts = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  return `${profile}|${preferMatch ? 1 : 0}|${pts}`;
}

export async function cachedRoute(key: string, fetch: () => Promise<MatchedPoint[]>): Promise<MatchedPoint[]> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    // move to the end (most recently used)
    cache.delete(key);
    cache.set(key, hit);
    routeCacheStats.hits++;
    return hit.route;
  }
  if (hit) remove(key);

  // Same route requested twice at the same moment: share one Mapbox call
  const pending = inflight.get(key);
  if (pending) {
    routeCacheStats.hits++;
    return pending;
  }

  routeCacheStats.misses++;
  const p = fetch()
    .then((route) => {
      store(key, route);
      return route;
    })
    .finally(() => inflight.delete(key)); // errors are not cached
  inflight.set(key, p);
  return p;
}

function store(key: string, route: MatchedPoint[]) {
  if (route.length > MAX_TOTAL_POINTS) return;
  cache.set(key, { route, expires: Date.now() + TTL_MS });
  totalPoints += route.length;
  // evict least recently used until under the size budget
  for (const k of cache.keys()) {
    if (totalPoints <= MAX_TOTAL_POINTS) break;
    remove(k);
  }
}

function remove(key: string) {
  const e = cache.get(key);
  if (!e) return;
  totalPoints -= e.route.length;
  cache.delete(key);
}
