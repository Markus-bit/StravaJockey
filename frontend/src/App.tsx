import { useEffect, useRef, useState } from "react";
import mapboxgl, { type LngLatLike, Map } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import locateIcon from "./assets/my-location.png";

// --- ENV ---
// Vite proxy forwards '/api' -> http://localhost:4000 in dev, so we call relative paths.
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

function formatPace(value: number) {
  const minutes = Math.floor(value);
  const seconds = Math.round((value - minutes) * 60);
  const padded = seconds.toString().padStart(2, "0");
  return `${minutes}:${padded} min/km`;
}

export default function App() {
  const mapRef = useRef<Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [waypoints, setWaypoints] = useState<LngLat[]>([]);
  const [snappedCoords, setSnappedCoords] = useState<[number, number][]>([]);
  const [profile, setProfile] = useState<"walking" | "cycling" | "driving">("walking");
  const [paceMinPerKm, setPaceMinPerKm] = useState<number>(5.0);
  const [spacingM, setSpacingM] = useState<number>(75);
  const [startISO, setStartISO] = useState<string>(
    new Date().toISOString().slice(0, 16) // yyyy-MM-ddTHH:mm
  );
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [totalDistanceKm, setTotalDistanceKm] = useState<number | null>(null);
  const hasSnapCandidate = waypoints.length >= 2;

  // --- Init kart ---
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    assertToken();

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12", // <- Viktig
      center: [10.75, 59.91] as LngLatLike, // Oslo
      zoom: 12,
      attributionControl: false,
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
    // Ta vare på punktene som skal sendes
    const pts = [...waypoints];

    // Skjul gamle punkter og stiplet linje umiddelbart i UI
    clearTempOverlays();
    setWaypoints([]); // trigger også useEffect som holder kildene i sync

    const res = await fetch(`/api/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile,
        spacingM,
        points: pts,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Route failed");

    setSnappedCoords(data.geometry.coordinates);
    if (typeof data.distanceM === "number") {
      setTotalDistanceKm(Number((data.distanceM / 1000).toFixed(2)));
    } else {
      setTotalDistanceKm(null);
    }
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

  function clearTempOverlays() {
    const map = mapRef.current;
    if (!map) return;

    const emptyLine: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: {},
    };
    // Tøm stiplet “temp-line” og punkt-kilden “waypoints”
    (map.getSource("temp-line") as mapboxgl.GeoJSONSource | undefined)?.setData(emptyLine as any);
}

  function clearSourcesOnMap() {
    const map = mapRef.current;
    if (!map) return;

    const emptyLine: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: {},
    };
    const emptyFC: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };

    (map.getSource("route") as mapboxgl.GeoJSONSource | undefined)?.setData(emptyLine as any);
    (map.getSource("temp-line") as mapboxgl.GeoJSONSource | undefined)?.setData(emptyLine as any);
    (map.getSource("waypoints") as mapboxgl.GeoJSONSource | undefined)?.setData(emptyFC as any);
}
  function clearAll() {
    setWaypoints([]);
    setSnappedCoords([]);
    setTotalDistanceKm(null);
    clearSourcesOnMap();
  }

  function centerOnUser() {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) {
      alert("Geolocation ikke støttet i denne nettleseren");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14) });
        setLocating(false);
      },
      (err) => {
        const msg = err.message || "Kunne ikke hente posisjon";
        alert(msg);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function downloadGpx() {
    if (waypoints.length < 2) return alert("Trenger minst to punkter");
    setBusy(true);
    try {
      const iso =
        startISO.length === 16
          ? new Date(startISO).toISOString()
          : new Date().toISOString();

      const res = await fetch(`/api/generate-gpx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          spacingM,
          paceSecPerKm: Math.round(paceMinPerKm * 60),
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
      <header className="app-header">
        <strong className="app-logo">StravaJockey</strong>
        <div className="header-actions">
          <button type="button">Dashboard</button>
          <button type="button">Activities</button>
          <button type="button">Settings</button>
        </div>
      </header>
      <div className="content">
        <div className="left-column">
          <section className="map-panel">
            <div className="map-panel-header">
              <h2>Map preview</h2>
              <span className="map-header-tip">Click on the map to create your route</span>
            </div>
            <div className="map-container">
              <div id="map" ref={containerRef} />
              <button
                className="locate-button"
                onClick={centerOnUser}
                disabled={locating}
                title="Center map on your location"
              >
                <img src={locateIcon} alt="Locate" />
              </button>
              {hasSnapCandidate && (
                <button
                  className="map-action map-action--snap"
                  onClick={snapToRoad}
                  disabled={busy}
                >
                  Snap to road
                </button>
              )}
            </div>
          </section>
          <section className="stats-panel">
            <h2>Route stats</h2>
            <div className="stats-scroll" />
          </section>
        </div>
        <section className="controls-panel">
          <h2>Route setup</h2>
          <div className="form-grid">
            <label>
              <span>Profil</span>
              <select value={profile} onChange={(e) => setProfile(e.target.value as any)}>
                <option value="walking">Walking</option>
                <option value="cycling">Cycling</option>
                <option value="driving">Driving</option>
              </select>
            </label>
            <label>
              <span>Spacing (m)</span>
              <input
                type="number"
                value={spacingM}
                min={10}
                max={500}
                onChange={(e) => setSpacingM(Number(e.target.value))}
              />
            </label>
            <label className="pace-control">
              <span>Pace: {formatPace(paceMinPerKm)}</span>
              <input
                type="range"
                min={1}
                max={15}
                step={0.1}
                value={paceMinPerKm}
                onChange={(e) => setPaceMinPerKm(Number(e.target.value))}
              />
            </label>
            <label>
              <span>Start</span>
              <input
                type="datetime-local"
                value={startISO}
                onChange={(e) => setStartISO(e.target.value)}
              />
            </label>
          </div>
          <div className="action-row">
            <button onClick={downloadGpx} disabled={busy}>
              Download GPX
            </button>
            <button onClick={clearAll} disabled={busy}>
              Clear
            </button>
          </div>
          {totalDistanceKm !== null && (
            <div className="distance-card">
              Total distance: <strong>{totalDistanceKm} km</strong>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
