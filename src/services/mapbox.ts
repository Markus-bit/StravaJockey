import axios from "axios";
import { logger } from "../logger";
import type { LngLat, MatchProfile, MatchedPoint } from "../domain/types";

const DIR_BASE   = "https://api.mapbox.com/directions/v5/mapbox";
const MATCH_BASE = "https://api.mapbox.com/matching/v5/mapbox";

const profileMap: Record<MatchProfile,string> = {
  walking: "walking",
  cycling: "cycling",
  driving: "driving"
};

// Directions: best for få waypoints (snap-to-road med routing)
export async function directionsRoute(points: LngLat[], profile: MatchProfile, token: string): Promise<MatchedPoint[]> {
  if (points.length < 2) throw new Error("Need at least 2 points");
  const coords = points.map(p => `${p.lng},${p.lat}`).join(";");
  const url = `${DIR_BASE}/${profileMap[profile]}/${coords}`;

  const res = await axios.get(url, {
    params: {
      access_token: token,
      geometries: "geojson",
      overview: "full",   // gir tett geometri langs vei/sti
      steps: false
    },
    timeout: 15000
  });

  const route = res.data?.routes?.[0];
  if (!route) throw new Error("No route from Directions");
  return route.geometry.coordinates.map((c: number[]) => ({ lng: c[0], lat: c[1] }));
}

// Map Matching: best for tette spor (frihånd/GPS). Bruker radiuses+timestamps for robusthet
export async function mapMatch(points: LngLat[], profile: MatchProfile, token: string): Promise<MatchedPoint[]> {
  if (points.length < 2) throw new Error("Need at least 2 points");
  const coords = points.map(p => `${p.lng},${p.lat}`).join(";");
  const radiuses = points.map(() => 100).join(";");       // 100 m toleranse per punkt
  const start = Math.floor(Date.now()/1000);
  const timestamps = points.map((_,i)=> start + i*5).join(";"); // stigende sekunder

  const url = `${MATCH_BASE}/${profileMap[profile]}/${coords}`;
  const res = await axios.get(url, {
    params: {
      access_token: token,
      geometries: "geojson",
      steps: false,
      tidy: true,
      radiuses,
      timestamps
    },
    timeout: 15000
  });

  const match = res.data?.matchings?.[0];
  if (!match) {
    const code = res.data?.code || "NoMatch";
    const msg  = res.data?.message || "No matching found";
    const err: any = new Error(msg);
    err.code = code;
    throw err;
  }

  return match.geometry.coordinates.map((c: number[]) => ({ lng: c[0], lat: c[1] }));
}

// Hybrid: prøv Directions først for waypoints. Hvis du eksplisitt vil matche spor, sett preferMatch=true
export async function snapToRoad(
  points: LngLat[], profile: MatchProfile, token: string, preferMatch = false
): Promise<MatchedPoint[]> {
  if (preferMatch) {
    try { return await mapMatch(points, profile, token); }
    catch (e:any) {
      logger.warn({ reason: e?.code || e?.message }, "Map Matching failed, falling back to Directions");
      return directionsRoute(points, profile, token);
    }
  }
  // Default: Directions (waypoints)
  try {
    return await directionsRoute(points, profile, token);
  } catch (e:any) {
    logger.warn({ reason: e?.message }, "Directions failed, trying Map Matching");
    return mapMatch(points, profile, token);
  }
}