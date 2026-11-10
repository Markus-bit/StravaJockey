import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import path from "path";
import axios from "axios";
import { logger } from "../logger";

// Strava API: https://developers.strava.com/docs/uploads/ and /docs/authentication/
const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";
const REQUIRED_SCOPE = "activity:write";

// Single-user app: tokens live in a local file (gitignored) so they survive restarts.
const TOKEN_FILE = path.resolve(process.cwd(), ".strava-tokens.json");

type StravaTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
  athleteName?: string;
};

function config() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET are not set on the server. Add them to .env and restart.");
  }
  const redirectUri = process.env.STRAVA_REDIRECT_URI || "http://localhost:5173/api/strava/callback";
  return { clientId, clientSecret, redirectUri };
}

function loadTokens(): StravaTokens | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveTokens(t: StravaTokens) {
  writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

export function disconnect() {
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
}

export function status() {
  const t = loadTokens();
  return { connected: !!t, athleteName: t?.athleteName ?? null };
}

// ---- OAuth ----

// Pending OAuth "state" values (CSRF protection), valid for 10 minutes
const pendingStates = new Map<string, number>();

export function authorizeUrl(): string {
  const { clientId, redirectUri } = config();
  const state = randomBytes(16).toString("hex");
  const now = Date.now();
  for (const [s, exp] of pendingStates) if (exp < now) pendingStates.delete(s);
  pendingStates.set(state, now + 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: REQUIRED_SCOPE,
    state
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export async function handleCallback(q: { code?: string; state?: string; scope?: string; error?: string }) {
  if (q.error) throw new Error(`Strava authorization failed: ${q.error}`);
  if (!q.state || !pendingStates.has(q.state)) throw new Error("Invalid or expired OAuth state. Try connecting again.");
  pendingStates.delete(q.state);
  if (!q.code) throw new Error("Missing authorization code from Strava");
  if (!q.scope?.split(",").includes(REQUIRED_SCOPE)) {
    throw new Error(`Strava did not grant "${REQUIRED_SCOPE}". Tick "Upload your activities" when connecting.`);
  }

  const { clientId, clientSecret } = config();
  const res = await axios.post(TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    code: q.code,
    grant_type: "authorization_code"
  }, { timeout: 15000 });

  const a = res.data.athlete;
  saveTokens({
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    expiresAt: res.data.expires_at,
    athleteName: a ? [a.firstname, a.lastname].filter(Boolean).join(" ") : undefined
  });
}

// Access tokens last 6 hours; refresh when less than 5 minutes remain
async function getAccessToken(): Promise<string> {
  const t = loadTokens();
  if (!t) throw new Error("Not connected to Strava. Click \"Connect Strava\" first.");
  if (t.expiresAt - 300 > Date.now() / 1000) return t.accessToken;

  const { clientId, clientSecret } = config();
  try {
    const res = await axios.post(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: t.refreshToken
    }, { timeout: 15000 });
    const next = {
      ...t,
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: res.data.expires_at
    };
    saveTokens(next);
    return next.accessToken;
  } catch (e: any) {
    logger.warn({ status: e?.response?.status }, "Strava token refresh failed");
    if (e?.response?.status === 400 || e?.response?.status === 401) {
      disconnect();
      throw new Error("Strava access was revoked or expired. Connect Strava again.");
    }
    throw e;
  }
}

// ---- Upload ----

export type UploadResult =
  | { state: "ready"; activityId: number; activityUrl: string }
  | { state: "processing"; uploadId: number };

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function uploadGpx(opts: {
  gpx: string;
  fileName: string;
  name?: string;
  description?: string;
}): Promise<UploadResult> {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };

  const form = new FormData();
  form.append("file", new Blob([opts.gpx], { type: "application/gpx+xml" }), opts.fileName);
  form.append("data_type", "gpx");
  // "name" is what sets the activity title on Strava; the GPX <name> alone is not reliably used
  if (opts.name) form.append("name", opts.name);
  if (opts.description) form.append("description", opts.description);

  let upload: any;
  try {
    upload = (await axios.post(`${API_BASE}/uploads`, form, { headers, timeout: 30000 })).data;
  } catch (e: any) {
    throw stravaError(e, "Upload to Strava failed");
  }

  // Processing is asynchronous; Strava asks clients to poll at most once per second
  for (let i = 0; i < 20; i++) {
    if (upload.error) throw new Error(`Strava rejected the upload: ${upload.error}`);
    if (upload.activity_id) {
      return {
        state: "ready",
        activityId: upload.activity_id,
        activityUrl: `https://www.strava.com/activities/${upload.activity_id}`
      };
    }
    await sleep(2000);
    try {
      upload = (await axios.get(`${API_BASE}/uploads/${upload.id}`, { headers, timeout: 15000 })).data;
    } catch (e: any) {
      throw stravaError(e, "Checking upload status failed");
    }
  }
  return { state: "processing", uploadId: upload.id };
}

function stravaError(e: any, prefix: string): Error {
  const status = e?.response?.status;
  const data = e?.response?.data;
  logger.warn({ status, data }, prefix);
  if (status === 401) return new Error(`${prefix}: Strava rejected the token. Connect Strava again.`);
  if (status === 429) return new Error(`${prefix}: Strava rate limit reached. Try again in a few minutes.`);
  const detail = data?.message || data?.error || e?.message;
  return new Error(`${prefix}${detail ? `: ${detail}` : ""}`);
}
