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

const event = (name: string) =>
  fetch(`${base}/event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
const login = (pw: string) => ({ authorization: "Basic " + Buffer.from(`any:${pw}`).toString("base64") });

describe("usage stats", () => {
  it("counts known events per day and rejects unknown ones", async () => {
    expect((await event("download_click")).status).toBe(204);
    expect((await event("download_click")).status).toBe(204);
    expect((await event("download_success")).status).toBe(204);
    expect((await event("hack_the_planet")).status).toBe(400);
    expect((await event("gpx_generated")).status).toBe(400); // only the server counts this one
    expect(lastAuth).toBe("Bearer secret-token");

    const { dayKey } = await import("../src/services/stats");
    expect(Object.fromEntries(store.get(`stats:${dayKey(new Date())}`)!)).toEqual({ download_click: 2, download_success: 1 });
  });

  it("protects the stats page with the password", async () => {
    const none = await fetch(`${base}/stats`);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Basic");
    expect((await fetch(`${base}/stats`, { headers: login("wrong") })).status).toBe(401);

    const ok = await fetch(`${base}/stats?days=7`, { headers: login("hunter2") });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const html = await ok.text();
    expect(html).toContain("StravaJockey stats");
    expect(html).toContain("50 %"); // 1 download of 2 clicks

    const json = await (await fetch(`${base}/stats?days=3&format=json`, { headers: login("hunter2") })).json();
    expect(json.days).toHaveLength(3);
    expect(json.days[0].counts).toEqual({ download_click: 2, download_success: 1 });
  });

  it("hides the stats page when no password is set", async () => {
    const saved = process.env.STATS_PASSWORD;
    delete process.env.STATS_PASSWORD;
    try {
      expect((await fetch(`${base}/stats`, { headers: login("") })).status).toBe(404);
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
