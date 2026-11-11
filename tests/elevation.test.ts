import { beforeEach, describe, expect, it } from "vitest";
import { elevationGain, enrichElevation } from "../src/services/elevation";
import { stubHttp, straightRoute, terrainTile } from "./helpers";

describe("elevationGain", () => {
  const along = (f: (i: number) => number | null, n = 400) =>
    Array.from({ length: n }, (_, i) => ({ lat: 60, lng: 10 + i * 0.0004, elevationM: f(i) }));

  it("ignores small noise on a flat road", () => {
    expect(elevationGain(along((i) => 100 + (i % 2 ? 0.9 : -0.9)))).toBeCloseTo(0, 1);
  });

  it("counts a clean hill", () => {
    const hill = along((i) => 100 + 25 * (1 - Math.cos((i / 399) * 2 * Math.PI)));
    expect(elevationGain(hill)).toBeGreaterThan(45);
    expect(elevationGain(hill)).toBeLessThanOrEqual(50.01);
  });

  it("skips points without data, and returns null with no data at all", () => {
    expect(elevationGain(along((i) => (i % 3 === 0 ? null : 100 + i * 0.1)))).toBeGreaterThan(30);
    expect(elevationGain(along(() => null))).toBeNull();
  });
});

describe("enrichElevation (Mapbox terrain tiles with OpenTopoData fallback)", () => {
  beforeEach(() => {
    process.env.MAPBOX_TOKEN = "pk.test";
    delete process.env.ELEVATION_SOURCE;
  });

  it("reads heights from Mapbox terrain tiles", async () => {
    let tiles = 0;
    stubHttp((url, cfg) => {
      expect(url).toMatch(/api\.mapbox\.com\/v4\/.+@2x\.pngraw$/);
      expect(cfg.params?.access_token).toBe("pk.test");
      tiles++;
      return { data: terrainTile(123.4) };
    });
    const out = await enrichElevation(straightRoute(3, 61.0, 9.0));
    expect(tiles).toBeGreaterThan(0);
    expect(out.every((p) => Math.abs(p.elevationM! - 123.4) < 0.11)).toBe(true);
  });

  it("falls back to OpenTopoData when Mapbox rejects the token", async () => {
    stubHttp((url) => {
      if (url.includes("mapbox.com")) return { status: 401, data: "" };
      const locs = decodeURIComponent(url.split("locations=")[1]).split("|");
      return { data: { results: locs.map(() => ({ elevation: 77 })) } };
    });
    const out = await enrichElevation(straightRoute(2, 62.0, 8.0));
    expect(out.every((p) => p.elevationM === 77)).toBe(true);
  });

  it("skips elevation entirely with provider none", async () => {
    stubHttp(() => { throw new Error("should not be called"); });
    const out = await enrichElevation(straightRoute(1), { provider: "none" });
    expect(out.every((p) => p.elevationM === null)).toBe(true);
  });
});
