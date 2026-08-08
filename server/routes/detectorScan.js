import { Router } from "express";
import { buildDetectorResearchReport } from "../lib/detectorResearch.js";
import { buildSourceRevisionComparison } from "../lib/detectorComparison.js";
import { detectorEvidenceSummary } from "../lib/detectorEvidenceBase.js";
import {
  validateDetectorScreenshotPayload,
  detectorScreenshotPrompt,
  normaliseDetectorScreenshotAnalysis,
} from "../lib/detectorScreenshot.js";
import { llmProvider, HealthState } from "../lib/llmProvider.js";

export const detectorScanRouter = Router();

const EXTERNAL_DETECTOR_POLICY = Object.freeze({
  state: "DISABLED_BY_DESIGN",
  message: "Live third-party detector integrations are disabled. External detector results may be recorded manually or from a user-supplied result screenshot for independent comparison, but manuscript text is not sent to detector vendors by this application.",
});

detectorScanRouter.get("/health/detectors", (_req, res) => {
  res.json({ providers: [], policy: EXTERNAL_DETECTOR_POLICY });
});

detectorScanRouter.get("/detector-research/evidence", (_req, res) => {
  res.json(detectorEvidenceSummary());
});

detectorScanRouter.post("/detector-scan", (req, res) => {
  res.status(410).json({
    error: "EXTERNAL_DETECTORS_DISABLED",
    message: EXTERNAL_DETECTOR_POLICY.message,
    label: req.body?.label || null,
    results: [],
    requestId: req.requestId,
  });
});

// Manual/independently obtained observations are compared with source/revision
// measurements. Optional styleFilters select the closest evidence-backed corpus
// family; sparse filters transparently fall back through the corpus ladder.
detectorScanRouter.post("/detector-research", (req, res) => {
  const { sourceText = "", candidateText = "", observations = [], styleFilters = {} } = req.body || {};
  if ((!sourceText || typeof sourceText !== "string") && (!candidateText || typeof candidateText !== "string")) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Provide `sourceText` and/or `candidateText` as text.", requestId: req.requestId });
  }
  if (!Array.isArray(observations) || observations.length > 20) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`observations` must be an array with at most 20 detector observations.", requestId: req.requestId });
  }
  if (!styleFilters || typeof styleFilters !== "object" || Array.isArray(styleFilters)) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`styleFilters` must be an object when supplied.", requestId: req.requestId });
  }
  const report = buildDetectorResearchReport({ sourceText, candidateText, observations, styleFilters });
  const comparison = buildSourceRevisionComparison(sourceText, candidateText);
  res.json({
    ...report,
    comparison,
    evidence: detectorEvidenceSummary(),
    persistence: "none",
    external_detector_policy: EXTERNAL_DETECTOR_POLICY,
    requestId: req.requestId,
  });
});

detectorScanRouter.post("/detector-screenshot", async (req, res) => {
  try {
    const validated = validateDetectorScreenshotPayload(req.body || {});
    if (!llmProvider.isConfigured()) {
      return res.status(503).json({
        error: "NOT_CONFIGURED",
        message: "The language-model provider is not configured, so screenshot reading is unavailable.",
        requestId: req.requestId,
      });
    }

    const response = await llmProvider.callAnthropic({
      system: "Extract only visibly supported information from the supplied detector-result screenshot. Return the requested JSON only.",
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: validated.mimeType,
              data: validated.imageBase64,
            },
          },
          { type: "text", text: detectorScreenshotPrompt() },
        ],
      }],
      maxTokens: 1400,
    });

    const observation = normaliseDetectorScreenshotAnalysis(response.text);
    return res.json({
      observation,
      image: {
        mimeType: validated.mimeType,
        bytes: validated.bytes,
        persisted: false,
        maxBytes: 2 * 1024 * 1024,
      },
      policy: {
        purpose: "manual external detector observation extraction",
        feeds_generation_automatically: false,
        detector_vendor_contacted: false,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    if (err?.status === 413 || err?.code === "SCREENSHOT_TOO_LARGE") {
      return res.status(413).json({ error: err.code || "SCREENSHOT_TOO_LARGE", message: err.message, requestId: req.requestId });
    }
    if (["UNSUPPORTED_SCREENSHOT_TYPE", "BAD_SCREENSHOT_DATA"].includes(err?.code)) {
      return res.status(400).json({ error: err.code, message: err.message, requestId: req.requestId });
    }
    const state = err?.healthState || HealthState.PROVIDER_ERROR;
    const httpStatus =
      state === HealthState.AUTH_FAILED ? 401 :
      state === HealthState.RATE_LIMITED ? 429 :
      state === HealthState.NETWORK_TIMEOUT ? 504 :
      state === HealthState.PROVIDER_BILLING_REQUIRED ? 402 :
      state === HealthState.PROVIDER_OVERLOADED || state === HealthState.PROVIDER_UNAVAILABLE ? 503 :
      502;
    return res.status(httpStatus).json({
      error: err?.code || state,
      message: err?.message || "Detector screenshot analysis failed.",
      requestId: req.requestId,
    });
  }
});
