import { Router } from "express";
import { z } from "zod";
import { accumulateDistances } from "./domain/geo";
import { snapToRoad } from "./services/mapbox";
import { densifyLine } from "./services/densify";
import { buildGpx, type GpxActivityType } from "./services/gpx";
import { generateTimestamps } from "./services/pace";
import { enrichElevation, elevationGain } from "./services/elevation";
import { generateHeartRate } from "./services/heartrate";
import { logger } from "./logger";
import type { MatchedPoint } from "./domain/types";

const router = Router();

const PointsSchema = z.array(z.object({ lng: z.number(), lat: z.number() })).min(2);
const ProfileSchema = z.enum(["walking","cycling","driving"]);

function toFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim() || "route";
  return `${base}.gpx`;
}

function getMapboxToken(): string {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN is not set on the server. Add it to .env and restart.");
  return token;
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

    const token = getMapboxToken();
    const snapped = await snapToRoad(body.points, body.profile, token, body.preferMatch);

    // densifiser for jevn høyde/tidsprofil
    const dense = densifyLine(snapped, body.spacingM);

    const dists = accumulateDistances(dense);
    const total = dists[dists.length-1];

    // høydemeter er "nice to have" for statistikken: feil her skal ikke stoppe ruten
    let elevationGainM: number | null = null;
    if (body.includeElevation) {
      try {
        const gain = elevationGain(await enrichElevation(dense));
        elevationGainM = gain === null ? null : Math.round(gain);
      } catch (e:any) {
        logger.warn({ err: e?.message }, "Elevation lookup failed for route stats");
      }
    }

    res.json({
      geometry: { type: "LineString", coordinates: dense.map(p=>[p.lng,p.lat]) },
      distanceM: Math.round(total),
      elevationGainM
    });
  } catch (e:any) {
    res.status(400).json({ error: e?.message || "Route failed" });
  }
});

// ---- full pipeline: waypoints -> GPX
const GpxRequestSchema = z.object({
  points: PointsSchema,
  profile: ProfileSchema.default("walking"),
  activityType: z.enum(["running","cycling"]).optional(),
  paceSecPerKm: z.number().positive(),
  paceVariability: z.number().min(0).max(0.5).default(0),
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

    const token = getMapboxToken();
    // 1) snap (Directions default)
    const snapped = await snapToRoad(parsed.points, parsed.profile, token, parsed.preferMatch);
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
      } catch (e:any) {
        logger.warn({ err: e?.message }, "Elevation lookup failed, writing GPX without elevation");
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
      pauseSeconds: parsed.pauseSeconds
    });
    // 6) puls
    const withHr = parsed.heartRate
      ? generateHeartRate({ points: withTime, avgBpm: parsed.heartRate.avgBpm, variability: parsed.heartRate.variability })
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
  } catch (e:any) {
    res.status(400).json({ error: e?.message || "Generate GPX failed" });
  }
});

export default router;
