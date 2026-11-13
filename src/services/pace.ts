import { MatchedPoint } from "../domain/types";
import { smoothNoise } from "./noise";

// Returns a new list with timeISO on every point
export function generateTimestamps(opts: {
  points: MatchedPoint[];
  paceSecPerKm: number;       // e.g. 300 = 5:00/km (average for the whole activity)
  startTimeISO: string;       // start time
  paceVariability?: number;   // 0–0.5: how much the pace varies around the average (0.2 = ±20 %)
  addPauses?: boolean;
  pauseEveryKm?: number;
  pauseSeconds?: number;
  rand?: () => number;        // for tests / seeded output
}): MatchedPoint[] {
  const {
    points, paceSecPerKm, startTimeISO,
    paceVariability = 0,
    addPauses = false,
    pauseEveryKm = 0,
    pauseSeconds = 0,
    rand = Math.random
  } = opts;
  if (points.length === 0) return [];

  const variability = Math.min(Math.max(paceVariability, 0), 0.5);
  // Pace waves over ~0.4, 1.2 and 3 km
  const noise = smoothNoise([3000, 1200, 400], rand);

  // 1) relative time per segment (factor > 1 = slower)
  const segFactors: number[] = [0];
  let weighted = 0;
  let totalDist = 0;
  for (let i = 1; i < points.length; i++) {
    const segDist = points[i].distanceOnRouteM! - points[i - 1].distanceOnRouteM!;
    const mid = (points[i].distanceOnRouteM! + points[i - 1].distanceOnRouteM!) / 2;
    const factor = Math.max(0.5, 1 + variability * noise(mid));
    segFactors.push(factor);
    weighted += segDist * factor;
    totalDist += segDist;
  }
  // 2) normalise so the average pace is exactly paceSecPerKm
  const norm = weighted > 0 ? totalDist / weighted : 1;

  // exact elapsed time in ms; rounding per segment would add up to a different pace
  let lastMs = new Date(startTimeISO).getTime();
  let lastKmMarker = 0; // for pauses every X km

  return points.map((p, i) => {
    if (i === 0) return { ...p, timeISO: new Date(lastMs).toISOString() };

    const segDist = p.distanceOnRouteM! - points[i - 1].distanceOnRouteM!;
    lastMs += (segDist / 1000) * paceSecPerKm * segFactors[i] * norm * 1000;

    // Pause?
    const kmHere = p.distanceOnRouteM! / 1000;
    if (addPauses && pauseEveryKm > 0) {
      if (Math.floor(kmHere / pauseEveryKm) > Math.floor(lastKmMarker / pauseEveryKm)) {
        lastMs += pauseSeconds * 1000;
      }
      lastKmMarker = kmHere;
    }

    return { ...p, timeISO: new Date(Math.round(lastMs)).toISOString() };
  });
}
