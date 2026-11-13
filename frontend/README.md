# StravaJockey – frontend

React + TypeScript + Vite app for StravaJockey. See the [main README](../README.md) for setup,
development, tests and deployment.

- `src/App.tsx` – map, route snapping, downloads, layout
- `src/RunDetails.tsx` – the Run Details settings panel
- `src/ActivityCharts.tsx` – elevation / pace / heart rate charts
- `src/DatePicker.tsx`, `src/HelpDialogs.tsx`, `src/Terms.tsx`, `src/Toasts.tsx` – UI pieces
- `src/activity.ts` – settings, unit conversions and labels
- `src/mapStart.ts` – where the map starts
- `src/index.css` – all styles; the brand colour is `--brand` at the top
- `public/` – icons, web manifest and the link preview image

Needs `VITE_MAPBOX_TOKEN` in `frontend/.env` (see `.env.example`).
