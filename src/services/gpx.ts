import { create } from "xmlbuilder2";
import { MatchedPoint } from "../domain/types";

export function buildGpx(points: MatchedPoint[], name = "Generated Route"): string {
  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele("gpx", {
      version: "1.1",
      creator: "fake-run-backend",
      xmlns: "http://www.topografix.com/GPX/1/1",
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "xsi:schemaLocation":
        "http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"
    })
    .ele("metadata")
      .ele("name").txt(name).up()
    .up()
    .ele("trk")
      .ele("name").txt(name).up()
      .ele("trkseg");

  for (const p of points) {
    const trkpt = doc.ele("trkpt", { lat: p.lat.toFixed(7), lon: p.lng.toFixed(7) });
    if (typeof p.elevationM === "number") trkpt.ele("ele").txt(p.elevationM.toFixed(2)).up();
    if (p.timeISO) trkpt.ele("time").txt(p.timeISO).up();
    trkpt.up();
  }

  return doc.end({ prettyPrint: true });
}