import { Router } from "express";
import { z } from "zod";
import { accumulateDistances } from "./domain/geo";
import { snapToRoad } from "./services/mapbox";
import { densifyLine } from "./services/densify";
import { buildGpx, type GpxActivityType } from "./services/gpx";
import { generateTimestamps } from "./services/pace";
import { enrichElevation, elevationGain } from "./services/elevation";
import { generateHeartRate } from "./services/heartrate";
import { heartRateRandom, paceRandom } from "./services/noise";
import { activityPreview, elevationProfile } from "./services/preview";
import { logger } from "./logger";
import type { LngLat, MatchedPoint } from "./domain/types";
import { config } from "./config";
import { HttpError, sendError } from "./errors";
import { cachedRoute, routeKey } from "./services/routeCache";

const router = Router();

const PointsSchema = z
  .array(z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }))
  .min(2, "Place at least two points on the map.")
  .max(config.maxWaypoints, `Too many points (max ${config.maxWaypoints}).`);
const ProfileSchema = z.enum(["walking","cycling","driving"]);

function toFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim() || "route";
  return `${base}.gpx`;
}

function getMapboxToken(): string {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    throw new HttpError(500, "The server isn't configured correctly. Please try again later.",
      "MAPBOX_TOKEN is not set on the server. Add it to .env and restart.");
  }
  return token;
}

// Snap to roads and refuse routes longer than the configured maximum
async function snapWithinLimits(points: LngLat[], profile: "walking" | "cycling" | "driving", preferMatch?: boolean) {
  // Cached: the snap preview, the elevation stats and the GPX download reuse one Mapbox call
  const token = getMapboxToken();
  const snapped = await cachedRoute(routeKey(points, profile, preferMatch), () =>
    snapToRoad(points, profile, token, preferMatch)
  );
  const dists = accumulateDistances(snapped);
  const km = (dists[dists.length - 1] ?? 0) / 1000;
  if (km > config.maxRouteKm) {
    throw new HttpError(422, `Routes can be at most ${config.maxRouteKm} km long (this one is ${Math.round(km)} km).`);
  }
  return snapped;
}

router.get("/health", (_req,res)=>res.json({ok:true}));

// ---- NY: få snappet rute (geojson + distanse/duration-anslag)
router.post("/route", async (req, res) => {
  try {
    const body = z.object({
      points: PointsSchema,
      profile: ProfileSchema.default("walking"),
      preferMatch: z.boolean().optional(), // sett true hvis klient sender tett spor
      spacingM: z.number().min(10).max(500).default(25),
      includeElevation: z.boolean().default(false)
    }).parse(req.body);

    const snapped = await snapWithinLimits(body.points, body.profile, body.preferMatch);

    // densifiser for jevn høyde/tidsprofil
    const dense = densifyLine(snapped, body.spacingM);

    const dists = accumulateDistances(dense);
    const total = dists[dists.length-1];

    // høydemeter er "nice to have" for statistikken: feil her skal ikke stoppe ruten
    let elevationGainM: number | null = null;
    let elevationError: string | null = null;
    let profile: ReturnType<typeof elevationProfile> | null = null;
    if (body.includeElevation) {
      try {
        const withEle = await enrichElevation(dense, { provider: "opentopodata" });
        const gain = elevationGain(withEle);
        if (gain !== null) profile = elevationProfile(withEle, dists);
        if (gain === null) elevationError = "No elevation data for this area (the elevation dataset covers Europe only).";
        else elevationGainM = Math.round(gain);
      } catch (e) {
        elevationError = e instanceof HttpError ? e.message : "Elevation isn't available right now.";
        logger.warn({ err: (e as Error)?.message }, "Elevation lookup failed for route stats");
      }
    }

    res.json({
      geometry: { type: "LineString", coordinates: dense.map(p=>[p.lng,p.lat]) },
      distanceM: Math.round(total),
      elevationGainM,
      elevationError,
      elevationProfile: profile
    });
  } catch (e) {
    sendError(res, e, "route");
  }
});

// ---- full pipeline: waypoints -> GPX
const GpxRequestSchema = z.object({
  points: PointsSchema,
  profile: ProfileSchema.default("walking"),
  activityType: z.enum(["running","cycling"]).optional(),
  paceSecPerKm: z.number().positive(),
  paceVariability: z.number().min(0).max(0.5).default(0),
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  heartRate: z.object({
    avgBpm: z.number().min(40).max(220),
    variability: z.number().min(0).max(0.3).default(0)
  }).optional(),
  name: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  startTimeISO: z.string().datetime().optional(),
  addPauses: z.boolean().optional(),
  pauseEveryKm: z.number().optional(),
  pauseSeconds: z.number().optional(),
  preferMatch: z.boolean().optional(),
  spacingM: z.number().min(10).max(500).default(25),
  includeElevation: z.boolean().default(false),
  elevationProvider: z.enum(["opentopodata"]).optional()
});

router.post("/generate-gpx", async (req, res) => {
  try {
    const parsed = GpxRequestSchema.parse(req.body);

    // 1) snap (Directions default)
    const snapped = await snapWithinLimits(parsed.points, parsed.profile, parsed.preferMatch);
    // 2) densifiser
    const dense = densifyLine(snapped, parsed.spacingM);
    // 3) distanse
    const dists = accumulateDistances(dense);
    const withDist = dense.map((p,i)=> ({ ...p, distanceOnRouteM: dists[i] }));
    // 4) høyde (hvis oppslaget feiler lager vi fila uten høyde i stedet for å feile)
    let withEle: MatchedPoint[] = withDist;
    if (parsed.includeElevation) {
      try {
        withEle = await enrichElevation(withDist, { provider: parsed.elevationProvider || "opentopodata" });
      } catch (e) {
        logger.warn({ err: (e as Error)?.message }, "Elevation lookup failed, writing GPX without elevation");
      }
    }
    // 5) timestamps
    const withTime = generateTimestamps({
      points: withEle,
      paceSecPerKm: parsed.paceSecPerKm,
      startTimeISO: parsed.startTimeISO || new Date().toISOString(),
      paceVariability: parsed.paceVariability,
      addPauses: parsed.addPauses,
      pauseEveryKm: parsed.pauseEveryKm,
      pauseSeconds: parsed.pauseSeconds,
      rand: paceRandom(parsed.seed)
    });
    // 6) puls
    const withHr = parsed.heartRate
      ? generateHeartRate({
          points: withTime,
          avgBpm: parsed.heartRate.avgBpm,
          variability: parsed.heartRate.variability,
          rand: heartRateRandom(parsed.seed)
        })
      : withTime;
    // 7) GPX
    const activityName = parsed.name || "Generated Route";
    const type: GpxActivityType = parsed.activityType || (parsed.profile === "cycling" ? "cycling" : "running");
    const gpx = buildGpx(withHr, { name: activityName, description: parsed.description, type });
    const fileName = toFileName(activityName);
    res.setHeader("Content-Type","application/gpx+xml");
    // ASCII fallback + RFC 5987 UTF-8 name (Node rejects raw non-ASCII in headers)
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.send(gpx);
  } catch (e) {
    sendError(res, e, "generate-gpx");
  }
});

// ---- chart preview: pace and heart rate along the route (same generators + seed as the GPX)
router.post("/activity-preview", (req, res) => {
  try {
    const body = z.object({
      distanceM: z.number().positive()
        .max(config.maxRouteKm * 1000 * 1.01, `Routes can be at most ${config.maxRouteKm} km long.`),
      paceSecPerKm: z.number().positive(),
      paceVariability: z.number().min(0).max(0.5).default(0),
      heartRate: z.object({
        avgBpm: z.number().min(40).max(220),
        variability: z.number().min(0).max(0.3).default(0)
      }).optional(),
      seed: z.number().int().min(0).max(0xffffffff).optional()
    }).parse(req.body);
    res.json(activityPreview(body));
  } catch (e) {
    sendError(res, e, "activity-preview");
  }
});

router.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default router;
