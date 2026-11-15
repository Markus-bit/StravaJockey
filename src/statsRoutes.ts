import { Router, type Request } from "express";
import { timingSafeEqual, createHash } from "crypto";
import { z } from "zod";
import { EVENTS, countEvent, readStats, statsEnabled, type DayCounts, type StatsEvent } from "./services/stats";
import { logger } from "./logger";

const router = Router();

// ---- The site reports what happened (sent with navigator.sendBeacon, so no answer is needed)
router.post("/event", async (req, res) => {
  const parsed = z.object({ name: z.enum(EVENTS) }).safeParse(req.body);
  if (!parsed.success || parsed.data.name === "gpx_generated") {
    return res.status(400).json({ error: "Unknown event." });
  }
  await countEvent(parsed.data.name); // awaited: a Vercel function stops once it has answered
  res.status(204).end();
});

// ---- Private stats page: /api/stats, password in STATS_PASSWORD (browser login prompt)
function passwordOk(req: Request): boolean {
  const expected = process.env.STATS_PASSWORD;
  const header = req.headers.authorization ?? "";
  if (!expected || !header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const given = decoded.slice(decoded.indexOf(":") + 1); // any username
  // compare hashes so the comparison takes the same time whatever the input
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

router.get("/stats", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!process.env.STATS_PASSWORD) return res.status(404).json({ error: "Not found." });
  if (!passwordOk(req)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="StravaJockey stats", charset="UTF-8"');
    return res.status(401).type("text/plain").send("Password required.");
  }
  if (!statsEnabled()) {
    return res.status(503).type("text/plain").send("Stats storage is not connected (KV_REST_API_URL / KV_REST_API_TOKEN missing).");
  }
  const days = z.coerce.number().int().min(1).max(365).catch(30).parse(req.query.days);
  try {
    const data = await readStats(days);
    if (req.query.format === "json") return res.json({ days: data });
    res.type("html").send(renderPage(data, days));
  } catch (e) {
    logger.error({ err: (e as Error)?.message }, "Could not read stats");
    res.status(502).type("text/plain").send("Could not read the stats right now. Try again in a moment.");
  }
});

export default router;

// ---------------------------------------------------------------------------

const COLUMNS: { key: StatsEvent; label: string }[] = [
  { key: "visit", label: "Visits" },
  { key: "snap_click", label: "Snap clicks" },
  { key: "snap_success", label: "Snapped" },
  { key: "snap_error", label: "Snap errors" },
  { key: "download_click", label: "Download clicks" },
  { key: "download_success", label: "Downloads" },
  { key: "download_error", label: "Download errors" },
  { key: "gpx_generated", label: "GPX made (server)" },
  { key: "help_how_it_works", label: "How it works" },
  { key: "help_how_to_upload", label: "How to upload" },
  { key: "help_terms", label: "Terms" },
];

function pct(a: number, b: number) {
  return b > 0 ? `${Math.round((a / b) * 100)} %` : "–";
}

function renderPage(data: DayCounts[], days: number): string {
  const total = (k: StatsEvent) => data.reduce((s, d) => s + (d.counts[k] ?? 0), 0);
  const max = Math.max(1, ...data.map((d) => d.counts.download_success ?? 0));
  const cards: [string, string, string][] = [
    ["Visits", String(total("visit")), ""],
    ["Download clicks", String(total("download_click")), ""],
    ["Downloads", String(total("download_success")), `${pct(total("download_success"), total("download_click"))} of clicks`],
    ["Visits that downloaded", pct(total("download_success"), total("visit")), "downloads ÷ visits"],
  ];
  const ranges = [7, 30, 90, 365]
    .map((n) => (n === days ? `<b>${n} days</b>` : `<a href="?days=${n}">${n} days</a>`))
    .join(" · ");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>StravaJockey stats</title>
<style>
  :root { color-scheme: light; --brand: #fc4c02; }
  body { margin: 0; padding: 24px 16px; font: 14px/1.4 system-ui, -apple-system, sans-serif; color: #111827; background: #f3f4f6; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #6b7280; margin: 0 0 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .card { background: #fff; border-radius: 12px; padding: 16px; }
  .card .label { color: #6b7280; font-size: 13px; }
  .card .value { font-size: 28px; font-weight: 800; margin-top: 4px; }
  .card .note { color: #6b7280; font-size: 12px; }
  .wrap { background: #fff; border-radius: 12px; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; white-space: nowrap; }
  th, td { padding: 8px 10px; text-align: right; border-bottom: 1px solid #f3f4f6; }
  th:first-child, td:first-child { text-align: left; }
  th { font-size: 12px; color: #6b7280; font-weight: 600; }
  td.zero { color: #d1d5db; }
  td.bars { text-align: left; }
  .bar { display: inline-block; height: 8px; border-radius: 4px; background: var(--brand); vertical-align: middle; margin-right: 6px; }
  tfoot td { font-weight: 700; }
  a { color: var(--brand); }
</style></head><body><main>
<h1>StravaJockey stats</h1>
<p class="sub">Counts per day (${escapeHtml(process.env.STATS_TIMEZONE || "Europe/Oslo")}). ${ranges} · <a href="?days=${days}&format=json">JSON</a></p>
<div class="cards">${cards
    .map(([l, v, n]) => `<div class="card"><div class="label">${l}</div><div class="value">${v}</div><div class="note">${n}</div></div>`)
    .join("")}</div>
<div class="wrap"><table>
<thead><tr><th>Day</th><th>Downloads</th>${COLUMNS.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
<tbody>${data
    .map((d) => {
      const dl = d.counts.download_success ?? 0;
      const bar = `<span class="bar" style="width:${Math.round((dl / max) * 80)}px"></span>`;
      return `<tr><td>${d.day}</td><td class="bars">${dl ? bar : ""}</td>${COLUMNS.map((c) => {
        const v = d.counts[c.key] ?? 0;
        return `<td${v ? "" : ' class="zero"'}>${v}</td>`;
      }).join("")}</tr>`;
    })
    .join("")}</tbody>
<tfoot><tr><td>Total</td><td></td>${COLUMNS.map((c) => `<td>${total(c.key)}</td>`).join("")}</tr></tfoot>
</table></div>
</main></body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
