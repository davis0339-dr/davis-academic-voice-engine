import { Router } from "express";
import { scanWithAllConfigured, listDetectorHealth } from "../lib/detectorQA.js";
import { buildDetectorResearchReport } from "../lib/detectorResearch.js";
import { detectorEvidenceSummary } from "../lib/detectorEvidenceBase.js";

export const detectorScanRouter = Router();

detectorScanRouter.get("/health/detectors", async (_req, res) => {
  const health = await listDetectorHealth();
  res.json({ providers: health });
});

detectorScanRouter.get("/detector-research/evidence", (_req, res) => {
  res.json(detectorEvidenceSummary());
});

detectorScanRouter.post("/detector-scan", async (req, res) => {
  const { text, label } = req.body || {};
  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string.", requestId: req.requestId });
  }
  const result = await scanWithAllConfigured(text);
  const research = buildDetectorResearchReport({ candidateText: text, observations: result.observations });
  res.json({ label: label || null, ...result, research, evidence: detectorEvidenceSummary(), requestId: req.requestId });
});

// Compare source/revision features with any detector results the researcher has
// available, including manual observations from closed systems such as Turnitin
// or Stealthwriter. The endpoint is deliberately stateless: manuscript text and
// manual detector notes are analysed for this request and are not persisted.
detectorScanRouter.post("/detector-research", (req, res) => {
  const { sourceText = "", candidateText = "", observations = [] } = req.body || {};
  if ((!sourceText || typeof sourceText !== "string") && (!candidateText || typeof candidateText !== "string")) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Provide `sourceText` and/or `candidateText` as text.", requestId: req.requestId });
  }
  if (!Array.isArray(observations) || observations.length > 20) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`observations` must be an array with at most 20 detector observations.", requestId: req.requestId });
  }
  const report = buildDetectorResearchReport({ sourceText, candidateText, observations });
  res.json({ ...report, evidence: detectorEvidenceSummary(), persistence: "none", requestId: req.requestId });
});
