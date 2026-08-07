import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rewrite } from "../lib/pipeline.js";
import { llmProvider } from "../lib/llmProvider.js";

export const rewriteRouter = Router();

const TRANSIENT_STATES = new Set([
  "RATE_LIMITED",
  "NETWORK_TIMEOUT",
  "PROVIDER_OVERLOADED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_ERROR",
]);
const MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

rewriteRouter.post("/rewrite", async (req, res) => {
  const requestId = randomUUID();
  const { text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation } = req.body || {};

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string.", requestId });
  }

  if (!llmProvider.isConfigured()) {
    return res.status(503).json({
      error: "NOT_CONFIGURED",
      message: "The language-model provider is not configured on this server yet. Set ANTHROPIC_API_KEY server-side and retry.",
      requestId,
    });
  }

  let attempt = 0;
  let lastErr;
  while (attempt <= MAX_RETRIES) {
    try {
      const result = await rewrite({
        sourceText: text,
        styleFilters: styleFilters || {},
        rewriteIntensity,
        grammarIntensity,
        lengthPreference,
        naturalisation,
      });
      return res.json({ ...result, requestId });
    } catch (err) {
      lastErr = err;
      const state = err.healthState;
      const retriable = TRANSIENT_STATES.has(state);
      if (!retriable || attempt === MAX_RETRIES) break;
      const base = state === "PROVIDER_OVERLOADED" ? 2000 : state === "RATE_LIMITED" ? 2500 : 750;
      await sleep(base * 2 ** attempt);
      attempt += 1;
    }
  }

  const state = lastErr.healthState || "PROVIDER_ERROR";
  const httpStatus =
    state === "AUTH_FAILED" ? 401 :
    state === "RATE_LIMITED" ? 429 :
    state === "NETWORK_TIMEOUT" ? 504 :
    state === "PROVIDER_OVERLOADED" || state === "PROVIDER_UNAVAILABLE" ? 503 :
    502;

  res.status(httpStatus).json({
    error: lastErr.code || state,
    message: lastErr.message,
    requestId,
  });
});
