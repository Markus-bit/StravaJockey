// Where the map starts:
//   1. where the visitor last left it (remembered in this browser only), else
//   2. a big city in the visitor's time zone (no location permission needed), else
//   3. Oslo.

export type MapView = { center: [number, number]; zoom: number };

const STORAGE_KEY = "stravajockey:mapView";
const FALLBACK: MapView = { center: [10.75, 59.91], zoom: 12 }; // Oslo

// IANA time zone -> [lng, lat] of its main city
const TIME_ZONE_CITIES: Record<string, [number, number]> = {
  "Europe/Oslo": [10.75, 59.91], "Europe/Stockholm": [18.07, 59.33], "Europe/Copenhagen": [12.57, 55.68],
  "Europe/Helsinki": [24.94, 60.17], "Atlantic/Reykjavik": [-21.94, 64.15], "Europe/London": [-0.13, 51.51],
  "Europe/Dublin": [-6.26, 53.35], "Europe/Amsterdam": [4.9, 52.37], "Europe/Brussels": [4.35, 50.85],
  "Europe/Paris": [2.35, 48.86], "Europe/Berlin": [13.4, 52.52], "Europe/Zurich": [8.54, 47.38],
  "Europe/Vienna": [16.37, 48.21], "Europe/Prague": [14.42, 50.09], "Europe/Warsaw": [21.01, 52.23],
  "Europe/Madrid": [-3.7, 40.42], "Europe/Lisbon": [-9.14, 38.72], "Europe/Rome": [12.5, 41.9],
  "Europe/Athens": [23.73, 37.98], "Europe/Istanbul": [28.98, 41.01], "Europe/Kyiv": [30.52, 50.45],
  "Europe/Tallinn": [24.75, 59.44], "Europe/Riga": [24.11, 56.95], "Europe/Vilnius": [25.28, 54.69],
  "America/New_York": [-74.0, 40.71], "America/Chicago": [-87.63, 41.88], "America/Denver": [-104.99, 39.74],
  "America/Los_Angeles": [-118.24, 34.05], "America/Toronto": [-79.38, 43.65], "America/Vancouver": [-123.12, 49.28],
  "America/Mexico_City": [-99.13, 19.43], "America/Sao_Paulo": [-46.63, -23.55], "America/Argentina/Buenos_Aires": [-58.38, -34.6],
  "Asia/Tokyo": [139.69, 35.69], "Asia/Seoul": [126.98, 37.57], "Asia/Shanghai": [121.47, 31.23],
  "Asia/Hong_Kong": [114.17, 22.32], "Asia/Singapore": [103.82, 1.35], "Asia/Kolkata": [72.88, 19.08],
  "Asia/Dubai": [55.27, 25.2], "Australia/Sydney": [151.21, -33.87], "Australia/Melbourne": [144.96, -37.81],
  "Pacific/Auckland": [174.76, -36.85], "Africa/Johannesburg": [28.05, -26.2], "Africa/Cairo": [31.24, 30.04],
};

export function initialMapView(): MapView {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (
      saved && Array.isArray(saved.center) && saved.center.length === 2 &&
      saved.center.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) &&
      typeof saved.zoom === "number" && saved.zoom >= 0 && saved.zoom <= 22
    ) {
      return { center: [saved.center[0], saved.center[1]], zoom: saved.zoom };
    }
  } catch {
    /* storage unavailable (private mode, blocked) – fall through */
  }
  try {
    const city = TIME_ZONE_CITIES[Intl.DateTimeFormat().resolvedOptions().timeZone];
    if (city) return { center: city, zoom: 12 };
  } catch {
    /* no Intl time zone support */
  }
  return FALLBACK;
}

export function saveMapView(view: MapView) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    /* storage unavailable – not important */
  }
}
