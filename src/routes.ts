import { Router } from "express";
import { z } from "zod";
import { accumulateDistances } from "./domain/geo";
import { snapToRoad } from "./services/mapbox";
import { densifyLine } from "./services/densify";
import { buildGpx } from "./services/gpx";
import { generateTimestamps } from "./services/pace";
import { enrichElevation } from "./services/elevation";

const router = Router();

const PointsSchema = z.array(z.object({ lng: z.number(), lat: z.number() })).min(2);
const ProfileSchema = z.enum(["walking","cycling","driving"]);

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
      spacingM: z.number().min(10).max(500).default(25)
    }).parse(req.body);

    const token = getMapboxToken();
    const snapped = await snapToRoad(body.points, body.profile, token, body.preferMatch);

    // densifiser for jevn høyde/tidsprofil
    const dense = densifyLine(snapped, body.spacingM);

    const dists = accumulateDistances(dense);
    const total = dists[dists.length-1];

    res.json({
      geometry: { type: "LineString", coordinates: dense.map(p=>[p.lng,p.lat]) },
      distanceM: Math.round(total)
    });
  } catch (e:any) {
    res.status(400).json({ error: e?.message || "Route failed" });
  }
});

// ---- eksisterende full pipeline: generer GPX fra waypoints
router.post("/generate-gpx", async (req, res) => {
  try {
    const parsed = z.object({
      points: PointsSchema,
      profile: ProfileSchema.default("walking"),
      paceSecPerKm: z.number().positive(),
      startTimeISO: z.string().datetime().optional(),
      addPauses: z.boolean().optional(),
      pauseEveryKm: z.number().optional(),
      pauseSeconds: z.number().optional(),
      jitterSecondsPerKm: z.number().optional(),
      preferMatch: z.boolean().optional(),
      spacingM: z.number().min(10).max(500).default(25),
      includeElevation: z.boolean().default(false),
      elevationProvider: z.enum(["opentopodata"]).optional()
    }).parse(req.body);

    const token = getMapboxToken();
    // 1) snap (Directions default)
    const snapped = await snapToRoad(parsed.points, parsed.profile, token, parsed.preferMatch);
    // 2) densifiser
    const dense = densifyLine(snapped, parsed.spacingM);
    // 3) distanse
    const dists = accumulateDistances(dense);
    const withDist = dense.map((p,i)=> ({ ...p, distanceOnRouteM: dists[i] }));
    // 4) høyde
    const withEle = await enrichElevation(withDist, {
      provider: parsed.includeElevation ? (parsed.elevationProvider || "opentopodata") : "none"
    });
    // 5) timestamps
    const withTime = generateTimestamps({
      points: withEle,
      paceSecPerKm: parsed.paceSecPerKm,
      startTimeISO: parsed.startTimeISO || new Date().toISOString(),
      addPauses: parsed.addPauses,
      pauseEveryKm: parsed.pauseEveryKm,
      pauseSeconds: parsed.pauseSeconds,
      jitterSecondsPerKm: parsed.jitterSecondsPerKm
    });
    // 6) GPX
    const gpx = buildGpx(withTime, "Generated Route");
    res.setHeader("Content-Type","application/gpx+xml");
    res.setHeader("Content-Disposition","attachment; filename=route.gpx");
    res.send(gpx);
  } catch (e:any) {
    res.status(400).json({ error: e?.message || "Generate GPX failed" });
  }
});

export default router;
