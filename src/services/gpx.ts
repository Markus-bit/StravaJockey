import { create } from "xmlbuilder2";
import { MatchedPoint } from "../domain/types";

export type GpxActivityType = "running" | "cycling";

export function buildGpx(
  points: MatchedPoint[],
  opts: { name?: string; description?: string; type?: GpxActivityType } = {}
): string {
  const name = opts.name || "Generated Route";
  const hasHr = points.some(p => typeof p.heartRateBpm === "number");

  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("gpx", {
      version: "1.1",
      creator: "fake-run-backend",
      xmlns: "http://www.topografix.com/GPX/1/1",
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      // Garmin TrackPointExtension: standard måte å legge puls i GPX (leses av Strava m.fl.)
      "xmlns:gpxtpx": "http://www.garmin.com/xmlschemas/TrackPointExtension/v1",
      "xsi:schemaLocation":
        "http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd " +
        "http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd"
    });

  const meta = root.ele("metadata");
  meta.ele("name").txt(name);
  if (opts.description) meta.ele("desc").txt(opts.description);
  if (points[0]?.timeISO) meta.ele("time").txt(points[0].timeISO);

  // GPX 1.1 krever rekkefølgen name, desc, ..., type, trkseg
  const trk = root.ele("trk");
  trk.ele("name").txt(name);
  if (opts.description) trk.ele("desc").txt(opts.description);
  if (opts.type) trk.ele("type").txt(opts.type);
  const seg = trk.ele("trkseg");

  for (const p of points) {
    const trkpt = seg.ele("trkpt", { lat: p.lat.toFixed(7), lon: p.lng.toFixed(7) });
    if (typeof p.elevationM === "number") trkpt.ele("ele").txt(p.elevationM.toFixed(2));
    if (p.timeISO) trkpt.ele("time").txt(p.timeISO);
    if (hasHr && typeof p.heartRateBpm === "number") {
      trkpt.ele("extensions")
        .ele("gpxtpx:TrackPointExtension")
          .ele("gpxtpx:hr").txt(String(p.heartRateBpm));
    }
  }

  return root.end({ prettyPrint: true });
}
