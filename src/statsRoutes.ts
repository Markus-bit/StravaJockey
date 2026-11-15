import { Router, type Request } from "express";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  DEVICES, EVENTS, SOURCES, countEvent, countryFrom, hourOf, readStats, statsEnabled, statsTimeZone,
} from "./services/stats";
import { logger } from "./logger";

const router = Router();

// ---- The site reports what happened (sent with navigator.sendBeacon, so no answer is needed)
const EventSchema = z.object({
  name: z.enum(EVENTS).exclude(["gpx_generated"]), // only the server counts that one
  device: z.enum(DEVICES).optional(),
  source: z.enum(SOURCES).optional(),
});

router.post("/event", async (req, res) => {
  const parsed = EventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Unknown event." });
  const { name, device, source } = parsed.data;
  const extra: string[] = [];
  if (name === "visit") {
    if (device) extra.push(`device:${device}`);
    extra.push(`source:${source ?? "direct"}`);
    const country = countryFrom(req.headers["x-vercel-ip-country"]);
    if (country) extra.push(`country:${country}`);
    extra.push(`hour_visit:${hourOf(new Date())}`);
  }
  await countEvent(name, extra); // awaited: a Vercel function stops once it has answered
  res.status(204).end();
});

// ---- Stats for the dashboard at /stats (password in STATS_PASSWORD)
function passwordOk(req: Request): boolean {
  const expected = process.env.STATS_PASSWORD;
  const header = req.headers.authorization ?? "";
  if (!expected) return false;
  let given: string | null = null;
  if (header.startsWith("Bearer ")) given = header.slice(7);
  else if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    given = decoded.slice(decoded.indexOf(":") + 1); // any username
  }
  if (given === null) return false;
  // constant-time comparison (only the length can be told apart, which is fine)
  const a = Buffer.from(given, "utf8"), b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

router.get("/stats", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  // Old bookmark of /api/stats in a browser: send it to the dashboard
  if (req.accepts(["json", "html"]) === "html") return res.redirect(302, "/stats/");
  if (!process.env.STATS_PASSWORD) return res.status(404).json({ error: "Stats are switched off (STATS_PASSWORD is not set)." });
  if (!passwordOk(req)) return res.status(401).json({ error: "Wrong password." });
  if (!statsEnabled()) {
    return res.status(503).json({ error: "Stats storage is not connected (KV_REST_API_URL / KV_REST_API_TOKEN missing)." });
  }
  // up to two years, so the dashboard can compare a year with the year before
  const days = z.coerce.number().int().min(1).max(730).catch(60).parse(req.query.days);
  try {
    res.json({ timeZone: statsTimeZone(), generatedAt: new Date().toISOString(), days: await readStats(days) });
  } catch (e) {
    logger.error({ err: (e as Error)?.message }, "Could not read stats");
    res.status(502).json({ error: "Could not read the stats right now. Try again in a moment." });
  }
});

export default router;
