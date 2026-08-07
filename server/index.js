import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { healthRouter } from "./routes/health.js";
import { styleProfilesRouter } from "./routes/styleProfiles.js";
import { methodologyRouter } from "./routes/methodology.js";
import { analyseRouter } from "./routes/analyse.js";
import { rewriteRouter } from "./routes/rewrite.js";
import { detectorScanRouter } from "./routes/detectorScan.js";
import { jobsRouter } from "./routes/jobs.js";
import { llmProvider } from "./lib/llmProvider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "10mb" })); // long-document jobs (Phase 3) can carry a whole thesis chapter

app.use("/api", healthRouter);
app.use("/api", styleProfilesRouter);
app.use("/api", methodologyRouter);
app.use("/api", analyseRouter);
app.use("/api", rewriteRouter);
app.use("/api", detectorScanRouter);
app.use("/api", jobsRouter);

app.use(express.static(path.join(__dirname, "..", "public")));

const port = Number(process.env.PORT || 3000);

// The app must start and serve the editor shell regardless of whether the
// LLM key is configured -- Gate 0 in Section 22 of the build handoff.
app.listen(port, () => {
  console.log(`davis-academic-voice-engine listening on port ${port}`);
  console.log(`LLM configured: ${llmProvider.isConfigured() ? "yes" : "no (server will report NOT_CONFIGURED, this is expected pre-deploy)"}`);
});
