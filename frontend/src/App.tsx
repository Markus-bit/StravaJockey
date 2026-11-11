import { useEffect, useRef, useState } from "react";
import mapboxgl, { type LngLatLike, Map } from "mapbox-gl";
import locateIcon from "./assets/my-location.png";
import RunDetails from "./RunDetails";
import HelpDialog, { type HelpTopic } from "./HelpDialogs";
import {
  type ActivitySettings, type Sport,
  defaultActivityName, initialSettings, startTimeISO,
} from "./activity";

// Punktavstand i genererte spor (meter). Samme verdi for forhåndsvisning og GPX
// slik at høydemeter i statistikken stemmer med fila.
const SPACING_M = 25;
const routingProfile = (sport: Sport) => (sport === "bike" ? "cycling" : "walking");

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

function gpxFileName(name: string) {
  const base = name.replace(/[\\/:*?"<>|]/g, "").trim();
  return `${base || "route"}.gpx`;
}

export default function App() {
  const mapRef = useRef<Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [waypoints, setWaypoints] = useState<LngLat[]>([]);
  // Waypoints behind the currently shown snapped route (waypoints are cleared after snapping)
  const [routePoints, setRoutePoints] = useState<LngLat[]>([]);
  const [snappedCoords, setSnappedCoords] = useState<[number, number][]>([]);
  const [settings, setSettings] = useState<ActivitySettings>(initialSettings);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);
  const [locating, setLocating] = useState(false);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [elevationGainM, setElevationGainM] = useState<number | null>(null);
  const [elevationLoading, setElevationLoading] = useState(false);
  const [elevationError, setElevationError] = useState<string | null>(null);
  // Øker for hver ny rute, så et sent høydesvar for en gammel rute ignoreres
  const routeRequestId = useRef(0);
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

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    let msg = errText;
    try { msg = JSON.parse(errText)?.error || errText; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res;
}

function snapToRoad() {
  if (waypoints.length < 2) return alert("Trenger minst to punkter");
  const pts = [...waypoints];
  // Skjul gamle punkter og stiplet linje umiddelbart i UI
  clearTempOverlays();
  setWaypoints([]); // trigger også useEffect som holder kildene i sync
  return snapPoints(pts, settings.sport);
}

// Hent snappet rute (rask), og deretter høydemeter i bakgrunnen (tregt: ~1 s per 100 punkter)
async function snapPoints(pts: LngLat[], sport: Sport) {
  const id = ++routeRequestId.current;
  const body = { profile: routingProfile(sport), spacingM: SPACING_M, points: pts };
  setBusy(true);
  try {
    const data = await (await postJson(`/api/route`, body)).json();
    if (id !== routeRequestId.current) return;
    setSnappedCoords(data.geometry.coordinates);
    setRoutePoints(pts);
    setDistanceM(typeof data.distanceM === "number" ? data.distanceM : null);
    setElevationGainM(null);
    setElevationError(null);
    fitToLine(data.geometry.coordinates as [number, number][]);
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
    return;
  } finally {
    setBusy(false);
  }

  setElevationLoading(true);
  try {
    const data = await (await postJson(`/api/route`, { ...body, includeElevation: true })).json();
    if (id === routeRequestId.current) {
      setElevationGainM(data.elevationGainM ?? null);
      setElevationError(data.elevationError ?? null);
    }
  } catch (e) {
    // høydemeter er valgfritt; vis "–" og årsaken
    if (id === routeRequestId.current) setElevationError(e instanceof Error ? e.message : String(e));
  } finally {
    if (id === routeRequestId.current) setElevationLoading(false);
  }
}

function updateSettings(patch: Partial<ActivitySettings>) {
  setSettings((prev) => ({ ...prev, ...patch }));
  // Run og Bike bruker ulike veinett (gangstier vs sykkelveier): snapp ruten på nytt
  if (patch.sport && patch.sport !== settings.sport && routePoints.length >= 2 && waypoints.length < 2) {
    snapPoints(routePoints, patch.sport);
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
    // Tøm stiplet “temp-line” (waypoints-kilden tømmes via setWaypoints([]))
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
    setRoutePoints([]);
    setSnappedCoords([]);
    setDistanceM(null);
    setElevationGainM(null);
    setElevationError(null);
    setElevationLoading(false);
    routeRequestId.current++;
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
    // Prefer newly clicked points; otherwise use the points behind the snapped route
    const pts = waypoints.length >= 2 ? waypoints : routePoints;
    if (pts.length < 2) return alert("Trenger minst to punkter");
    const s = settings;
    const name = s.name.trim() || defaultActivityName(s.sport, s.hour);
    setBusy(true);
    setDownloading(true);
    try {
      const res = await postJson(`/api/generate-gpx`, {
        profile: routingProfile(s.sport),
        activityType: s.sport === "bike" ? "cycling" : "running",
        spacingM: SPACING_M,
        points: pts,
        paceSecPerKm: s.paceSecPerKm,
        paceVariability: s.paceVariabilityPct / 100,
        heartRate: s.hrEnabled
          ? { avgBpm: s.hrAvgBpm, variability: s.hrVariabilityPct / 100 }
          : undefined,
        name,
        description: s.description.trim() || undefined,
        startTimeISO: startTimeISO(s),
        includeElevation: true,
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = gpxFileName(name);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setDownloading(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <strong className="app-logo">StravaJockey</strong>
        <div className="header-actions">
          <button type="button" onClick={() => setHelpTopic("how-it-works")}>
            How it works
          </button>
          <button type="button" onClick={() => setHelpTopic("how-to-upload")}>
            How to upload
          </button>
        </div>
      </header>
      <HelpDialog topic={helpTopic} onClose={() => setHelpTopic(null)} />
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
                className={`locate-button${locating ? " locating" : ""}`}
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
        </div>
        <RunDetails
          settings={settings}
          onChange={updateSettings}
          distanceM={distanceM}
          elevationGainM={elevationGainM}
          elevationLoading={elevationLoading}
          elevationError={elevationError}
          busy={busy}
          downloading={downloading}
          onDownload={downloadGpx}
          onClear={clearAll}
        />
      </div>
      <footer className="app-footer">
        <span className="footer-copy">© {new Date().getFullYear()} StravaJockey. All rights reserved.</span>
        <nav className="footer-links" aria-label="Footer">
          <button type="button" onClick={() => setHelpTopic("terms")}>
            Terms of Service
          </button>
          <button type="button" onClick={() => setHelpTopic("how-it-works")}>
            How It Works
          </button>
          <button type="button" onClick={() => setHelpTopic("how-to-upload")}>
            How To Upload
          </button>
        </nav>
      </footer>
    </div>
  );
}
