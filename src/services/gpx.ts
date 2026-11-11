import { MatchedPoint } from "../domain/types";

export type GpxActivityType = "running" | "cycling";

// Name of the app that made the file (GPX "creator" attribute). Follows SITE_NAME.
const GPX_CREATOR = process.env.SITE_NAME || "StravaJockey";

// GPX 1.1 writer. Plain string building (no XML library): the format is small and fixed,
// and it avoids bundling problems on serverless hosts.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // control characters other than tab/newline aren't allowed in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function buildGpx(
  points: MatchedPoint[],
  opts: { name?: string; description?: string; type?: GpxActivityType } = {}
): string {
  const name = esc(opts.name || "Generated Route");
  const desc = opts.description ? esc(opts.description) : null;
  const hasHr = points.some(p => typeof p.heartRateBpm === "number");

  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="${esc(GPX_CREATOR)}" xmlns="http://www.topografix.com/GPX/1/1" ` +
      `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      // Garmin TrackPointExtension: standard måte å legge puls i GPX (leses av Strava m.fl.)
      `xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" ` +
      `xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd ` +
      `http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd">`,
    `  <metadata>`,
    `    <name>${name}</name>`,
  ];
  if (desc) out.push(`    <desc>${desc}</desc>`);
  if (points[0]?.timeISO) out.push(`    <time>${esc(points[0].timeISO)}</time>`);
  out.push(`  </metadata>`, `  <trk>`, `    <name>${name}</name>`);
  // GPX 1.1 krever rekkefølgen name, desc, ..., type, trkseg
  if (desc) out.push(`    <desc>${desc}</desc>`);
  if (opts.type) out.push(`    <type>${opts.type}</type>`);
  out.push(`    <trkseg>`);

  for (const p of points) {
    out.push(`      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">`);
    if (typeof p.elevationM === "number") out.push(`        <ele>${p.elevationM.toFixed(2)}</ele>`);
    if (p.timeISO) out.push(`        <time>${esc(p.timeISO)}</time>`);
    if (hasHr && typeof p.heartRateBpm === "number") {
      out.push(
        `        <extensions>`,
        `          <gpxtpx:TrackPointExtension>`,
        `            <gpxtpx:hr>${Math.round(p.heartRateBpm)}</gpxtpx:hr>`,
        `          </gpxtpx:TrackPointExtension>`,
        `        </extensions>`
      );
    }
    out.push(`      </trkpt>`);
  }

  out.push(`    </trkseg>`, `  </trk>`, `</gpx>`);
  return out.join("\n");
}
