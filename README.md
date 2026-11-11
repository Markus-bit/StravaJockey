# StravaJockey

Draw a route on a map, choose pace and heart rate settings, and download it as a GPX file.

- `src/` – Express + TypeScript API (routing via Mapbox, elevation via OpenTopoData, GPX generation)
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

## Limits and protection

All configurable via environment variables, see `.env.example`:

- Rate limits per visitor: 60 route requests and 20 GPX downloads per 10 minutes, 120 chart
  previews per minute, 600 API requests in total per 10 minutes.
- Routes: at most 200 clicked points and 300 km.
- Security headers (Content-Security-Policy etc.) via helmet; request bodies limited to 100 kB.
- Errors are returned as `{ "error": "<message for the user>" }`; details only go to the server log.
