import { MatchedPoint } from "../domain/types";
import { smoothNoise } from "./noise";

// Legger på pulsdata (heartRateBpm) basert på tid og fart på hvert punkt.
// Krever at timeISO og distanceOnRouteM er satt.
export function generateHeartRate(opts: {
  points: MatchedPoint[];
  avgBpm: number;          // ønsket snittpuls
  variability?: number;    // 0–0.3: hvor mye pulsen svinger (0.1 = ±10 %)
  rand?: () => number;     // for tester
}): MatchedPoint[] {
  const { points, avgBpm, rand = Math.random } = opts;
  if (points.length === 0) return [];
  const variability = Math.min(Math.max(opts.variability ?? 0, 0), 0.3);

  const t0 = Date.parse(points[0].timeISO!);
  const tSec = points.map(p => (Date.parse(p.timeISO!) - t0) / 1000);
  const totalSec = Math.max(tSec[tSec.length - 1], 1);
  const totalDist = points[points.length - 1].distanceOnRouteM || 0;
  const avgSpeed = totalDist / totalSec;

  // Svingninger over ~10, 4 og 1.5 minutter
  const noise = smoothNoise([600, 240, 90], rand);

  // Pulsen følger innsatsen med forsinkelse: glatt farten med en EMA (~30 s)
  let effort = 1;
  const raw = points.map((p, i) => {
    if (i > 0) {
      const dt = Math.max(tSec[i] - tSec[i - 1], 0.001);
      const speed = (p.distanceOnRouteM! - points[i - 1].distanceOnRouteM!) / dt;
      const ratio = avgSpeed > 0 ? speed / avgSpeed : 1;
      const alpha = 1 - Math.exp(-dt / 30);
      effort += alpha * (ratio - effort);
    }
    const t = tSec[i];
    const warmup = 1 - 0.25 * Math.exp(-t / 120);   // starter ~25 % lavere, flater ut etter noen min
    const drift = 1 + 0.04 * (t / totalSec);        // "cardiac drift" utover økta
    const fromEffort = 1 + 0.6 * (effort - 1);      // raskere -> høyere puls
    const wobble = 1 + variability * noise(t);
    return warmup * drift * fromEffort * wobble;
  });

  // Skaler slik at tidsvektet snitt blir avgBpm (slik Strava regner snittpuls)
  let sum = 0;
  for (let i = 1; i < raw.length; i++) sum += ((raw[i] + raw[i - 1]) / 2) * (tSec[i] - tSec[i - 1]);
  const mean = raw.length > 1 && sum > 0 ? sum / totalSec : raw[0];
  const scale = avgBpm / mean;

  return points.map((p, i) => ({
    ...p,
    heartRateBpm: Math.round(Math.min(Math.max(raw[i] * scale, 45), 220))
  }));
}
