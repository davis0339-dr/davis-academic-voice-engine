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
import { researchStudioRouter } from "./routes/researchStudio.js";
import { llmProvider } from "./lib/llmProvider.js";
import {
  securityHeaders,
  enforceSameOrigin,
  generalApiLimiter,
  protectExpensiveApi,
  expensiveConcurrencyGate,
  validateApiPayload,
  jsonBodyErrorHandler,
} from "./lib/security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable("x-powered-by");
// Render and similar reverse proxies supply the real client address in X-Forwarded-For.
// Trust only the first proxy hop so per-IP abuse controls use the client rather than the proxy.
app.set("trust proxy", 1);

app.use(securityHeaders);

// Apply abuse controls before reading potentially expensive request bodies.
app.use("/api", generalApiLimiter, enforceSameOrigin, protectExpensiveApi, expensiveConcurrencyGate);

// Long-document jobs need more room than the single editor. A detector-result
// screenshot is separately bounded to one PNG/JPEG with a 2 MB decoded image
// limit; base64 expansion requires a slightly larger JSON envelope. All other
// API surfaces retain the smaller generic JSON limit.
app.use("/api/jobs", express.json({ limit: "1mb", strict: true, type: "application/json" }));
app.use("/api/detector-screenshot", express.json({ limit: "3mb", strict: true, type: "application/json" }));
app.use("/api", express.json({ limit: "512kb", strict: true, type: "application/json" }));
app.use(jsonBodyErrorHandler);
app.use("/api", validateApiPayload);

app.use("/api", healthRouter);
app.use("/api", styleProfilesRouter);
app.use("/api", methodologyRouter);
app.use("/api", analyseRouter);
app.use("/api", rewriteRouter);
app.use("/api", detectorScanRouter);
app.use("/api", jobsRouter);
app.use("/api", researchStudioRouter);

app.use(express.static(path.join(__dirname, "..", "public"), {
  etag: true,
  maxAge: 0,
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-cache");
  },
}));

// Do not leak parser internals or stack traces to clients.
app.use((err, req, res, _next) => {
  const requestId = req.requestId || "unknown";
  console.error(JSON.stringify({ event: "request_error", requestId, path: req.originalUrl, message: err?.message || "unknown error" }));
  res.status(500).json({ error: "INTERNAL_ERROR", message: "The request could not be completed.", requestId });
});

const port = Number(process.env.PORT || 3000);

// The editor shell still starts when the provider key is absent. Provider-backed
// routes then return NOT_CONFIGURED rather than exposing or fabricating credentials.
app.listen(port, () => {
  console.log(`davis-academic-voice-engine listening on port ${port}`);
  console.log(`LLM configured: ${llmProvider.isConfigured() ? "yes" : "no (server will report NOT_CONFIGURED, this is expected pre-deploy)"}`);
});