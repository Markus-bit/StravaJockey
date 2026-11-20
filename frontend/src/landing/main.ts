// Landing page (/) and the guide pages (/how-it-works/, /how-to-upload/). Plain HTML; this
// only adds styles, page-view counting and our own counters. The route planner is at /app/.
import "@fontsource-variable/space-grotesk";
import "./landing.css";
import { inject } from "@vercel/analytics";
import { track, trackVisit, type TrackEvent } from "../track";

inject(); // Vercel Web Analytics: cookieless page views (only sends data on Vercel deployments)
trackVisit(); // once per browser tab, so going on to the planner doesn't count twice

// guide pages name their own counter, e.g. <body data-track="help_how_to_upload">
const page = document.body.dataset.track;
if (page === "help_how_it_works" || page === "help_how_to_upload") track(page as TrackEvent);
