import { Router } from "express";
import { buildDetectorResearchReport } from "../lib/detectorResearch.js";
import { detectorEvidenceSummary } from "../lib/detectorEvidenceBase.js";

export const detectorScanRouter = Router();

const EXTERNAL_DETECTOR_POLICY = Object.freeze({
  state: "DISABLED_BY_DESIGN",
  message: "Live third-party detector integrations are disabled. External detector results may be recorded manually for independent comparison, but manuscript text is not sent to detector vendors by this application.",
});

detectorScanRouter.get("/health/detectors", (_req, res) => {
  res.json({
    providers: [],
    policy: EXTERNAL_DETECTOR_POLICY,
  });
});

detectorScanRouter.get("/detector-research/evidence", (_req, res) => {
  res.json(detectorEvidenceSummary());
});

// Intentionally retained as a closed endpoint so old front-end builds fail safely
// rather than silently sending manuscript text to a third-party detector.
detectorScanRouter.post("/detector-scan", (req, res) => {
  res.status(410).json({
    error: "EXTERNAL_DETECTORS_DISABLED",
    message: EXTERNAL_DETECTOR_POLICY.message,
    label: req.body?.label || null,
    results: [],
    requestId: req.requestId,
  });
});

// Compare source/revision features with detector results the researcher has
// independently obtained and entered manually. The endpoint is deliberately
// stateless: manuscript text and manual detector notes are analysed for this
// request and are not persisted.
detectorScanRouter.post("/detector-research", (req, res) => {
  const { sourceText = "", candidateText = "", observations = [] } = req.body || {};
  if ((!sourceText || typeof sourceText !== "string") && (!candidateText || typeof candidateText !== "string")) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Provide `sourceText` and/or `candidateText` as text.", requestId: req.requestId });
  }
  if (!Array.isArray(observations) || observations.length > 20) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`observations` must be an array with at most 20 detector observations.", requestId: req.requestId });
  }
  const report = buildDetectorResearchReport({ sourceText, candidateText, observations });
  res.json({
    ...report,
    evidence: detectorEvidenceSummary(),
    persistence: "none",
    external_detector_policy: EXTERNAL_DETECTOR_POLICY,
    requestId: req.requestId,
  });
});
