// Landing page (/). Plain HTML in index.html; this only adds styles, page-view counting and
// our own visit counter. The route planner lives at /app/.
import "@fontsource-variable/space-grotesk";
import "./landing.css";
import { inject } from "@vercel/analytics";
import { trackVisit } from "../track";

inject(); // Vercel Web Analytics: cookieless page views (only sends data on Vercel deployments)
trackVisit(); // once per browser tab, so going on to the planner doesn't count twice
