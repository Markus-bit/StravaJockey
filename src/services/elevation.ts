import axios from "axios";
import { MatchedPoint } from "../domain/types";
import { logger } from "../logger";

// Simple sleep helper
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Chunk helper
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function enrichElevation(
  points: MatchedPoint[],
  opts?: { provider?: "none" | "opentopodata" }
): Promise<MatchedPoint[]> {
  const provider = (opts?.provider || process.env.ELEVATION_PROVIDER || "opentopodata").toLowerCase();

  if (provider === "none") {
    // Skip elevation entirely
    return points.map(p => ({ ...p, elevationM: null }));
  }
  if (provider !== "opentopodata") {
    throw new Error(`Unknown elevation provider "${provider}" (supported: opentopodata, none)`);
  }
  return elevationOpenTopo(points);
}

// Exponential backoff for OpenTopoData (handles 429/503)
async function getOpenTopoBatch(locations: string, attempt = 1): Promise<any> {
  try {
    const url = `https://api.opentopodata.org/v1/eudem25m?locations=${locations}`;
    return await axios.get(url, { timeout: 15000 });
  } catch (err: any) {
    const status = err?.response?.status;
    if ((status === 429 || status === 503) && attempt < 6) {
      const waitMs = 300 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      logger.warn({ attempt, waitMs, status }, "OpenTopoData rate limited – backing off");
      await sleep(waitMs);
      return getOpenTopoBatch(locations, attempt + 1);
    }
    throw err;
  }
}

async function elevationOpenTopo(points: MatchedPoint[]): Promise<MatchedPoint[]> {
  // Use small chunks to reduce per-request URL size and to throttle
  const chunks = chunk(points, 50);
  const out = [...points];
  let idx = 0;

  for (const group of chunks) {
    const locations = group.map(p => `${p.lat},${p.lng}`).join("|");

    // Throttle: 3 requests/second max → wait ~350ms between calls
    if (idx > 0) await sleep(350);

    const res = await getOpenTopoBatch(locations);
    const results = res.data?.results || [];

    results.forEach((r: any, i: number) => {
      out[idx + i].elevationM = (typeof r.elevation === "number") ? r.elevation : null;
    });

    // If results shorter, fill nulls to stay consistent
    for (let i = results.length; i < group.length; i++) {
      out[idx + i].elevationM = out[idx + i].elevationM ?? null;
    }

    idx += group.length;
  }

  return out;
}
