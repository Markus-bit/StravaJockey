import { describe, expect, it } from "vitest";
import { buildGpx } from "../src/services/gpx";

const pts = [
  { lat: 59.9, lng: 10.7, elevationM: 12.345, timeISO: "2026-01-01T10:00:00.000Z", heartRateBpm: 120 },
  { lat: 59.90001, lng: 10.70001, elevationM: null, timeISO: "2026-01-01T10:00:05.000Z", heartRateBpm: 121 },
];

describe("buildGpx", () => {
  it("writes a GPX 1.1 track with name, type, time, elevation and heart rate", () => {
    const g = buildGpx(pts, { name: "Morning Run", type: "running" });
    expect(g.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(g).toContain('<gpx version="1.1" creator="StravaJockey"');
    expect(g.match(/<name>Morning Run<\/name>/g)).toHaveLength(2); // metadata + track
    expect(g).toContain("<type>running</type>");
    expect(g.match(/<trkpt /g)).toHaveLength(2);
    expect(g).toContain('<trkpt lat="59.9000000" lon="10.7000000">');
    expect(g).toContain("<ele>12.35</ele>");
    expect(g.match(/<ele>/g)).toHaveLength(1); // point without elevation has no <ele>
    expect(g).toContain("<gpxtpx:hr>121</gpxtpx:hr>");
    expect(g.trim().endsWith("</gpx>")).toBe(true);
  });

  it("escapes special characters and drops control characters", () => {
    const g = buildGpx(pts, { name: 'A & B <c> "d" 🏃\u0001', description: "x<y" });
    expect(g).toContain("<name>A &amp; B &lt;c&gt; \"d\" 🏃</name>");
    expect(g).toContain("<desc>x&lt;y</desc>");
  });

  it("leaves out heart rate when there is none", () => {
    const g = buildGpx(pts.map((p) => ({ ...p, heartRateBpm: undefined })), { name: "x" });
    expect(g).not.toContain("gpxtpx:hr");
    expect(g).not.toContain("<type>");
  });
});
