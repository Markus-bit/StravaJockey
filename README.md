# StravaJockey

Draw a route on a map, choose pace and heart rate settings, and download it as a GPX file.

- `src/` – Express + TypeScript API (routing and elevation via Mapbox, OpenTopoData as elevation fallback, GPX generation)
- `frontend/` – React + Vite app (Mapbox GL map, settings panel, charts)

## Setup

Requires Node.js 20 or newer.

```bash
npm install
npm --prefix frontend install
cp .env.example .env                    # then fill in MAPBOX_TOKEN
cp frontend/.env.example frontend/.env  # then fill in VITE_MAPBOX_TOKEN
```

## Development

```bash
npm run dev
```

Opens the API on http://localhost:4000 and the site on http://localhost:5173 (Vite forwards `/api` to the API).

## Production

```bash
npm run build   # compiles the API to dist/ and the site to frontend/dist/
npm start       # serves the API and the built site on $PORT
```

`VITE_MAPBOX_TOKEN` is baked into the site at build time, so set it before `npm run build`.

On a hosting platform: build command `npm install && npm --prefix frontend install && npm run build`,
start command `npm start`, and set `MAPBOX_TOKEN`, `VITE_MAPBOX_TOKEN` and (behind the platform's proxy)
`TRUST_PROXY=1` as environment variables. Serve the site over HTTPS.

## Deploying to Vercel

`vercel.json` deploys the project as two [Vercel Services](https://vercel.com/docs/services) on one domain:

| Service | Folder | Public on | What it is |
|---|---|---|---|
| `app` | `.` (`src/server.ts`) | `/api/*` | Express API, runs as a Vercel Function |
| `frontend` | `frontend/` | everything else | Vite site, served from Vercel's CDN |

1. Import the repository in Vercel (branch with `vercel.json`). It detects both services from `vercel.json`.
2. Add environment variables (Production and Preview): `MAPBOX_TOKEN` (server token, no URL
   restrictions) and `VITE_MAPBOX_TOKEN` (public website token, restricted to your domain).
   `TRUST_PROXY` is set automatically on Vercel.
3. Deploy, then add your domain under Project → Domains, and add that domain to the URL
   restrictions of the website token in Mapbox.

Things that work differently on Vercel than on a single always-on server:

- The API runs as functions that start and stop on demand, so the in-memory rate limits and caches
  are per running instance. For hard limits, add a rate-limit rule in Vercel Firewall.
- Security headers for the site come from `vercel.json` (the API still sets its own).
- The Hobby plan is for personal, non-commercial use.

## Limits and protection

All configurable via environment variables, see `.env.example`:

- Rate limits per visitor: 60 route requests and 20 GPX downloads per 10 minutes, 120 chart
  previews per minute, 600 API requests in total per 10 minutes.
- Routes: at most 200 clicked points and 300 km.
- Security headers (Content-Security-Policy etc.) via helmet; request bodies limited to 100 kB.
- Errors are returned as `{ "error": "<message for the user>" }`; details only go to the server log.
