import { MatchedPoint } from "../domain/types";

function clamp(n: number, min: number, max: number){ return Math.max(min, Math.min(max, n)); }

// Returnerer ny liste med timeISO på hvert punkt
export function generateTimestamps(opts: {
  points: MatchedPoint[];
  paceSecPerKm: number;    // f.eks. 300 = 5:00/km
  startTimeISO: string;    // starttid
  jitterSecondsPerKm?: number; // variasjon per km (±)
  addPauses?: boolean;
  pauseEveryKm?: number;
  pauseSeconds?: number;
}): MatchedPoint[] {
  const {
    points, paceSecPerKm, startTimeISO,
    jitterSecondsPerKm = 0,
    addPauses = false,
    pauseEveryKm = 0,
    pauseSeconds = 0
  } = opts;

  const speedMps = 1000 / paceSecPerKm; // m/s
  // exact elapsed time in ms; rounding per segment would add up to a slower pace
  let lastMs = new Date(startTimeISO).getTime();

  let lastKmMarker = 0; // for pauser hver X km

  const out = points.map((p, i) => {
    if (i === 0) {
      return { ...p, timeISO: new Date(lastMs).toISOString() };
    }

    const prev = points[i-1];
    const segDist = (p.distanceOnRouteM! - (prev.distanceOnRouteM!)); // i meter
    const idealSec = segDist / speedMps;

    // Jitter: skaler jevnt med distansen i km
    const kmHere = (p.distanceOnRouteM! / 1000);
    const jitter = (jitterSecondsPerKm > 0)
      ? (Math.sin(kmHere * 2 * Math.PI / 1.5) * (jitterSecondsPerKm/2)) // myk variasjon
      : 0;

    const segSec = clamp(idealSec + (jitter * (segDist/1000)), Math.max(idealSec*0.5, 0), idealSec*1.5);

    lastMs += segSec * 1000;

    // Pause?
    if (addPauses && pauseEveryKm > 0) {
      const crossed = Math.floor(kmHere / pauseEveryKm);
      if (crossed > Math.floor(lastKmMarker / pauseEveryKm)) {
        lastMs += pauseSeconds * 1000;
      }
      lastKmMarker = kmHere;
    }

    return { ...p, timeISO: new Date(Math.round(lastMs)).toISOString() };
  });

  return out;
}