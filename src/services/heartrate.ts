import { MatchedPoint } from "../domain/types";
import { smoothNoise } from "./noise";

// Adds heart rate (heartRateBpm) to every point, based on time and speed.
// Needs timeISO and distanceOnRouteM on the points.
//
// Model (all factors multiply):
//   warm-up   starts ~25 % lower and levels off over the first few minutes
//   drift     rises slowly, ~4 % by the end (cardiac drift)
//   effort    follows speed changes with a ~30 s delay   } both scale with the
//   wobble    smooth random variation                     } HR variability slider
// At 0 % variability the heart rate is steady apart from warm-up and drift.
// Peaks are compressed smoothly below a ceiling instead of being cut off, and the
// result is scaled so the time-weighted average is exactly avgBpm.

const MIN_BPM = 45;

export function generateHeartRate(opts: {
  points: MatchedPoint[];
  avgBpm: number;          // target average heart rate
  variability?: number;    // 0–0.3: how much the heart rate moves (0.1 = ±10 %)
  rand?: () => number;     // for tests / seeded output
}): MatchedPoint[] {
  const { points, avgBpm, rand = Math.random } = opts;
  if (points.length === 0) return [];
  const variability = Math.min(Math.max(opts.variability ?? 0, 0), 0.3);

  const t0 = Date.parse(points[0].timeISO!);
  const tSec = points.map(p => (Date.parse(p.timeISO!) - t0) / 1000);
  const totalSec = Math.max(tSec[tSec.length - 1], 1);
  const totalDist = points[points.length - 1].distanceOnRouteM || 0;
  const avgSpeed = totalDist / totalSec;

  // Random waves over ~10, 4 and 1.5 minutes
  const noise = smoothNoise([600, 240, 90], rand);
  // How strongly speed changes show up in the heart rate: 0 at 0 %, 0.6 at the 30 % maximum
  const effortCoupling = 0.6 * (variability / 0.3);

  let effort = 1;
  const raw = points.map((p, i) => {
    if (i > 0) {
      const dt = Math.max(tSec[i] - tSec[i - 1], 0.001);
      const speed = (p.distanceOnRouteM! - points[i - 1].distanceOnRouteM!) / dt;
      const ratio = avgSpeed > 0 ? speed / avgSpeed : 1;
      const alpha = 1 - Math.exp(-dt / 30); // heart rate lags behind effort
      effort += alpha * (ratio - effort);
    }
    const t = tSec[i];
    const warmup = 1 - 0.25 * Math.exp(-t / 120);
    const drift = 1 + 0.04 * (t / totalSec);
    const fromEffort = 1 + effortCoupling * (effort - 1);
    const wobble = 1 + variability * noise(t);
    return warmup * drift * fromEffort * wobble;
  });

  // Soft ceiling: values approach `ceiling` but never exceed it
  const ceiling = Math.min(220, Math.max(205, avgBpm + 10));
  const knee = ceiling - 15;
  const soften = (bpm: number) => {
    const capped = bpm <= knee ? bpm : knee + 15 * Math.tanh((bpm - knee) / 15);
    return Math.max(capped, MIN_BPM);
  };

  // Find the scale that makes the time-weighted average exactly avgBpm after softening
  const timeWeightedMean = (vals: number[]) => {
    if (vals.length < 2) return vals[0] ?? 0;
    let sum = 0;
    for (let i = 1; i < vals.length; i++) sum += ((vals[i] + vals[i - 1]) / 2) * (tSec[i] - tSec[i - 1]);
    return sum / totalSec;
  };
  let scale = avgBpm / (timeWeightedMean(raw) || 1);
  let bpm = raw.map(r => soften(r * scale));
  for (let iter = 0; iter < 20; iter++) {
    const mean = timeWeightedMean(bpm);
    if (Math.abs(mean - avgBpm) < 0.05) break;
    scale *= avgBpm / mean;
    bpm = raw.map(r => soften(r * scale));
  }

  return points.map((p, i) => ({ ...p, heartRateBpm: Math.round(bpm[i]) }));
}
