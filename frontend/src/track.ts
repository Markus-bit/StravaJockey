// Our own usage counters (see src/services/stats.ts on the server). Only the event name is
// sent; no cookies or IDs. Fire-and-forget: counting must never slow down or break the site.

export type TrackEvent =
  | "visit"
  | "snap_click" | "snap_success" | "snap_error"
  | "download_click" | "download_success" | "download_error"
  | "help_how_it_works" | "help_how_to_upload" | "help_terms";

type Extra = { device?: "mobile" | "tablet" | "desktop"; source?: string };

export function track(name: TrackEvent, extra: Extra = {}) {
  try {
    const body = JSON.stringify({ name, ...extra });
    // sendBeacon survives page unloads and never blocks; fetch with keepalive as fallback
    if (navigator.sendBeacon?.("/api/event", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/event", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .catch(() => {});
  } catch {
    /* ignore */
  }
}

// One "visit" per browser tab (reloads in the same tab don't count again), with the kind of
// device and where the visitor came from (only the site category, never the full address)
export function trackVisit() {
  try {
    if (sessionStorage.getItem("stravajockey:visited")) return;
    sessionStorage.setItem("stravajockey:visited", "1");
  } catch {
    /* storage blocked: count anyway */
  }
  track("visit", { device: deviceType(), source: trafficSource(document.referrer) });
}

function deviceType(): "mobile" | "tablet" | "desktop" {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const shortSide = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0) || window.innerWidth;
  if (coarse && shortSide < 600) return "mobile";
  if (coarse) return "tablet";
  return "desktop";
}

// Must match SOURCES in src/services/stats.ts
const SOURCES: [RegExp, string][] = [
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)yahoo\./, "yahoo"],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, "chatgpt"],
  [/(^|\.)(facebook\.com|fb\.com|messenger\.com)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, "x"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)strava\.com$/, "strava"],
  [/(^|\.)github\.com$/, "github"],
];

export function trafficSource(referrer: string): string {
  let host = "";
  try {
    host = referrer ? new URL(referrer).hostname.toLowerCase() : "";
  } catch {
    return "other";
  }
  if (!host || host === location.hostname || host.endsWith(".stravajockey.com") || host === "stravajockey.com") return "direct";
  return SOURCES.find(([re]) => re.test(host))?.[1] ?? "other";
}
