import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rewrite } from "../lib/pipeline.js";
import { assessExecutionCompliance, preferByExecutionCompliance } from "../lib/executionCompliance.js";
import { selectiveResidualRework } from "../lib/residualRework.js";
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

function finalCandidateStatus(compliance, residual) {
  if (!compliance?.execution_passed && !compliance?.preservation_ok) return "execution_and_preservation_failed";
  if (!compliance?.execution_passed) return "execution_under";
  if (!compliance?.preservation_ok) return "preservation_failed";
  if (residual?.attempted && !residual?.accepted && residual?.before?.should_rework) return "accepted_with_residual_risks";
  return "accepted";
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
      let preservationRecoveryUsed = false;
      let preservationRecoveryError = null;
      let firstAttemptCompliance = null;
      let selectedAttempt = "first";

      // Execution reconciliation is only about insufficient plan execution.
      // Preservation failures no longer masquerade as under-execution.
      if (
        !executionCompliance.execution_passed &&
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
          reconciliationRetryError = {
            code: retryErr.code || retryErr.healthState || "RECONCILIATION_RETRY_FAILED",
            message: retryErr.message || "The optional reconciliation retry failed; the first candidate was retained.",
          };
        }
      }

      // If the candidate executed deeply but damaged protected content, make one
      // bounded fresh attempt. This recovery is allowed even when aggressive
      // quality correction happened inside the first pipeline call; factual
      // preservation has priority over rewrite depth.
      if (!executionCompliance.preservation_ok && !reconciliationRetryUsed) {
        preservationRecoveryUsed = true;
        try {
          const recoveryResult = await rewrite({
            sourceText: text,
            styleFilters: styleFilters || {},
            rewriteIntensity,
            grammarIntensity,
            lengthPreference,
            naturalisation,
          });
          const preferred = preferByExecutionCompliance(result, recoveryResult);
          result = preferred.result;
          executionCompliance = preferred.compliance;
          selectedAttempt = preferred.selected === "second" ? "preservation-recovery" : selectedAttempt;
        } catch (retryErr) {
          preservationRecoveryError = {
            code: retryErr.code || retryErr.healthState || "PRESERVATION_RECOVERY_FAILED",
            message: retryErr.message || "The optional preservation recovery failed; the existing candidate was retained.",
          };
        }
      }

      // Dynamic second stage: diagnose the revised candidate itself and repair
      // only residual problematic paragraphs. Unaffected paragraphs are locked.
      // The selective result is accepted only if residual risk falls AND all
      // factual/preservation safeguards still pass.
      let residualRework = null;
      if (
        executionCompliance.execution_passed &&
        executionCompliance.preservation_ok &&
        (naturalisation || "faithful") !== "off"
      ) {
        try {
          residualRework = await selectiveResidualRework({
            sourceText: text,
            candidateText: result.revised_text,
          });
          if (residualRework.accepted) {
            result = {
              ...result,
              revised_text: residualRework.revised_text,
              preservation: residualRework.preservation || result.preservation,
            };
            executionCompliance = assessExecutionCompliance(result);
          }
        } catch (residualErr) {
          residualRework = {
            attempted: true,
            accepted: false,
            reason: "Selective residual rework failed safely; the accepted first-stage candidate was retained.",
            error: {
              code: residualErr.code || residualErr.healthState || "RESIDUAL_REWORK_FAILED",
              message: residualErr.message || "Residual rework failed.",
            },
          };
        }
      }

      result.execution_compliance = {
        ...executionCompliance,
        reconciliation_retry_used: reconciliationRetryUsed,
        reconciliation_retry_error: reconciliationRetryError,
        preservation_recovery_used: preservationRecoveryUsed,
        preservation_recovery_error: preservationRecoveryError,
        selected_attempt: selectedAttempt,
        first_attempt: firstAttemptCompliance,
        max_reconciliation_retries: 1,
        max_preservation_recovery_retries: 1,
      };

      result.residual_rework = residualRework;
      result.post_rewrite_diagnostics = residualRework?.after || residualRework?.before || null;
      result.candidate_verdict = {
        execution: executionCompliance.execution_passed ? "passed" : "under-executed",
        preservation: executionCompliance.preservation_ok ? "passed" : "failed",
        residual: residualRework?.attempted
          ? (residualRework.accepted ? "improved" : "unresolved_or_rejected")
          : "not_required",
        final_status: finalCandidateStatus(executionCompliance, residualRework),
        note: "Final status separates plan execution, factual preservation and residual writing-quality risk. A deeper rewrite is never preferred solely because it changes more text.",
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
