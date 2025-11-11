import { useEffect, useRef, useState } from "react";
import mapboxgl, { type LngLatLike, Map } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

// --- ENV ---
const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:4000") as string;
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN as string;

// --- Hjelpetyper ---
type LngLat = { lng: number; lat: number };

// --- Sikkerhet: sjekk token tydelig ---
function assertToken() {
  const t = mapboxgl.accessToken;
  if (!t || typeof t !== "string" || t.length < 30 || !t.startsWith("pk.")) {
    const msg =
      "Mapbox-token mangler eller er ugyldig. Sett VITE_MAPBOX_TOKEN i frontend/.env og restart dev-serveren.";
    console.error(msg, { tokenPreview: t ? t.slice(0, 6) + "..." : "(none)" });
    alert(msg);
    throw new Error(msg);
  }
}

export default function App() {
  const mapRef = useRef<Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [waypoints, setWaypoints] = useState<LngLat[]>([]);
  const [snappedCoords, setSnappedCoords] = useState<[number, number][]>([]);
  const [profile, setProfile] =
    useState<"walking" | "cycling" | "driving">("walking");
  const [paceSecPerKm, setPaceSecPerKm] = useState<number>(300); // 5:00
  const [spacingM, setSpacingM] = useState<number>(75);
  const [startISO, setStartISO] = useState<string>(
    new Date().toISOString().slice(0, 16) // yyyy-MM-ddTHH:mm
  );
  const [busy, setBusy] = useState(false);

  // --- Init kart ---
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    assertToken();

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12", // <- Viktig
      center: [10.75, 59.91] as LngLatLike, // Oslo
      zoom: 12,
    });

    // nyttig for feilsøking
    map.on("error", (e) =>
      console.error("Mapbox error:", (e as any)?.error?.message || e)
    );
    map.on("styledata", () => {
      // console.log("styledata");
    });

    map.on("load", () => {
      // Kilder
      map.addSource("waypoints", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addSource("temp-line", {
        type: "geojson",
        data: emptyLineString(),
      });
      map.addSource("route", {
        type: "geojson",
        data: emptyLineString(),
      });

      // Lag
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-width": 4, "line-color": "#1d4ed8" },
      });
      map.addLayer({
        id: "temp-line",
        type: "line",
        source: "temp-line",
        paint: {
          "line-width": 2,
          "line-color": "#9ca3af",
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "waypoints",
        type: "circle",
        source: "waypoints",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ef4444",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fff",
        },
      });
    });

    // Klikk for å legge til waypoint
    map.on("click", (e) => {
      const p = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      setWaypoints((prev) => [...prev, p]);
    });

    mapRef.current = map;

    // Viktig i React StrictMode: nullstill ref ved unmount
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Oppdater waypoints i kartet
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const wpSource = map.getSource("waypoints") as mapboxgl.GeoJSONSource;
    wpSource?.setData({
      type: "FeatureCollection",
      features: waypoints.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {},
      })),
    });

    const tempLine = map.getSource("temp-line") as mapboxgl.GeoJSONSource;
    tempLine?.setData({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: waypoints.map((p) => [p.lng, p.lat]),
      },
      properties: {},
    });
  }, [waypoints]);

  // Oppdater snappet rute i kartet
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const routeSrc = map.getSource("route") as mapboxgl.GeoJSONSource;
    routeSrc?.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: snappedCoords },
      properties: {},
    });
  }, [snappedCoords]);

  // Helpers
  function emptyFeatureCollection(): GeoJSON.FeatureCollection {
    return { type: "FeatureCollection", features: [] };
  }
  function emptyLineString(): GeoJSON.Feature {
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: {},
    };
  }

  async function snapToRoad() {
    if (waypoints.length < 2) return alert("Trenger minst to punkter");
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          spacingM,
          points: waypoints,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Route failed");
      setSnappedCoords(data.geometry.coordinates);
      fitToLine(data.geometry.coordinates as [number, number][]);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function fitToLine(coords: [number, number][]) {
    const map = mapRef.current!;
    if (!coords.length) return;
    const b = new mapboxgl.LngLatBounds(coords[0], coords[0]);
    coords.forEach((c) => b.extend(c as any));
    map.fitBounds(b, { padding: 40, duration: 400 });
  }

  function clearAll() {
    setWaypoints([]);
    setSnappedCoords([]);
  }

  async function downloadGpx() {
    if (waypoints.length < 2) return alert("Trenger minst to punkter");
    setBusy(true);
    try {
      const iso =
        startISO.length === 16
          ? new Date(startISO).toISOString()
          : new Date().toISOString();

      const res = await fetch(`${API_BASE}/api/generate-gpx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          spacingM,
          paceSecPerKm,
          points: waypoints,
          startTimeISO: iso,
          // elevation er av som default i backend
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "route.gpx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="toolbar">
        <strong>StravaJockey (demo)</strong>
        <span className="badge">Klikk i kartet for å legge til punkter</span>
        <div className="spacer" />
        <label>
          Profil:&nbsp;
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value as any)}
          >
            <option value="walking">Walking</option>
            <option value="cycling">Cycling</option>
            <option value="driving">Driving</option>
          </select>
        </label>
        <label>
          Spacing (m):&nbsp;
          <input
            type="number"
            value={spacingM}
            min={10}
            max={500}
            onChange={(e) => setSpacingM(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </label>
        <label>
          Pace (s/km):&nbsp;
          <input
            type="number"
            value={paceSecPerKm}
            min={120}
            max={1200}
            onChange={(e) => setPaceSecPerKm(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </label>
        <label>
          Start:&nbsp;
          <input
            type="datetime-local"
            value={startISO}
            onChange={(e) => setStartISO(e.target.value)}
          />
        </label>
        <button onClick={snapToRoad} disabled={busy}>
          Snap to road
        </button>
        <button onClick={downloadGpx} disabled={busy}>
          Download GPX
        </button>
        <button onClick={clearAll} disabled={busy}>
          Clear
        </button>
      </div>

      <div className="map-container">
        {/* Viktig: container må ha høyde via CSS (styles.css) */}
        <div id="map" ref={containerRef} />
      </div>
    </div>
  );
}