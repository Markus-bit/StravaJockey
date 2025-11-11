import "dotenv/config";
import express from "express";
import { logger } from "./logger";
import router from "./routes";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api", router);
app.get("/", (_req, res) => {
  res.type("text/plain").send("API is running. Try GET /api/health or POST /api/generate-gpx");
});

// 4xx/5xx error-fangst (enkelt)
app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal Server Error" });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => logger.info(`API up on http://localhost:${PORT}`));