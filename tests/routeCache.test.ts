import { describe, expect, it } from "vitest";
import { cachedRoute, routeKey } from "../src/services/routeCache";

describe("route cache", () => {
  const route = [{ lat: 1, lng: 2 }];

  it("calls the fetcher once for the same key", async () => {
    let calls = 0;
    const fetch = async () => { calls++; return route; };
    const key = routeKey([{ lng: 10, lat: 60 }, { lng: 10.1, lat: 60.1 }], "walking");
    await cachedRoute(key, fetch);
    await cachedRoute(key, fetch);
    expect(calls).toBe(1);
  });

  it("shares one call between simultaneous requests", async () => {
    let calls = 0;
    const fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return route; };
    const key = routeKey([{ lng: 11, lat: 60 }, { lng: 11.1, lat: 60.1 }], "walking");
    await Promise.all([cachedRoute(key, fetch), cachedRoute(key, fetch)]);
    expect(calls).toBe(1);
  });

  it("doesn't cache errors", async () => {
    let calls = 0;
    const key = routeKey([{ lng: 12, lat: 60 }, { lng: 12.1, lat: 60.1 }], "walking");
    await expect(cachedRoute(key, async () => { calls++; throw new Error("boom"); })).rejects.toThrow("boom");
    await cachedRoute(key, async () => { calls++; return route; });
    expect(calls).toBe(2);
  });

  it("keeps profiles apart", () => {
    const pts = [{ lng: 10, lat: 60 }, { lng: 10.1, lat: 60.1 }];
    expect(routeKey(pts, "walking")).not.toBe(routeKey(pts, "cycling"));
  });
});
