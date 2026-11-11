import type { MatchedPoint } from "../domain/types";
import { generateTimestamps } from "./pace";
import { generateHeartRate } from "./heartrate";
import { heartRateRandom, paceRandom } from "./noise";

// Chart series for the UI, built with the same generators (and seed) as the GPX.
// Pace and heart rate only depend on distance along the route, so a uniform
// grid of points is enough; no map or elevation lookups needed.

const MAX_BUCKETS = 300;

export function activityPreview(opts: {
  distanceM: number;
  paceSecPerKm: number;
  paceVariability: number;
  heartRate?: { avgBpm: number; variability: number };
  seed?: number;
}) {
  const { distanceM } = opts;
  const spacing = Math.max(25, distanceM / 20000); // ≤ ~20k points even for very long routes
  const n = Math.max(2, Math.ceil(distanceM / spacing) + 1);
  const points: MatchedPoint[] = Array.from({ length: n }, (_, i) => ({
    lat: 0, lng: 0, distanceOnRouteM: Math.min(i * spacing, distanceM)
  }));

  const timed = generateTimestamps({
    points,
    paceSecPerKm: opts.paceSecPerKm,
    paceVariability: opts.paceVariability,
    startTimeISO: "2000-01-01T00:00:00.000Z",
    rand: paceRandom(opts.seed)
  });
  const withHr = opts.heartRate
    ? generateHeartRate({
        points: timed,
        avgBpm: opts.heartRate.avgBpm,
        variability: opts.heartRate.variability,
        rand: heartRateRandom(opts.seed)
      })
    : timed;

  // Average into ≤ MAX_BUCKETS distance buckets (like a watch's per-segment pace)
  const t = withHr.map(p => Date.parse(p.timeISO!) / 1000);
  const buckets = Math.min(MAX_BUCKETS, n - 1);
  const distM: number[] = [], paceSecPerKm: number[] = [], heartRateBpm: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * (n - 1)) / buckets), to = Math.floor(((b + 1) * (n - 1)) / buckets);
    const d0 = withHr[from].distanceOnRouteM!, d1 = withHr[to].distanceOnRouteM!;
    const dt = t[to] - t[from];
    distM.push((d0 + d1) / 2);
    paceSecPerKm.push(d1 > d0 ? dt / ((d1 - d0) / 1000) : opts.paceSecPerKm);
    if (opts.heartRate) {
      let s = 0;
      for (let i = from + 1; i <= to; i++) {
        s += ((withHr[i].heartRateBpm! + withHr[i - 1].heartRateBpm!) / 2) * (t[i] - t[i - 1]);
      }
      heartRateBpm.push(dt > 0 ? s / dt : withHr[from].heartRateBpm!);
    }
  }

  const hr = withHr.map(p => p.heartRateBpm).filter((v): v is number => typeof v === "number");
  return {
    distM,
    paceSecPerKm,
    heartRateBpm: opts.heartRate ? heartRateBpm : null,
    totalTimeSec: t[t.length - 1] - t[0],
    maxHeartRateBpm: hr.length ? Math.max(...hr) : null
  };
}

// Downsample an elevation track to ≤ maxPoints evenly spaced by distance
export function elevationProfile(points: MatchedPoint[], dists: number[], maxPoints = 300) {
  const total = dists[dists.length - 1] || 0;
  const distM: number[] = [], elevationM: (number | null)[] = [];
  if (points.length === 0) return { distM, elevationM };
  const count = Math.min(maxPoints, points.length);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const d = count === 1 ? 0 : (k * total) / (count - 1);
    while (j < points.length - 1 && dists[j + 1] <= d) j++;
    distM.push(d);
    const e = points[j].elevationM;
    elevationM.push(typeof e === "number" ? Math.round(e * 10) / 10 : null);
  }
  return { distM, elevationM };
}
