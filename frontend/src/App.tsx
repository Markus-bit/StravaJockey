import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { type LngLatLike, Map } from "mapbox-gl";
import locateIcon from "./assets/my-location.png";
import { Route as RouteIcon } from "lucide-react";
import { Analytics } from "@vercel/analytics/react";
import RunDetails from "./RunDetails";
import HelpDialog, { type HelpTopic } from "./HelpDialogs";
import { track, trackVisit } from "./track";
import Toasts, { type Toast } from "./Toasts";
import { initialMapView, saveMapView } from "./mapStart";
import ActivityCharts, { type ActivityPreview, type ElevationProfile } from "./ActivityCharts";
import {
  type ActivitySettings, type Sport,
  initialSettings, localDateString, startTimeISO,
} from "./activity";

// Point spacing in generated tracks (metres). Same value for the preview and the GPX,
// so the elevation gain in the stats matches the file.
const SPACING_M = 25;
const routingProfile = (sport: Sport) => (sport === "bike" ? "cycling" : "walking");

// --- ENV ---
// Vite proxy forwards '/api' -> http://localhost:4000 in dev, so we call relative paths.
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN as string;

// --- Hjelpetyper ---
type LngLat = { lng: number; lat: number };

// --- Check the public Mapbox token before creating the map ---
function hasValidToken() {
  const t = mapboxgl.accessToken;
  const ok = !!t && typeof t === "string" && t.length >= 30 && t.startsWith("pk.");
  if (!ok) {
    console.error("VITE_MAPBOX_TOKEN is missing or invalid. Set it in frontend/.env and rebuild/restart.", {
      tokenPreview: t ? t.slice(0, 6) + "..." : "(none)",
    });
  }
  return ok;
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
  function openHelp(topic: HelpTopic) {
    track("help_terms");
    setHelpTopic(topic);
  }
  useEffect(() => trackVisit(), []);
  // /app/#terms (linked from the landing page) opens the Terms of Service
  useEffect(() => {
    if (location.hash === "#terms") setHelpTopic("terms");
  }, []);
  const [mapError, setMapError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  // Show an error message for a few seconds (replaces alert())
  function notify(message: string) {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.filter((t) => t.message !== message), { id, message }].slice(-3));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 7000);
  }
  const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const [locating, setLocating] = useState(false);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [elevationGainM, setElevationGainM] = useState<number | null>(null);
  const [elevationLoading, setElevationLoading] = useState(false);
  const [elevationError, setElevationError] = useState<string | null>(null);
  // Increases with every new route, so a late elevation answer for an old route is ignored
  const routeRequestId = useRef(0);
  // Seed for the random pace/heart rate variation: the charts and the GPX use the same one,
  // so the downloaded file looks exactly like the preview. New route -> new seed.
  const [seed, setSeed] = useState(randomSeed);
  const [elevationProfile, setElevationProfile] = useState<ElevationProfile | null>(null);
  const [preview, setPreview] = useState<ActivityPreview | null>(null);
  const [hoverDistM, setHoverDistM] = useState<number | null>(null);
  const hasSnapCandidate = waypoints.length >= 2;

  // --- Create the map ---
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    if (!hasValidToken()) {
      setMapError("The map can't be loaded right now. Please try again later.");
      return;
    }

    const startView = initialMapView();
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12", // <- Viktig
      center: startView.center as LngLatLike, // last position, or a city in the visitor's time zone
      zoom: startView.zoom,
    });

    // useful for debugging
    map.on("error", (e) =>
      console.error("Mapbox error:", (e as { error?: { message?: string } })?.error?.message || e)
    );
    map.on("styledata", () => {
      // console.log("styledata");
    });

    map.on("load", () => {
      // Sources
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

      // Layers
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
      map.addSource("hover-point", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "hover-point",
        type: "circle",
        source: "hover-point",
        paint: {
          "circle-radius": 6,
          "circle-color": brandColor(),
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
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

    // Remember where the visitor left the map (this browser only)
    map.on("moveend", () => {
      const c = map.getCenter();
      saveMapView({ center: [c.lng, c.lat], zoom: map.getZoom() });
    });

    // Click to add a waypoint
    map.on("click", (e) => {
      const p = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      setWaypoints((prev) => [...prev, p]);
    });

    mapRef.current = map;

    // Important in React StrictMode: reset the ref on unmount
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep the waypoint layers in sync
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

  // Keep the snapped route layer in sync
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

  // Pace / heart rate preview for the charts (cheap: no map or elevation lookups).
  // Debounced so dragging a slider doesn't send a request per pixel.
  const { paceSecPerKm, paceVariabilityPct, hrEnabled, hrAvgBpm, hrVariabilityPct } = settings;
  useEffect(() => {
    if (distanceM === null || distanceM <= 0) {
      setPreview(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/activity-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            distanceM,
            paceSecPerKm,
            paceVariability: paceVariabilityPct / 100,
            heartRate: hrEnabled ? { avgBpm: hrAvgBpm, variability: hrVariabilityPct / 100 } : undefined,
            seed,
          }),
        });
        if (res.ok) setPreview(await res.json());
      } catch {
        /* aborted or backend unreachable: keep the previous preview */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [distanceM, paceSecPerKm, paceVariabilityPct, hrEnabled, hrAvgBpm, hrVariabilityPct, seed]);

  // Cumulative distance along the snapped route, to place the chart hover on the map
  const routeDists = useMemo(() => cumulativeDistances(snappedCoords), [snappedCoords]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("hover-point") as mapboxgl.GeoJSONSource | undefined;
    const pos = hoverDistM === null ? null : pointAtDistance(snappedCoords, routeDists, hoverDistM);
    src?.setData({
      type: "FeatureCollection",
      features: pos ? [{ type: "Feature", geometry: { type: "Point", coordinates: pos }, properties: {} }] : [],
    });
  }, [hoverDistM, snappedCoords, routeDists]);

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
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    // The server always answers errors with { error: "<message for the user>" }
    let msg = "";
    try { msg = (await res.json())?.error ?? ""; } catch { /* not JSON, e.g. a proxy error page */ }
    throw new Error(msg || `Something went wrong (error ${res.status}). Please try again.`);
  }
  return res;
}

function snapToRoad() {
  if (waypoints.length < 2) return notify("Place at least two points on the map.");
  track("snap_click");
  const pts = [...waypoints];
  // Hide the old points and the dashed line right away
  clearTempOverlays();
  setWaypoints([]); // also triggers the effect that keeps the map sources in sync
  return snapPoints(pts, settings.sport, true);
}

// Fetch the snapped route (fast), then the elevation in the background
async function snapPoints(pts: LngLat[], sport: Sport, fromClick = false) {
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
    setElevationProfile(null);
    setSeed(randomSeed());
    fitToLine(data.geometry.coordinates as [number, number][]);
    if (fromClick) track("snap_success");
  } catch (e) {
    if (fromClick) track("snap_error");
    notify(errorText(e));
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
      setElevationProfile(data.elevationProfile ?? null);
    }
  } catch (e) {
    // elevation is optional; show "–" and the reason
    if (id === routeRequestId.current) setElevationError(e instanceof Error ? e.message : String(e));
  } finally {
    if (id === routeRequestId.current) setElevationLoading(false);
  }
}

function updateSettings(patch: Partial<ActivitySettings>) {
  setSettings((prev) => notInFuture({ ...prev, ...patch }));
  // Run and Bike use different networks (footpaths vs cycle routes): snap the route again
  if (patch.sport && patch.sport !== settings.sport && routePoints.length >= 2 && waypoints.length < 2) {
    snapPoints(routePoints, patch.sport);
  }
}

  function fitToLine(coords: [number, number][]) {
    const map = mapRef.current!;
    if (!coords.length) return;
    const b = new mapboxgl.LngLatBounds(coords[0], coords[0]);
    coords.forEach((c) => b.extend(c));
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
    // Clear the dashed "temp-line" (the waypoints source is cleared via setWaypoints([]))
    (map.getSource("temp-line") as mapboxgl.GeoJSONSource | undefined)?.setData(emptyLine);
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

    (map.getSource("route") as mapboxgl.GeoJSONSource | undefined)?.setData(emptyLine);
    (map.getSource("temp-line") as mapboxgl.GeoJSONSource | undefined)?.setData(emptyLine);
    (map.getSource("waypoints") as mapboxgl.GeoJSONSource | undefined)?.setData(emptyFC);
}
  function clearAll() {
    setWaypoints([]);
    setRoutePoints([]);
    setSnappedCoords([]);
    setDistanceM(null);
    setElevationGainM(null);
    setElevationError(null);
    setElevationLoading(false);
    setElevationProfile(null);
    setPreview(null);
    setHoverDistM(null);
    setSeed(randomSeed());
    routeRequestId.current++;
    clearSourcesOnMap();
  }

  function centerOnUser() {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) {
      notify("Your browser doesn't support finding your location.");
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
        notify(
          err.code === err.PERMISSION_DENIED
            ? "Location access is blocked. Allow it in your browser settings to use this button."
            : err.code === err.TIMEOUT
              ? "Finding your location took too long. Please try again."
              : "Your location isn't available right now."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function downloadGpx() {
    // Always the snapped route shown on the map (and in the charts)
    const pts = routePoints;
    const s = settings;
    const name = s.name.trim();
    if (pts.length < 2 || snappedCoords.length === 0 || !name) return; // button is disabled then
    track("download_click");
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
        seed,
        heartRate: s.hrEnabled
          ? { avgBpm: s.hrAvgBpm, variability: s.hrVariabilityPct / 100 }
          : undefined,
        name,
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
      track("download_success");
    } catch (e) {
      track("download_error");
      notify(errorText(e));
    } finally {
      setBusy(false);
      setDownloading(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <a className="brand" href="/" aria-label="StravaJockey home">
          <span className="brand-mark" aria-hidden="true">
            <RouteIcon size={18} strokeWidth={2.5} />
          </span>
          <span className="brand-name">StravaJockey</span>
        </a>
        <span className="brand-tagline">GPX route generator</span>
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
              {mapError && <div className="map-error" role="alert">{mapError}</div>}
              <button
                className={`locate-button${locating ? " locating" : ""}`}
                onClick={centerOnUser}
                disabled={locating}
                title="Center map on your location"
              >
                <img src={locateIcon} alt="Locate" />
              </button>
              <div className="map-actions">
                {hasSnapCandidate && (
                  <button className="map-action" onClick={snapToRoad} disabled={busy}>
                    Snap to road
                  </button>
                )}
                {(waypoints.length > 0 || snappedCoords.length > 0) && (
                  <button className="map-action map-action--secondary" onClick={clearAll} disabled={busy}>
                    Clear
                  </button>
                )}
              </div>
            </div>
          </section>
          <ActivityCharts
            distanceM={distanceM}
            elevation={elevationProfile}
            elevationLoading={elevationLoading}
            elevationError={elevationError}
            preview={preview}
            paceUnit={settings.paceUnit}
            hrEnabled={settings.hrEnabled}
            hoverDistM={hoverDistM}
            onHover={setHoverDistM}
          />
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
          routeReady={snappedCoords.length > 0 && routePoints.length >= 2}
        />
      </div>
      <footer className="app-footer">
        <span className="footer-copy">© {new Date().getFullYear()} StravaJockey. All rights reserved.</span>
        <nav className="footer-links" aria-label="Footer">
          <button type="button" onClick={() => openHelp("terms")}>
            Terms of Service
          </button>
        </nav>
      </footer>
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      {/* Vercel Web Analytics: cookieless page-view counting (only sends data on Vercel deployments) */}
      <Analytics />
    </div>
  );
}

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff);
}

// Same haversine distance as the backend, so chart distances line up with the map
function cumulativeDistances(coords: [number, number][]): number[] {
  const R = 6371000, rad = Math.PI / 180;
  const out = coords.length ? [0] : [];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1], [lng2, lat2] = coords[i];
    const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
    out.push(out[i - 1] + 2 * R * Math.asin(Math.sqrt(h)));
  }
  return out;
}

function pointAtDistance(coords: [number, number][], dists: number[], d: number): [number, number] | null {
  if (coords.length < 2) return null;
  let lo = 0, hi = dists.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dists[mid] < d) lo = mid;
    else hi = mid;
  }
  const span = dists[hi] - dists[lo];
  const t = span > 0 ? Math.min(Math.max((d - dists[lo]) / span, 0), 1) : 0;
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
}

// The brand color from the stylesheet (--brand in index.css), for map layers that can't use CSS
function brandColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#fc4c02";
}

// An activity can't start in the future: clamp date + start time to now
function notInFuture(s: ActivitySettings): ActivitySettings {
  const [y, m, d] = s.date.split("-").map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1, s.hour, s.minute);
  const now = new Date();
  if (isNaN(start.getTime()) || start <= now) return s;
  return { ...s, date: localDateString(now), hour: now.getHours(), minute: now.getMinutes() };
}
