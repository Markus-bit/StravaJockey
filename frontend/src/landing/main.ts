// Landing page (/), the guide pages (/how-it-works/, /how-to-upload/) and /terms/. Plain HTML; this
// only adds styles, page-view counting and our own counters. The route planner is at /app/.
import "@fontsource-variable/space-grotesk";
import "./landing.css";
import { inject } from "@vercel/analytics";
import { track, trackVisit, type TrackEvent } from "../track";

inject(); // Vercel Web Analytics: cookieless page views (only sends data on Vercel deployments)
trackVisit(); // once per browser tab, so going on to the planner doesn't count twice

// guide pages and the terms name their own counter, e.g. <body data-track="help_how_to_upload">
const PAGE_EVENTS: TrackEvent[] = ["help_how_it_works", "help_how_to_upload", "help_terms"];
const page = document.body.dataset.track as TrackEvent | undefined;
if (page && PAGE_EVENTS.includes(page)) track(page);
