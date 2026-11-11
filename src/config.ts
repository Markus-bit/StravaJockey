// Limits that protect the server and the paid/free APIs it uses.
// Values can be overridden with environment variables (see .env.example).

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  // Route size
  maxWaypoints: num("MAX_WAYPOINTS", 200),          // points a user may click
  maxRouteKm: num("MAX_ROUTE_KM", 300),             // longest snapped route

  // Rate limits per visitor (IP address)
  rateLimit: {
    windowMinutes: num("RATE_LIMIT_WINDOW_MIN", 10),
    route: num("RATE_LIMIT_ROUTE", 60),             // /api/route (Mapbox + elevation); each snap uses 2
    generateGpx: num("RATE_LIMIT_GPX", 20),         // /api/generate-gpx (Mapbox + elevation)
    previewPerMinute: num("RATE_LIMIT_PREVIEW", 120), // /api/activity-preview (CPU only)
    allApi: num("RATE_LIMIT_API", 600),             // everything under /api, per window
  },
};
