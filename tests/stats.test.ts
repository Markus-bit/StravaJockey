import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A tiny stand-in for Upstash's REST API (only what we use: /pipeline with HINCRBY and HGETALL)
const store = new Map<string, Map<string, number>>();
let lastAuth = "";
const fakeUpstash = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    lastAuth = req.headers.authorization ?? "";
    const out = (JSON.parse(body) as string[][]).map(([cmd, key, field, by]) => {
      const h = store.get(key) ?? new Map<string, number>();
      store.set(key, h);
      if (cmd === "HINCRBY") { h.set(field, (h.get(field) ?? 0) + Number(by)); return { result: h.get(field) }; }
      if (cmd === "HGETALL") return { result: [...h].flatMap(([f, v]) => [f, String(v)]) };
      return { error: "unknown command" };
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out));
  });
});

let base = "";
let server: http.Server;

beforeAll(async () => {
  await new Promise<void>((r) => fakeUpstash.listen(0, r));
  process.env.KV_REST_API_URL = `http://localhost:${(fakeUpstash.address() as AddressInfo).port}`;
  process.env.KV_REST_API_TOKEN = "secret-token";
  process.env.STATS_PASSWORD = "hunter2";
  const { default: statsRouter } = await import("../src/statsRoutes");
  const app = express();
  app.use(express.json());
  app.use("/api", statsRouter);
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => { server.close(); fakeUpstash.close(); });

const event = (body: object, headers: Record<string, string> = {}) =>
  fetch(`${base}/event`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const json = { accept: "application/json" };
const bearer = (pw: string) => ({ ...json, authorization: `Bearer ${pw}` });
const today = async () => {
  const { dayKey } = await import("../src/services/stats");
  return Object.fromEntries(store.get(`stats:${dayKey(new Date())}`) ?? []);
};

describe("usage stats", () => {
  it("counts known events per day and rejects unknown ones", async () => {
    expect((await event({ name: "download_click" })).status).toBe(204);
    expect((await event({ name: "download_click" })).status).toBe(204);
    expect((await event({ name: "download_success" })).status).toBe(204);
    expect((await event({ name: "hack_the_planet" })).status).toBe(400);
    expect((await event({ name: "gpx_generated" })).status).toBe(400); // only the server counts this one
    expect((await event({ name: "visit", device: "toaster" })).status).toBe(400);
    expect(lastAuth).toBe("Bearer secret-token");
    expect(await today()).toEqual({ download_click: 2, download_success: 1 });
  });

  it("counts a visit with device, source, country and hour, but nothing identifying", async () => {
    await event({ name: "visit", device: "mobile", source: "google" }, { "x-vercel-ip-country": "NO" });
    await event({ name: "visit" }, { "x-vercel-ip-country": "not-a-country" });
    const t = await today();
    expect(t.visit).toBe(2);
    expect(t["device:mobile"]).toBe(1);
    expect(t["source:google"]).toBe(1);
    expect(t["source:direct"]).toBe(1);
    expect(t["country:NO"]).toBe(1);
    expect(Object.keys(t).filter((k) => k.startsWith("country:"))).toEqual(["country:NO"]);
    expect(Object.keys(t).filter((k) => k.startsWith("hour_visit:")).length).toBeGreaterThan(0);
  });

  it("describes a generated GPX in buckets", async () => {
    const { gpxFields, bucket, DIST_EDGES_KM } = await import("../src/services/stats");
    expect(bucket(0.4, DIST_EDGES_KM)).toBe("0-5");
    expect(bucket(21.1, DIST_EDGES_KM)).toBe("21-30");
    expect(bucket(250, DIST_EDGES_KM)).toBe("100+");
    const now = new Date("2026-11-15T07:30:00Z"); // 08:30 in Oslo
    expect(gpxFields({ sport: "run", distanceKm: 10.2, paceSecPerKm: 330, heartRate: true, country: "SE", now }).sort()).toEqual(
      ["dist:10-15", "dl_country:SE", "hour_download:08", "hr:on", "pace_run:5.5-6", "sport:run"]
    );
    expect(gpxFields({ sport: "bike", distanceKm: 60, paceSecPerKm: 120, heartRate: false, country: null, now })).toContain("speed_bike:30-35");
  });

  it("protects the stats with the password", async () => {
    expect((await fetch(`${base}/stats`, { headers: json })).status).toBe(401);
    expect((await fetch(`${base}/stats`, { headers: bearer("wrong") })).status).toBe(401);
    const basic = { ...json, authorization: "Basic " + Buffer.from("any:hunter2").toString("base64") };
    expect((await fetch(`${base}/stats`, { headers: basic })).status).toBe(200);

    const ok = await fetch(`${base}/stats?days=3`, { headers: bearer("hunter2") });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = await ok.json();
    expect(body.days).toHaveLength(3);
    expect(body.days[0].counts.download_click).toBe(2);
    expect(body.timeZone).toBe("Europe/Oslo");
  });

  it("sends browsers that open /api/stats to the dashboard", async () => {
    const r = await fetch(`${base}/stats`, { headers: { accept: "text/html" }, redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/stats/");
  });

  it("switches the stats off when no password is set", async () => {
    const saved = process.env.STATS_PASSWORD;
    delete process.env.STATS_PASSWORD;
    try {
      expect((await fetch(`${base}/stats`, { headers: bearer("") })).status).toBe(404);
    } finally {
      process.env.STATS_PASSWORD = saved;
    }
  });

  it("uses the configured time zone for the day", async () => {
    const { dayKey } = await import("../src/services/stats");
    const lateUtc = new Date("2026-11-15T23:30:00Z");
    expect(dayKey(lateUtc, "UTC")).toBe("2026-11-15");
    expect(dayKey(lateUtc, "Europe/Oslo")).toBe("2026-11-16");
  });
});
