import axios from "axios";
import { PNG } from "pngjs";
import { densifyLine } from "../src/services/densify";
import { accumulateDistances } from "../src/domain/geo";
import type { MatchedPoint } from "../src/domain/types";

// A straight route of `km` kilometres going north, with points every 25 m
export function straightRoute(km: number, lat0 = 59.91, lng0 = 10.75): MatchedPoint[] {
  const line = densifyLine([{ lng: lng0, lat: lat0 }, { lng: lng0, lat: lat0 + km / 111.2 }], 25);
  const d = accumulateDistances(line);
  return line.map((p, i) => ({ ...p, distanceOnRouteM: d[i] }));
}

// Time-weighted average of heart rate over the activity
export function timeWeightedAvgHr(points: MatchedPoint[]): number {
  const t = points.map((p) => Date.parse(p.timeISO!) / 1000);
  let s = 0;
  for (let i = 1; i < points.length; i++) s += ((points[i].heartRateBpm! + points[i - 1].heartRateBpm!) / 2) * (t[i] - t[i - 1]);
  return s / (t[t.length - 1] - t[0]);
}

// A Mapbox Terrain-RGB tile where every pixel has the given height
export function terrainTile(heightM: number, size = 8): Buffer {
  const png = new PNG({ width: size, height: size });
  const v = Math.round((heightM + 10000) * 10);
  for (let i = 0; i < size * size; i++) {
    png.data[i * 4] = (v >> 16) & 255; png.data[i * 4 + 1] = (v >> 8) & 255; png.data[i * 4 + 2] = v & 255; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

type Handler = (url: string, cfg: { params?: Record<string, unknown> }) => { status?: number; data: unknown } | Promise<{ status?: number; data: unknown }>;

// Answer every axios request with `handler` instead of the network.
// Return { status >= 400 } to simulate an HTTP error.
export function stubHttp(handler: Handler) {
  axios.defaults.adapter = async (cfg) => {
    const res = await handler(cfg.url!, cfg as { params?: Record<string, unknown> });
    const status = res.status ?? 200;
    const response = { data: res.data, status, statusText: String(status), headers: {}, config: cfg };
    if (status >= 400) {
      throw new axios.AxiosError(`Request failed with status code ${status}`, undefined, cfg, undefined, response as never);
    }
    return response;
  };
}

// A fake Mapbox Directions answer: straight line between the first and last requested point
export function directionsResponse(url: string) {
  const coords = url.split("/").pop()!.split(";").map((s) => s.split(",").map(Number));
  const [a, b] = [coords[0], coords[coords.length - 1]];
  const line = Array.from({ length: 101 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 100, a[1] + ((b[1] - a[1]) * i) / 100]);
  return { data: { routes: [{ geometry: { coordinates: line } }] } };
}
