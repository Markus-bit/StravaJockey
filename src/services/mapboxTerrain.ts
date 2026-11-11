import axios from "axios";
import { PNG } from "pngjs";
import { logger } from "../logger";

// Elevation from Mapbox terrain tiles (Terrain-RGB): each pixel's color encodes a height,
//   height = -10000 + (R * 256 * 256 + G * 256 + B) * 0.1   metres
// https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/
// We fetch the few tiles a route crosses (in parallel), read the heights at the sample
// points with bilinear interpolation, and keep the tiles in memory for a while so
// routes in the same area reuse them.

const TILESET = process.env.MAPBOX_TERRAIN_TILESET || "mapbox.terrain-rgb";
const TILE_PX = 512;            // "@2x" tiles: 512 × 512 pixels
const MAX_ZOOM = 14;            // ~5 m per pixel in Norway, ~10 m at the equator
const MIN_ZOOM = 9;
const MAX_TILES_PER_LOOKUP = 64; // long routes use a lower zoom instead of hundreds of tiles
const CONCURRENCY = 8;

// Cache of compressed PNG tiles (decoded per lookup), bounded by size and age
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60_000;
type CachedTile = { png: Buffer | null; expires: number }; // null = no data (404)
const tileCache = new Map<string, CachedTile>();
let cacheBytes = 0;
export const terrainStats = { tilesFetched: 0, tilesFromCache: 0 };

type Location = { lat: number; lng: number };
type Decoded = { data: Buffer; width: number; height: number } | null;

export async function lookupMapboxTerrain(locations: Location[], token: string): Promise<(number | null)[]> {
  if (!locations.length) return [];

  // 1) Highest zoom at which the route needs at most MAX_TILES_PER_LOOKUP tiles
  let zoom = MAX_ZOOM;
  let tiles = tilesFor(locations, zoom);
  while (tiles.size > MAX_TILES_PER_LOOKUP && zoom > MIN_ZOOM) {
    zoom--;
    tiles = tilesFor(locations, zoom);
  }

  // 2) Fetch (or reuse) and decode those tiles, a few at a time
  const decoded = new Map<string, Decoded>();
  const keys = [...tiles];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
      while (next < keys.length) {
        const key = keys[next++];
        const png = await getTile(key, token);
        decoded.set(key, png ? decode(png) : null);
      }
    })
  );
  logger.info({ zoom, tiles: keys.length }, "Mapbox terrain lookup");
  // Every tile missing usually means a wrong tileset name or no access, not open sea:
  // treat it as a failure so the caller falls back to the other elevation source
  if ([...decoded.values()].every((t) => t === null)) {
    throw new Error(`Mapbox returned no terrain tiles for "${TILESET}"`);
  }

  // 3) Read the height at every location
  return locations.map((loc) => {
    const { x, y } = tileCoords(loc, zoom);
    const tx = Math.floor(x), ty = Math.floor(y);
    const tile = decoded.get(`${zoom}/${tx}/${ty}`);
    if (!tile) return null;
    // pixel centres sit at +0.5; clamp to the tile so we never need a neighbour tile
    const px = clamp((x - tx) * tile.width - 0.5, 0, tile.width - 1);
    const py = clamp((y - ty) * tile.height - 0.5, 0, tile.height - 1);
    return bilinear(tile, px, py);
  });
}

// ---------------------------------------------------------------------------

function tileCoords({ lat, lng }: Location, z: number) {
  const n = 2 ** z;
  const latRad = (clamp(lat, -85.0511, 85.0511) * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

function tilesFor(locations: Location[], z: number): Set<string> {
  const set = new Set<string>();
  for (const loc of locations) {
    const { x, y } = tileCoords(loc, z);
    set.add(`${z}/${Math.floor(x)}/${Math.floor(y)}`);
  }
  return set;
}

async function getTile(key: string, token: string): Promise<Buffer | null> {
  const hit = tileCache.get(key);
  if (hit && hit.expires > Date.now()) {
    tileCache.delete(key); // move to the end (most recently used)
    tileCache.set(key, hit);
    terrainStats.tilesFromCache++;
    return hit.png;
  }
  if (hit) evict(key);

  let png: Buffer | null;
  try {
    const res = await axios.get(`https://api.mapbox.com/v4/${TILESET}/${key}@2x.pngraw`, {
      params: { access_token: token },
      responseType: "arraybuffer",
      timeout: 15000,
    });
    png = Buffer.from(res.data);
  } catch (e) {
    // No tile at this position (e.g. open ocean): no data rather than an error
    if (axios.isAxiosError(e) && e.response?.status === 404) png = null;
    else throw e;
  }
  terrainStats.tilesFetched++;
  store(key, png);
  return png;
}

function store(key: string, png: Buffer | null) {
  tileCache.set(key, { png, expires: Date.now() + CACHE_TTL_MS });
  cacheBytes += png?.length ?? 0;
  for (const k of tileCache.keys()) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    evict(k);
  }
}

function evict(key: string) {
  const e = tileCache.get(key);
  if (!e) return;
  cacheBytes -= e.png?.length ?? 0;
  tileCache.delete(key);
}

function decode(png: Buffer): Decoded {
  const img = PNG.sync.read(png);
  return { data: img.data, width: img.width, height: img.height };
}

function heightAt(tile: NonNullable<Decoded>, px: number, py: number): number {
  const i = (py * tile.width + px) * 4;
  const d = tile.data;
  return -10000 + (d[i] * 65536 + d[i + 1] * 256 + d[i + 2]) * 0.1;
}

function bilinear(tile: NonNullable<Decoded>, px: number, py: number): number {
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, tile.width - 1), y1 = Math.min(y0 + 1, tile.height - 1);
  const fx = px - x0, fy = py - y0;
  const top = heightAt(tile, x0, y0) * (1 - fx) + heightAt(tile, x1, y0) * fx;
  const bottom = heightAt(tile, x0, y1) * (1 - fx) + heightAt(tile, x1, y1) * fx;
  return Math.round((top * (1 - fy) + bottom * fy) * 10) / 10;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}
