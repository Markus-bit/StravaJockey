import { describe, expect, it } from "vitest";
import { densifyLine } from "../src/services/densify";
import { accumulateDistances, haversine } from "../src/domain/geo";

describe("geo helpers", () => {
  it("haversine: 1 degree of latitude is ~111 km", () => {
    expect(haversine({ lat: 59, lng: 10 }, { lat: 60, lng: 10 }) / 1000).toBeCloseTo(111.2, 0);
  });

  it("densifyLine adds points at most `spacing` apart and keeps both ends", () => {
    const a = { lat: 59.9, lng: 10.7 }, b = { lat: 59.91, lng: 10.7 };
    const line = densifyLine([a, b], 25);
    expect(line[0]).toEqual(a);
    expect(line[line.length - 1]).toEqual(b);
    for (let i = 1; i < line.length; i++) expect(haversine(line[i - 1], line[i])).toBeLessThanOrEqual(25.001);
  });

  it("densifyLine doesn't duplicate the end point when the length is an exact multiple", () => {
    const a = { lat: 59.9, lng: 10.7 }, b = { lat: 59.9009, lng: 10.7 };
    const d = haversine(a, b);
    const line = densifyLine([a, b], d / 4);
    expect(line).toHaveLength(5);
    const dists = accumulateDistances(line);
    for (let i = 1; i < dists.length; i++) expect(dists[i]).toBeGreaterThan(dists[i - 1]);
  });
});
