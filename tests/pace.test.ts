import { describe, expect, it } from "vitest";
import { generateTimestamps } from "../src/services/pace";
import { seededRandom } from "../src/services/noise";
import { straightRoute } from "./helpers";

const route = straightRoute(10);
const totalKm = route[route.length - 1].distanceOnRouteM! / 1000;
const duration = (pts: { timeISO?: string }[]) => (Date.parse(pts[pts.length - 1].timeISO!) - Date.parse(pts[0].timeISO!)) / 1000;

describe("generateTimestamps", () => {
  it("hits the average pace exactly, with and without variation", () => {
    for (const v of [0, 0.2, 0.5]) {
      const t = generateTimestamps({ points: route, paceSecPerKm: 330, startTimeISO: "2026-01-01T10:00:00Z", paceVariability: v, rand: seededRandom(7) });
      expect(duration(t) / totalKm).toBeCloseTo(330, 0);
    }
  });

  it("starts at the given start time and only moves forward", () => {
    const t = generateTimestamps({ points: route, paceSecPerKm: 300, startTimeISO: "2026-01-01T10:00:00.000Z", paceVariability: 0.3 });
    expect(t[0].timeISO).toBe("2026-01-01T10:00:00.000Z");
    for (let i = 1; i < t.length; i++) expect(Date.parse(t[i].timeISO!)).toBeGreaterThanOrEqual(Date.parse(t[i - 1].timeISO!));
  });

  it("is reproducible with the same seed and different with another", () => {
    const run = (seed: number) => generateTimestamps({ points: route, paceSecPerKm: 300, startTimeISO: "2026-01-01T10:00:00Z", paceVariability: 0.3, rand: seededRandom(seed) });
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
  });

  it("adds pauses", () => {
    const base = generateTimestamps({ points: route, paceSecPerKm: 300, startTimeISO: "2026-01-01T10:00:00Z" });
    const paused = generateTimestamps({ points: route, paceSecPerKm: 300, startTimeISO: "2026-01-01T10:00:00Z", addPauses: true, pauseEveryKm: 2, pauseSeconds: 30 });
    const pauses = Math.floor(totalKm / 2); // one every 2 km that the route actually reaches
    expect(duration(paused) - duration(base)).toBeCloseTo(pauses * 30, 0);
  });
});
