// Turns the raw daily counters from /api/stats into what the dashboard shows.
// Field names are documented in src/services/stats.ts on the server.

export type RawDay = { day: string; counts: Record<string, number> };
export type StatsResponse = { timeZone: string; generatedAt: string; days: RawDay[] };

export class Period {
  readonly days: RawDay[]; // oldest first
  constructor(days: RawDay[]) {
    this.days = days;
  }

  get labels() {
    return this.days.map((d) => d.day);
  }
  series(field: string) {
    return this.days.map((d) => d.counts[field] ?? 0);
  }
  sum(field: string) {
    return this.days.reduce((s, d) => s + (d.counts[field] ?? 0), 0);
  }
  // all fields "<prefix>:<value>" summed over the period -> { value: total }
  group(prefix: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of this.days) {
      for (const [k, v] of Object.entries(d.counts)) {
        if (k.startsWith(prefix + ":")) {
          const key = k.slice(prefix.length + 1);
          out[key] = (out[key] ?? 0) + v;
        }
      }
    }
    return out;
  }
  get isEmpty() {
    return this.days.every((d) => Object.keys(d.counts).length === 0);
  }
}

// The response holds 2 × range days, newest first: split into this period and the one before
export function splitPeriods(res: StatsResponse, range: number) {
  const current = new Period(res.days.slice(0, range).reverse());
  const previous = new Period(res.days.slice(range, range * 2).reverse());
  return { current, previous };
}

export function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

// ---- formatting

const nf = new Intl.NumberFormat("en-GB");
export function fmt(n: number) {
  if (Math.abs(n) >= 100_000) return new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  return nf.format(n);
}
export function fmtPct(r: number | null, digits = 0) {
  return r === null ? "–" : `${(r * 100).toFixed(digits)} %`;
}
export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}
export function weekday(day: string) {
  // 0 = Monday
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

// Change vs the previous period, as text plus direction
export function delta(cur: number, prev: number): { text: string; dir: -1 | 0 | 1 } | null {
  if (prev === 0) return cur === 0 ? null : { text: "new", dir: 1 };
  const change = (cur - prev) / prev;
  const dir = Math.abs(change) < 0.005 ? 0 : change > 0 ? 1 : -1;
  return { text: `${change > 0 ? "+" : ""}${Math.round(change * 100)} %`, dir };
}
export function deltaPoints(cur: number | null, prev: number | null): { text: string; dir: -1 | 0 | 1 } | null {
  if (cur === null || prev === null) return null;
  const d = (cur - prev) * 100;
  const dir = Math.abs(d) < 0.05 ? 0 : d > 0 ? 1 : -1;
  return { text: `${d > 0 ? "+" : ""}${d.toFixed(1)} pp`, dir };
}

// ---- category helpers

// Bucket labels like "5-10" / "100+" sorted by their lower bound
export function sortBuckets(entries: Record<string, number>) {
  return Object.entries(entries).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
export function countryName(code: string) {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
export function flag(code: string) {
  return /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : "";
}

export const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct / unknown",
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
  chatgpt: "ChatGPT",
  facebook: "Facebook / Messenger",
  instagram: "Instagram",
  reddit: "Reddit",
  x: "X / Twitter",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  strava: "Strava",
  github: "GitHub",
  other: "Other websites",
};

// Every counter per day, for the CSV download
export function toCsv(p: Period): string {
  const fields = [...new Set(p.days.flatMap((d) => Object.keys(d.counts)))].sort();
  const rows = [["day", ...fields].join(",")];
  for (const d of p.days) rows.push([d.day, ...fields.map((f) => d.counts[f] ?? 0)].join(","));
  return rows.join("\n") + "\n";
}
