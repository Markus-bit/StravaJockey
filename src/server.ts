import "dotenv/config";
import fs from "fs";
import path from "path";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logger } from "./logger";
import router from "./routes";
import { config } from "./config";

const app = express();

// Behind a reverse proxy / hosting platform (Render, Fly, Nginx, ...) the visitor's real IP
// is in X-Forwarded-For. Set TRUST_PROXY to the number of proxies in front of the app
// (usually 1) so rate limits are per visitor and not per proxy.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === "true");

// ---- Security headers (CSP allows exactly what Mapbox GL needs)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // React/Mapbox set inline style attributes
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", "https://api.mapbox.com", "https://events.mapbox.com", "https://*.tiles.mapbox.com"],
        workerSrc: ["'self'", "blob:"],
        childSrc: ["blob:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null, // the host's HTTPS + HSTS handle this
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ---- Request body: only small JSON payloads are ever needed
app.use(express.json({ limit: "100kb" }));

// ---- Rate limits per visitor
const windowMs = config.rateLimit.windowMinutes * 60_000;
const limiter = (limit: number, ms: number, message: string) =>
  rateLimit({
    windowMs: ms,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: message },
  });
const slowDown = "You're making requests too quickly. Please wait a few minutes and try again.";

app.use("/api", limiter(config.rateLimit.allApi, windowMs, slowDown));
app.use("/api/route", limiter(config.rateLimit.route, windowMs, slowDown));
app.use("/api/generate-gpx", limiter(config.rateLimit.generateGpx, windowMs, "You've downloaded a lot of files in a short time. Please wait a few minutes and try again."));
app.use("/api/activity-preview", limiter(config.rateLimit.previewPerMinute, 60_000, slowDown));

app.use("/api", router);

// ---- Built frontend (npm run build). In development Vite serves it instead.
const staticDir = process.env.STATIC_DIR || path.resolve(__dirname, "../frontend/dist");
const indexHtml = path.join(staticDir, "index.html");
if (fs.existsSync(indexHtml)) {
  app.use(
    express.static(staticDir, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite gives files in /assets content-hashed names, so they can be cached forever
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  // Single-page app: every other GET serves index.html (never cached, so new deploys show up)
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml);
  });
  logger.info({ staticDir }, "Serving frontend");
} else {
  app.get("/", (_req, res) => {
    res.type("text/plain").send("API is running. Build the frontend (npm run build) to serve the site from here.");
  });
}

// ---- Last-resort error handler: generic message to the client, details to the log
app.use((err: { status?: number; type?: string; message?: string; stack?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request too large." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON in request." });
  logger.error({ err: err?.message, stack: err?.stack }, "Unhandled error");
  res.status(err?.status && err.status >= 400 && err.status < 600 ? err.status : 500)
    .json({ error: "Something went wrong. Please try again." });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => logger.info(`API up on http://localhost:${PORT}`));
