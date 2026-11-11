import { describe, expect, it } from "vitest";
import { generateTimestamps } from "../src/services/pace";
import { generateHeartRate } from "../src/services/heartrate";
import { seededRandom } from "../src/services/noise";
import { straightRoute, timeWeightedAvgHr } from "./helpers";

const timed = (paceVariability: number) =>
  generateTimestamps({ points: straightRoute(5), paceSecPerKm: 400, startTimeISO: "2026-01-01T10:00:00Z", paceVariability, rand: seededRandom(3) });
const hr = (paceVar: number, avgBpm: number, variability: number) =>
  generateHeartRate({ points: timed(paceVar), avgBpm, variability, rand: seededRandom(4) });

describe("generateHeartRate", () => {
  it("hits the average exactly", () => {
    for (const [avg, v] of [[130, 0], [150, 0.1], [180, 0.3], [200, 0.3]]) {
      expect(timeWeightedAvgHr(hr(0.3, avg, v))).toBeCloseTo(avg, 0);
    }
  });

  it("is steady at 0 % variability, even when the pace varies a lot", () => {
    const pts = hr(0.5, 150, 0);
    const t0 = Date.parse(pts[0].timeISO!);
    const afterWarmup = pts.filter((p) => Date.parse(p.timeISO!) - t0 > 600_000).map((p) => p.heartRateBpm!);
    expect(Math.max(...afterWarmup) - Math.min(...afterWarmup)).toBeLessThanOrEqual(8); // only the slow drift
  });

  it("varies more with higher variability", () => {
    const spread = (v: number) => { const b = hr(0.3, 150, v).map((p) => p.heartRateBpm!); return Math.max(...b) - Math.min(...b); };
    expect(spread(0.3)).toBeGreaterThan(spread(0.1));
  });

  it("never goes above the soft ceiling or below 45", () => {
    for (const avg of [150, 200, 215]) {
      const b = hr(0.5, avg, 0.3).map((p) => p.heartRateBpm!);
      expect(Math.max(...b)).toBeLessThanOrEqual(Math.min(220, Math.max(205, avg + 10)));
      expect(Math.min(...b)).toBeGreaterThanOrEqual(45);
    }
  });

  it("starts lower (warm-up)", () => {
    const b = hr(0, 160, 0).map((p) => p.heartRateBpm!);
    expect(b[0]).toBeLessThan(140);
  });
});
