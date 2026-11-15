// Our own usage counters (see src/services/stats.ts on the server). Only the event name is
// sent; no cookies or IDs. Fire-and-forget: counting must never slow down or break the site.

export type TrackEvent =
  | "visit"
  | "snap_click" | "snap_success" | "snap_error"
  | "download_click" | "download_success" | "download_error"
  | "help_how_it_works" | "help_how_to_upload" | "help_terms";

export function track(name: TrackEvent) {
  try {
    const body = JSON.stringify({ name });
    // sendBeacon survives page unloads and never blocks; fetch with keepalive as fallback
    if (navigator.sendBeacon?.("/api/event", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/event", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .catch(() => {});
  } catch {
    /* ignore */
  }
}

// One "visit" per browser tab (reloads in the same tab don't count again)
export function trackVisit() {
  try {
    if (sessionStorage.getItem("stravajockey:visited")) return;
    sessionStorage.setItem("stravajockey:visited", "1");
  } catch {
    /* storage blocked: count anyway */
  }
  track("visit");
}
