import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BarList, ColumnChart, Empty, LineChart, SegmentedBar, Sparkline, type BarRow, type Part } from "./charts";
import {
  SOURCE_LABELS, countryName, delta, deltaPoints, flag, fmt, fmtDay, fmtPct, ratio, sortBuckets, splitPeriods,
  toCsv, weekday, type Period, type StatsResponse,
} from "./data";

// Private dashboard at /stats/. The password is checked by the server (/api/stats);
// it's kept in this browser only, for this tab or (if chosen) on this device.

const PW_KEY = "stravajockey:statsPassword";
const RANGES = [7, 30, 90, 365] as const;
type Range = (typeof RANGES)[number];

// Entity colors (fixed across every chart)
const C = {
  visits: "var(--series-1)",
  downloads: "var(--series-2)",
  snaps: "var(--series-3)",
  snapErrors: "var(--series-7)",
  downloadErrors: "var(--series-8)",
};

function loadPassword() {
  try {
    return sessionStorage.getItem(PW_KEY) ?? localStorage.getItem(PW_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function StatsApp() {
  const [password, setPassword] = useState(loadPassword);
  const [range, setRange] = useState<Range>(() => {
    const r = Number(new URLSearchParams(location.search).get("days"));
    return (RANGES as readonly number[]).includes(r) ? (r as Range) : 30;
  });
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loadedRange, setLoadedRange] = useState<Range>(range);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pw: string, r: Range) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stats?days=${r * 2}`, {
        headers: { Authorization: `Bearer ${pw}`, Accept: "application/json" },
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (res.status === 401) {
        logout();
        setError("Wrong password.");
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? `The server answered ${res.status}.`);
      setData(body as StatsResponse);
      setLoadedRange(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the stats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (password) void load(password, range);
  }, [password, range, load]);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("days", String(range));
    history.replaceState(null, "", url);
  }, [range]);

  function logout() {
    try {
      sessionStorage.removeItem(PW_KEY);
      localStorage.removeItem(PW_KEY);
    } catch {
      /* ignore */
    }
    setPassword("");
    setData(null);
  }

  if (!password) return <Login error={error} onLogin={(pw, remember) => {
    try {
      (remember ? localStorage : sessionStorage).setItem(PW_KEY, pw);
    } catch {
      /* storage blocked: works for this page only */
    }
    setError(null);
    setPassword(pw);
  }} />;

  return (
    <div className="stats-page">
      <header className="stats-header">
        <div className="stats-brand">
          <span className="brand-mark" aria-hidden="true">SJ</span>
          <div>
            <h1>StravaJockey stats</h1>
            <p className="muted">
              {data ? <>Days in {data.timeZone} · updated {new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</> : "Loading…"}
            </p>
          </div>
        </div>
        <div className="stats-actions">
          <a className="btn-ghost" href="/">Open site</a>
          <button className="btn-ghost" type="button" onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="filter-row" role="toolbar" aria-label="Period">
        <div className="segmented">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
              {r === 365 ? "12 months" : `${r} days`}
            </button>
          ))}
        </div>
        <button className="btn-ghost" type="button" onClick={() => void load(password, range)} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        <span className="muted small">Changes are compared with the {loadedRange === 365 ? "12 months" : `${loadedRange} days`} before.</span>
      </div>

      {error && <div className="stats-error" role="alert">{error}</div>}

      {data ? (
        <div className={loading ? "dashboard is-loading" : "dashboard"}>
          <Dashboard data={data} range={loadedRange} />
        </div>
      ) : (
        !error && <p className="muted">Loading…</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- login

function Login({ error, onLogin }: { error: string | null; onLogin: (pw: string, remember: boolean) => void }) {
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (pw) onLogin(pw, remember);
  }
  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={submit}>
        <span className="brand-mark" aria-hidden="true">SJ</span>
        <h1>StravaJockey stats</h1>
        <p className="muted">Enter the stats password (STATS_PASSWORD in Vercel).</p>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this device
        </label>
        {error && <div className="stats-error" role="alert">{error}</div>}
        <button className="btn-primary" type="submit" disabled={!pw}>Show stats</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- dashboard

function Card({ title, sub, children, wide, actions }: { title: string; sub?: ReactNode; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  return (
    <section className={wide ? "card wide" : "card"}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {sub && <p className="muted small">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

type Delta = { text: string; dir: -1 | 0 | 1 } | null;

function Tile({ label, value, d, upIsGood = true, spark, color, note }: {
  label: string; value: string; d: Delta; upIsGood?: boolean; spark?: number[]; color?: string; note?: ReactNode;
}) {
  const tone = !d || d.dir === 0 ? "flat" : (d.dir > 0) === upIsGood ? "good" : "bad";
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-meta">
        {d ? (
          <span className={`delta ${tone}`}>
            <span aria-hidden="true">{d.dir > 0 ? "▲" : d.dir < 0 ? "▼" : "■"}</span> {d.text}
          </span>
        ) : (
          <span className="delta flat">no earlier data</span>
        )}
        {note && <span className="muted small">{note}</span>}
      </div>
      {spark && color && <Sparkline values={spark} color={color} />}
    </div>
  );
}

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented small">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function Dashboard({ data, range }: { data: StatsResponse; range: Range }) {
  const { current: cur, previous: prev } = useMemo(() => splitPeriods(data, range), [data, range]);
  const [hourMetric, setHourMetric] = useState<"downloads" | "visits">("downloads");
  const [weekMetric, setWeekMetric] = useState<"downloads" | "visits">("downloads");
  const [showTable, setShowTable] = useState(false);

  const visits = cur.sum("visit");
  const snaps = cur.sum("snap_success");
  const downloads = cur.sum("gpx_generated");
  const conv = ratio(cur.sum("download_success"), visits);
  const okRate = ratio(cur.sum("download_success"), cur.sum("download_success") + cur.sum("download_error"));
  const snapOkRate = ratio(snaps, snaps + cur.sum("snap_error"));

  // ---- funnel (all counted by the browser, so the steps are comparable)
  const steps: [string, number][] = [
    ["Visits", visits],
    ["Clicked Snap to road", cur.sum("snap_click")],
    ["Route snapped", snaps],
    ["Clicked Download", cur.sum("download_click")],
    ["File downloaded", cur.sum("download_success")],
  ];
  const funnelColors = ["var(--ord-1)", "var(--ord-2)", "var(--ord-3)", "var(--ord-4)", "var(--ord-5)"];

  // ---- hour of day / weekday
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const hourGroup = cur.group(hourMetric === "downloads" ? "hour_download" : "hour_visit");
  const weekField = weekMetric === "downloads" ? "gpx_generated" : "visit";
  const weekTotals = [0, 0, 0, 0, 0, 0, 0];
  const weekCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of cur.days) {
    weekTotals[weekday(d.day)] += d.counts[weekField] ?? 0;
    weekCounts[weekday(d.day)]++;
  }
  const weekAvg = weekTotals.map((t, i) => (weekCounts[i] ? Math.round((t / weekCounts[i]) * 10) / 10 : 0));
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ---- splits
  const sport = cur.group("sport");
  const hr = cur.group("hr");
  const device = cur.group("device");
  const sportParts: Part[] = [
    { key: "run", label: "Run", value: sport.run ?? 0, color: "var(--series-1)", ink: "#fff" },
    { key: "bike", label: "Bike", value: sport.bike ?? 0, color: "var(--series-2)", ink: "#fff" },
  ];
  const hrParts: Part[] = [
    { key: "on", label: "With heart rate", value: hr.on ?? 0, color: "var(--series-1)", ink: "#fff" },
    { key: "off", label: "Without", value: hr.off ?? 0, color: "var(--series-2)", ink: "#fff" },
  ];
  const deviceParts: Part[] = [
    { key: "mobile", label: "Mobile", value: device.mobile ?? 0, color: "var(--series-1)", ink: "#fff" },
    { key: "desktop", label: "Desktop", value: device.desktop ?? 0, color: "var(--series-2)", ink: "#fff" },
    { key: "tablet", label: "Tablet", value: device.tablet ?? 0, color: "var(--series-3)", ink: "#fff" },
  ];

  // ---- distributions
  const dist = sortBuckets(cur.group("dist"));
  const pace = sortBuckets(cur.group("pace_run"));
  const speed = sortBuckets(cur.group("speed_bike"));

  // ---- lists
  const countryRows = (prefix: string): BarRow[] =>
    Object.entries(cur.group(prefix))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([code, v]) => ({ key: code, label: <><span className="flag" aria-hidden="true">{flag(code)}</span> {countryName(code)}</>, value: v }));
  const sourceRows: BarRow[] = Object.entries(cur.group("source"))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, label: SOURCE_LABELS[k] ?? k, value: v }));
  const helpRows: BarRow[] = [
    { key: "how", label: "How it works", value: cur.sum("help_how_it_works") },
    { key: "upload", label: "How to upload", value: cur.sum("help_how_to_upload") },
    { key: "terms", label: "Terms of Service", value: cur.sum("help_terms") },
  ];

  const blocked = Math.max(0, downloads - cur.sum("download_success"));

  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([toCsv(cur)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `stravajockey-stats-${cur.days[0]?.day}-to-${cur.days[cur.days.length - 1]?.day}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (cur.isEmpty) {
    return <div className="card"><Empty>No activity counted in this period yet. Counting started when tracking was switched on.</Empty></div>;
  }

  return (
    <>
      <div className="tiles">
        <Tile label="Visits" value={fmt(visits)} d={delta(visits, prev.sum("visit"))} spark={cur.series("visit")} color={C.visits} />
        <Tile label="Routes snapped" value={fmt(snaps)} d={delta(snaps, prev.sum("snap_success"))} spark={cur.series("snap_success")} color={C.snaps} />
        <Tile label="GPX files made" value={fmt(downloads)} d={delta(downloads, prev.sum("gpx_generated"))} spark={cur.series("gpx_generated")} color={C.downloads} note="counted by the server" />
        <Tile label="Visits that downloaded" value={fmtPct(conv, 1)} d={deltaPoints(conv, ratio(prev.sum("download_success"), prev.sum("visit")))} />
        <Tile label="Downloads that worked" value={fmtPct(okRate, 1)} d={deltaPoints(okRate, ratio(prev.sum("download_success"), prev.sum("download_success") + prev.sum("download_error")))} />
        <Tile label="Snaps that worked" value={fmtPct(snapOkRate, 1)} d={deltaPoints(snapOkRate, ratio(prev.sum("snap_success"), prev.sum("snap_success") + prev.sum("snap_error")))} />
      </div>

      <div className="grid">
        <Card title="Activity per day" sub="Visits, routes snapped and GPX files made" wide>
          <LineChart
            days={cur.labels}
            ariaLabel="Visits, routes snapped and GPX files per day"
            series={[
              { key: "visit", label: "Visits", color: C.visits, values: cur.series("visit") },
              { key: "gpx", label: "GPX files made", color: C.downloads, values: cur.series("gpx_generated") },
              { key: "snap", label: "Routes snapped", color: C.snaps, values: cur.series("snap_success") },
            ]}
          />
        </Card>

        <Card title="Funnel" sub="From visit to downloaded file (counted in the browser)">
          <ul className="funnel">
            {steps.map(([label, v], i) => {
              const first = steps[0][1];
              const prevStep = i ? steps[i - 1][1] : null;
              return (
                <li key={label}>
                  <div className="funnel-top">
                    <span>{label}</span>
                    <span><strong>{fmt(v)}</strong>{prevStep !== null && <span className="muted small"> · {fmtPct(ratio(v, prevStep))} of previous</span>}</span>
                  </div>
                  <div className="bar-track tall">
                    <span className="bar-fill" style={{ width: `${first ? (v / first) * 100 : 0}%`, background: funnelColors[i] }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Run or bike" sub="GPX files made">
          <SegmentedBar ariaLabel="Run or bike" parts={sportParts} />
          <h3 className="sub-head">Heart rate included</h3>
          <SegmentedBar ariaLabel="Heart rate included" parts={hrParts} />
          <h3 className="sub-head">Device (visits)</h3>
          <SegmentedBar ariaLabel="Device" parts={deviceParts} />
        </Card>

        <Card title="Route distance" sub="GPX files made, by length in km">
          {dist.length ? (
            <ColumnChart labels={dist.map(([k]) => k)} values={dist.map(([, v]) => v)} color={C.downloads} ariaLabel="GPX files by distance" valueLabel="files" tipLabel={(i) => `${dist[i][0]} km`} labelEvery={1} />
          ) : <Empty />}
        </Card>

        <Card title="Pace and speed" sub="Average pace or speed chosen, GPX files made">
          <h3 className="sub-head first">Runs · pace in min/km</h3>
          {pace.length ? (
            <ColumnChart labels={pace.map(([k]) => k)} values={pace.map(([, v]) => v)} color={C.downloads} ariaLabel="Runs by pace" valueLabel="runs" tipLabel={(i) => `${pace[i][0]} min/km`} labelEvery={1} height={170} />
          ) : <Empty>No runs yet</Empty>}
          <h3 className="sub-head">Rides · speed in km/h</h3>
          {speed.length ? (
            <ColumnChart labels={speed.map(([k]) => k)} values={speed.map(([, v]) => v)} color={C.downloads} ariaLabel="Rides by speed" valueLabel="rides" tipLabel={(i) => `${speed[i][0]} km/h`} labelEvery={1} height={170} />
          ) : <Empty>No rides yet</Empty>}
        </Card>

        <Card
          title="Time of day"
          sub={`${hourMetric === "downloads" ? "GPX files made" : "Visits"} per hour (${data.timeZone})`}
          actions={<Toggle value={hourMetric} onChange={setHourMetric} options={[["downloads", "Files"], ["visits", "Visits"]]} />}
        >
          <ColumnChart
            labels={hours}
            values={hours.map((h) => hourGroup[h] ?? 0)}
            color={hourMetric === "downloads" ? C.downloads : C.visits}
            ariaLabel="Per hour of day"
            valueLabel={hourMetric === "downloads" ? "files" : "visits"}
            tipLabel={(i) => `${hours[i]}:00–${hours[i]}:59`}
            labelEvery={3}
          />
        </Card>

        <Card
          title="Day of week"
          sub={`Average ${weekMetric === "downloads" ? "GPX files" : "visits"} per day`}
          actions={<Toggle value={weekMetric} onChange={setWeekMetric} options={[["downloads", "Files"], ["visits", "Visits"]]} />}
        >
          <ColumnChart
            labels={WEEKDAYS}
            values={weekAvg}
            color={weekMetric === "downloads" ? C.downloads : C.visits}
            ariaLabel="Average per weekday"
            valueLabel={weekMetric === "downloads" ? "files per day (average)" : "visits per day (average)"}
            labelEvery={1}
          />
        </Card>

        <Card title="Countries" sub="Visits">
          <BarList rows={countryRows("country")} color={C.visits} total={visits} emptyText="No countries yet (only known on Vercel)" />
        </Card>

        <Card title="Countries" sub="GPX files made">
          <BarList rows={countryRows("dl_country")} color={C.downloads} total={downloads} emptyText="No countries yet (only known on Vercel)" />
        </Card>

        <Card title="Where visitors come from" sub="The site that linked to StravaJockey">
          <BarList rows={sourceRows} color={C.visits} total={visits} />
        </Card>

        <Card title="Errors per day" sub={`${fmt(cur.sum("snap_error"))} snap errors · ${fmt(cur.sum("download_error"))} download errors`}>
          <LineChart
            days={cur.labels}
            ariaLabel="Errors per day"
            height={200}
            series={[
              { key: "snap_error", label: "Snap errors", color: C.snapErrors, values: cur.series("snap_error") },
              { key: "download_error", label: "Download errors", color: C.downloadErrors, values: cur.series("download_error") },
            ]}
          />
        </Card>

        <Card title="Help pages opened">
          <BarList rows={helpRows} color={C.visits} />
        </Card>

        <Card title="Browser vs server count" sub="Files the server made vs downloads the browser reported">
          <BarList
            color={C.downloads}
            rows={[
              { key: "server", label: "GPX files made (server)", value: downloads },
              { key: "browser", label: "Downloads reported (browser)", value: cur.sum("download_success") },
            ]}
          />
          <p className="muted small note">
            {blocked > 0
              ? <>About {fmt(blocked)} downloads ({fmtPct(ratio(blocked, downloads))}) weren't reported by the browser, most likely because of ad blockers. Browser-counted numbers (visits, funnel) are probably that much too low.</>
              : <>The two counts match, so ad blockers aren't hiding much.</>}
          </p>
        </Card>

        <Card
          title="Per day"
          sub="All numbers behind the charts"
          wide
          actions={
            <div className="card-actions">
              <button className="btn-ghost" type="button" onClick={() => setShowTable((s) => !s)}>{showTable ? "Hide table" : "Show table"}</button>
              <button className="btn-ghost" type="button" onClick={downloadCsv}>Download CSV</button>
            </div>
          }
        >
          {showTable && <DayTable period={cur} />}
        </Card>
      </div>
    </>
  );
}

const TABLE_COLUMNS: [string, string][] = [
  ["visit", "Visits"],
  ["snap_click", "Snap clicks"],
  ["snap_success", "Snapped"],
  ["snap_error", "Snap errors"],
  ["download_click", "Download clicks"],
  ["download_success", "Downloads (browser)"],
  ["download_error", "Download errors"],
  ["gpx_generated", "GPX made (server)"],
  ["help_how_it_works", "How it works"],
  ["help_how_to_upload", "How to upload"],
  ["help_terms", "Terms"],
];

function DayTable({ period }: { period: Period }) {
  const rows = [...period.days].reverse();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Day</th>
            {TABLE_COLUMNS.map(([, l]) => <th key={l}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.day}>
              <td>{fmtDay(d.day, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</td>
              {TABLE_COLUMNS.map(([k]) => {
                const v = d.counts[k] ?? 0;
                return <td key={k} className={v ? "" : "zero"}>{fmt(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            {TABLE_COLUMNS.map(([k]) => <td key={k}>{fmt(period.sum(k))}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
