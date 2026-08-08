import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rewrite } from "../lib/pipeline.js";
import { assessExecutionCompliance, preferByExecutionCompliance } from "../lib/executionCompliance.js";
import { llmProvider } from "../lib/llmProvider.js";
import { SINGLE_EDITOR_WORD_LIMIT, enforceWordLimit } from "../config/limits.js";

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

function qualityPipelineAlreadyRetried(result) {
  return Boolean(
    result?.transformation_quality?.corrective_retry_used ||
    result?.transformation_quality?.rescue_retry_used
  );
}

rewriteRouter.post("/rewrite", async (req, res) => {
  const requestId = randomUUID();
  const { text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation } = req.body || {};

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string.", requestId });
  }

  try {
    enforceWordLimit(text, SINGLE_EDITOR_WORD_LIMIT, "Single-text editor");
  } catch (err) {
    return res.status(413).json({
      error: err.code,
      message: `${err.message} Use Long Document for larger material.`,
      wordCount: err.wordCount,
      wordLimit: err.wordLimit,
      requestId,
    });
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
      let result = await rewrite({
        sourceText: text,
        styleFilters: styleFilters || {},
        rewriteIntensity,
        grammarIntensity,
        lengthPreference,
        naturalisation,
      });

      let executionCompliance = assessExecutionCompliance(result);
      let reconciliationRetryUsed = false;
      let reconciliationRetryError = null;
      let firstAttemptCompliance = null;
      let selectedAttempt = "first";

      // Faithful/auto revisions previously had no rewrite-depth reconciliation
      // gate. If a substantial planner demand is under-executed, make exactly
      // one fresh attempt with the same user settings. Aggressive candidates
      // that already consumed the pipeline's correction/rescue retries are not
      // multiplied again here; their compliance result remains visible instead.
      if (
        !executionCompliance.passed &&
        (naturalisation || "faithful") !== "off" &&
        !qualityPipelineAlreadyRetried(result)
      ) {
        firstAttemptCompliance = executionCompliance;
        reconciliationRetryUsed = true;
        try {
          const secondResult = await rewrite({
            sourceText: text,
            styleFilters: styleFilters || {},
            rewriteIntensity,
            grammarIntensity,
            lengthPreference,
            naturalisation,
          });
          const preferred = preferByExecutionCompliance(result, secondResult);
          result = preferred.result;
          executionCompliance = preferred.compliance;
          selectedAttempt = preferred.selected;
        } catch (retryErr) {
          // The first candidate is already valid enough to return. A bounded
          // quality reconciliation retry must never turn that success into a
          // failed user request merely because the provider was unavailable or
          // the second model response was malformed.
          reconciliationRetryError = {
            code: retryErr.code || retryErr.healthState || "RECONCILIATION_RETRY_FAILED",
            message: retryErr.message || "The optional reconciliation retry failed; the first candidate was retained.",
          };
        }
      }

      result.execution_compliance = {
        ...executionCompliance,
        reconciliation_retry_used: reconciliationRetryUsed,
        reconciliation_retry_error: reconciliationRetryError,
        selected_attempt: selectedAttempt,
        first_attempt: firstAttemptCompliance,
        max_reconciliation_retries: 1,
      };

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
