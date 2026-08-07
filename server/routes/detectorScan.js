import { Router } from "express";
import { scanWithAllConfigured, listDetectorHealth } from "../lib/detectorQA.js";

export const detectorScanRouter = Router();

detectorScanRouter.get("/health/detectors", async (_req, res) => {
  const health = await listDetectorHealth();
  res.json({ providers: health });
});

// Manually triggered only -- see the hard-boundary comment in
// server/lib/detectorQA.js. This route is never called by /api/rewrite.
detectorScanRouter.post("/detector-scan", async (req, res) => {
  const { text, label } = req.body || {};
  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string." });
  }
  const result = await scanWithAllConfigured(text);
  res.json({ label: label || null, ...result });
});
