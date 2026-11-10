import { Router } from "express";
import { z } from "zod";
import { accumulateDistances } from "./domain/geo";
import { snapToRoad } from "./services/mapbox";
import { densifyLine } from "./services/densify";
import { buildGpx } from "./services/gpx";
import { generateTimestamps } from "./services/pace";
import { enrichElevation } from "./services/elevation";
import * as strava from "./services/strava";

const router = Router();

const PointsSchema = z.array(z.object({ lng: z.number(), lat: z.number() })).min(2);
const ProfileSchema = z.enum(["walking","cycling","driving"]);

function toFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim() || "route";
  return `${base}.gpx`;
}

// Where to send the browser after Strava OAuth (the Vite dev server by default)
function frontendUrl(): string {
  return (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
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

// ---- felles pipeline: waypoints -> GPX-tekst
const GpxRequestSchema = z.object({
  points: PointsSchema,
  profile: ProfileSchema.default("walking"),
  paceSecPerKm: z.number().positive(),
  name: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  startTimeISO: z.string().datetime().optional(),
  addPauses: z.boolean().optional(),
  pauseEveryKm: z.number().optional(),
  pauseSeconds: z.number().optional(),
  jitterSecondsPerKm: z.number().optional(),
  preferMatch: z.boolean().optional(),
  spacingM: z.number().min(10).max(500).default(25),
  includeElevation: z.boolean().default(false),
  elevationProvider: z.enum(["opentopodata"]).optional()
});
type GpxRequest = z.infer<typeof GpxRequestSchema>;

async function buildActivityGpx(parsed: GpxRequest) {
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
  const activityName = parsed.name || "Generated Route";
  return { gpx: buildGpx(withTime, activityName), fileName: toFileName(activityName) };
}

// ---- last ned GPX
router.post("/generate-gpx", async (req, res) => {
  try {
    const { gpx, fileName } = await buildActivityGpx(GpxRequestSchema.parse(req.body));
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

// ---- Strava: OAuth + opplasting
router.get("/strava/status", (_req, res) => res.json(strava.status()));

router.get("/strava/auth", (_req, res) => {
  try {
    res.redirect(strava.authorizeUrl());
  } catch (e:any) {
    res.status(500).type("text/plain").send(e?.message || "Strava is not configured");
  }
});

router.get("/strava/callback", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  try {
    await strava.handleCallback(q);
    res.redirect(`${frontendUrl()}/?strava=connected`);
  } catch (e:any) {
    res.redirect(`${frontendUrl()}/?strava_error=${encodeURIComponent(e?.message || "Strava connection failed")}`);
  }
});

router.post("/strava/disconnect", (_req, res) => {
  strava.disconnect();
  res.json({ connected: false });
});

router.post("/strava/upload", async (req, res) => {
  try {
    const parsed = GpxRequestSchema.parse(req.body);
    const { gpx, fileName } = await buildActivityGpx(parsed);
    const result = await strava.uploadGpx({
      gpx,
      fileName,
      name: parsed.name,
      description: parsed.description
    });
    res.status(result.state === "ready" ? 201 : 202).json(result);
  } catch (e:any) {
    res.status(400).json({ error: e?.message || "Strava upload failed" });
  }
});

export default router;
