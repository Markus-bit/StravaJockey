import express from "express";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directionsResponse, stubHttp, terrainTile } from "./helpers";

process.env.MAPBOX_TOKEN = "pk.test";
let base = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  stubHttp((url) => (url.includes("/v4/") ? { data: terrainTile(50) } : directionsResponse(url)));
  const { default: router } = await import("../src/routes");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const twoPoints = [{ lng: 10.7, lat: 59.9 }, { lng: 10.72, lat: 59.91 }];

describe("API", () => {
  it("snaps a route and returns distance, elevation gain and profile", async () => {
    const r = await post("/route", { points: twoPoints, profile: "walking", includeElevation: true });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.geometry.type).toBe("LineString");
    expect(data.distanceM).toBeGreaterThan(1000);
    expect(data.elevationGainM).toBe(0); // flat tile
    expect(data.elevationProfile.distM.length).toBeGreaterThan(10);
  });

  it("rejects too few points, too many points and invalid coordinates with a clear message", async () => {
    expect(await (await post("/route", { points: [] })).json()).toEqual({ error: "Place at least two points on the map." });
    const many = Array.from({ length: 201 }, (_, i) => ({ lng: 10 + i * 1e-4, lat: 60 }));
    const r = await post("/route", { points: many });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Too many points (max 200).");
    expect((await post("/route", { points: [{ lng: 500, lat: 0 }, { lng: 0, lat: 0 }] })).status).toBe(400);
  });

  it("refuses routes longer than the limit", async () => {
    const r = await post("/route", { points: [{ lng: 10, lat: 59 }, { lng: 10, lat: 63 }] });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/at most 300 km/);
  });

  it("generates a complete GPX file with the activity name", async () => {
    const r = await post("/generate-gpx", {
      points: twoPoints, profile: "cycling", paceSecPerKm: 144, name: "Søndagstur 🏃", seed: 1,
      heartRate: { avgBpm: 150, variability: 0.1 }, includeElevation: true,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toContain("filename*=UTF-8''S%C3%B8ndagstur");
    const gpx = await r.text();
    expect(gpx).toContain("<name>Søndagstur 🏃</name>");
    expect(gpx).toContain("<type>cycling</type>");
    expect(gpx).toContain("<ele>50.00</ele>");
    expect(gpx).toContain("<gpxtpx:hr>");
    expect(gpx.trim().endsWith("</gpx>")).toBe(true);
  });

  it("returns pace and heart rate series for the chart preview", async () => {
    const r = await post("/activity-preview", { distanceM: 5000, paceSecPerKm: 300, paceVariability: 0.2, heartRate: { avgBpm: 150, variability: 0.1 }, seed: 5 });
    const data = await r.json();
    expect(data.distM.length).toBe(data.paceSecPerKm.length);
    expect(data.totalTimeSec).toBeCloseTo(1500, 0);
    expect(data.heartRateBpm.length).toBe(data.distM.length);
  });

  it("answers unknown API paths with a JSON 404", async () => {
    const r = await fetch(base + "/nope");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not found" });
  });
});

describe("error messages", () => {
  it("recognises Mapbox by hostname, not by a substring of the URL", async () => {
    const { sendError } = await import("../src/errors");
    const { default: axios } = await import("axios");
    const reply = (url: string) => {
      const err = new axios.AxiosError("fail", undefined, { url } as never, undefined, { status: 422, data: { message: "too far" } } as never);
      let body: unknown;
      const res = { status: () => res, json: (b: unknown) => { body = b; return res; } };
      sendError(res as never, err, "test");
      return (body as { error: string }).error;
    };
    expect(reply("https://api.mapbox.com/directions/v5/mapbox/walking/1,2;3,4")).toBe("No route could be found: too far");
    expect(reply("https://evil.example/?api.mapbox.com")).toBe("An external service didn't respond. Please try again in a moment.");
  });
});
