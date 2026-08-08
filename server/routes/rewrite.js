import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rewrite } from "../lib/pipeline.js";
import { assessExecutionCompliance, preferByExecutionCompliance } from "../lib/executionCompliance.js";
import { selectiveResidualRework } from "../lib/residualRework.js";
import { resolveRewriteModePolicy } from "../lib/rewriteModePolicy.js";
import { assessSourceBeforeRewrite } from "../lib/sourceAssessment.js";
import { deriveInterventionAuthority } from "../lib/interventionAuthority.js";
import { extractProtectedSpans } from "../lib/protect.js";
import { auditPreservation } from "../lib/preservation.js";
import { assessTransformationQuality } from "../lib/transformationQuality.js";
import { surgicalHumanEdit } from "../lib/surgicalHumanEdit.js";
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

function planUnitCount(result) {
  return Object.values(result?.intervention_plan_summary || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function finalCandidateStatus(compliance, residual, sourceRetainedForSafety = false) {
  if (sourceRetainedForSafety) return "no_safe_edit_available";
  if (!compliance?.execution_passed && !compliance?.preservation_ok) return "execution_and_preservation_failed";
  if (!compliance?.execution_passed) {
    if (compliance?.execution_status === "over-executed") return "execution_over";
    if (compliance?.execution_status === "conflicting-execution") return "execution_conflict";
    return "execution_under";
  }
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

  // Source texture is assessed BEFORE the rewrite mode is resolved. This means
  // human-corpus-like writing can constrain breadth before the model is called.
  const sourceAssessment = assessSourceBeforeRewrite({ text, styleFilters: styleFilters || {} });
  const modePolicy = resolveRewriteModePolicy({
    rewriteIntensity,
    naturalisation,
    authorialTexture: sourceAssessment.authorial_texture,
  });

  const runRewriteWith = ({
    intensity = modePolicy.effective_intensity,
    naturalisationLevel = modePolicy.effective_naturalisation,
  } = {}) => rewrite({
    sourceText: text,
    styleFilters: styleFilters || {},
    rewriteIntensity: intensity,
    grammarIntensity,
    lengthPreference,
    naturalisation: naturalisationLevel,
  });

  const runRewrite = () => runRewriteWith();

  function enrichForCompliance(result) {
    const authority = deriveInterventionAuthority({
      planSummary: result.intervention_plan_summary,
      authorialTexture: sourceAssessment.authorial_texture,
      requestedIntensity: modePolicy.requested_intensity,
      requestedNaturalisation: modePolicy.requested_naturalisation,
      effectiveIntent: result.intervention_intent?.effective,
    });
    return {
      ...result,
      authorial_texture: sourceAssessment.authorial_texture,
      intervention_authority: authority,
      source_assessment: {
        authorial_texture: sourceAssessment.authorial_texture,
        cadence_deviation: sourceAssessment.cadence_deviation,
        measured_language_deviation: sourceAssessment.measured_language_deviation,
        note: "Pre-generation source assessment constrains rewrite breadth. It is a preservation/style assessment, not proof of authorship.",
      },
    };
  }

  let attempt = 0;
  let lastErr;
  while (attempt <= MAX_RETRIES) {
    try {
      let result = enrichForCompliance(await runRewrite());

      let executionCompliance = assessExecutionCompliance(result);
      let reconciliationRetryUsed = false;
      let reconciliationRetryError = null;
      let preservationRecoveryUsed = false;
      let preservationRecoveryError = null;
      let overExecutionRecoveryUsed = false;
      let overExecutionRecoveryError = null;
      let surgicalRecovery = null;
      let sourceRetainedForSafety = false;
      let rejectedOverExecution = null;
      let firstAttemptCompliance = null;
      let selectedAttempt = "first";

      // HIGH-PRESERVATION SAFETY: a model that over-edits a human-textured
      // source is not allowed to trigger another whole-document paraphrase.
      // Instead, recover through exact local source-span edits. Only grammar or
      // local-clarity changes that survive deterministic preservation and breadth
      // checks are applied; the rest of the source remains byte-for-byte intact.
      if (
        executionCompliance.over_executed &&
        sourceAssessment.authorial_texture?.preservation_priority === "high"
      ) {
        overExecutionRecoveryUsed = true;
        const originalOverExecution = executionCompliance;
        const attemptedSummary = result.edit_summary;
        try {
          surgicalRecovery = await surgicalHumanEdit({
            sourceText: text,
            maxChangedSentenceRatio: result.intervention_authority?.max_changed_sentence_ratio ?? 0.35,
          });

          if (surgicalRecovery.safe_change_made) {
            const units = planUnitCount(result);
            const affected = Math.min(units, Number(surgicalRecovery.affected_sentence_count || 0));
            const protectedSpans = extractProtectedSpans(text);
            result = {
              ...result,
              revised_text: surgicalRecovery.revised_text,
              attempted_edit_summary: attemptedSummary,
              edit_summary: {
                kept: Math.max(0, units - affected),
                micro_edits: affected,
                sentence_restructures: 0,
                split_or_merge: 0,
                paragraph_reorders: 0,
                flags_for_author: [
                  `High-preservation surgical recovery applied ${surgicalRecovery.applied_edit_count} local correction(s) across ${affected} sentence(s); all unedited source text was preserved exactly.`,
                ],
              },
              preservation: surgicalRecovery.preservation,
              transformation_quality: assessTransformationQuality(
                text,
                surgicalRecovery.revised_text,
                "off",
                { protectedSpans }
              ),
              surgical_recovery: surgicalRecovery,
              safety_fallback: null,
            };
            executionCompliance = assessExecutionCompliance(result);
            selectedAttempt = "surgical-human-edit-recovery";
          }

          if (!surgicalRecovery.safe_change_made || executionCompliance.over_executed || !executionCompliance.preservation_ok) {
            rejectedOverExecution = {
              first_attempt: originalOverExecution,
              surgical_attempt: surgicalRecovery,
              surgical_compliance: surgicalRecovery.safe_change_made ? executionCompliance : null,
            };
          }
        } catch (retryErr) {
          overExecutionRecoveryError = {
            code: retryErr.code || retryErr.healthState || "SURGICAL_RECOVERY_FAILED",
            message: retryErr.message || "The surgical high-preservation recovery failed.",
          };
        }

        // Returning the source is now a LAST-resort non-edit result, never a
        // successful revision. It occurs only when no safe local correction can
        // be applied, and the response explicitly reports that no edit was made.
        if (
          !surgicalRecovery?.safe_change_made ||
          executionCompliance.over_executed ||
          !executionCompliance.preservation_ok
        ) {
          sourceRetainedForSafety = true;
          rejectedOverExecution = rejectedOverExecution || { first_attempt: originalOverExecution };
          const units = planUnitCount(result);
          result = {
            ...result,
            revised_text: text,
            attempted_edit_summary: attemptedSummary,
            edit_summary: {
              kept: units,
              micro_edits: 0,
              sentence_restructures: 0,
              split_or_merge: 0,
              paragraph_reorders: 0,
              flags_for_author: ["No safe local edit survived the high-preservation safeguard. The source was returned unchanged and is explicitly marked as a non-edit result."],
            },
            transformation_quality: assessTransformationQuality(
              text,
              text,
              "off",
              { protectedSpans: extractProtectedSpans(text) }
            ),
            preservation: auditPreservation(text, text, extractProtectedSpans(text)),
            surgical_recovery: surgicalRecovery,
            safety_fallback: {
              source_retained: true,
              successful_revision: false,
              reason: "The broad candidate exceeded intervention authority and no safe surgical correction survived. Returning unchanged text is a transparent non-edit result, not a successful revision.",
            },
          };
          executionCompliance = assessExecutionCompliance(result);
        }
      }

      // Reconciliation retries address UNDER-execution only. A model that edited
      // too much must not be rewarded with another broad whole-document rewrite.
      // A surgical recovery is also final for this request: do not follow it with
      // another broad pass merely because its intentionally local work falls below
      // the original planner's minimum restructuring load.
      if (
        !sourceRetainedForSafety &&
        !overExecutionRecoveryUsed &&
        executionCompliance.under_executed &&
        !executionCompliance.over_executed &&
        modePolicy.effective_naturalisation !== "off" &&
        !qualityPipelineAlreadyRetried(result)
      ) {
        firstAttemptCompliance = executionCompliance;
        reconciliationRetryUsed = true;
        try {
          const secondResult = enrichForCompliance(await runRewrite());
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

      // If protected content was damaged, make one bounded fresh attempt, except
      // after a high-preservation surgical path; broad regeneration would defeat
      // the purpose of the local safety recovery.
      if (
        !sourceRetainedForSafety &&
        !overExecutionRecoveryUsed &&
        !executionCompliance.preservation_ok &&
        !reconciliationRetryUsed
      ) {
        preservationRecoveryUsed = true;
        try {
          const recoveryResult = enrichForCompliance(await runRewrite());
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

      // Dynamic second stage: only after execution breadth/depth and preservation
      // are acceptable do we repair residual machine-shaped discourse locally.
      // Surgical human-text recovery is already a local second stage, so it is
      // not followed by another residual rewrite in the same request.
      let residualRework = null;
      if (
        !sourceRetainedForSafety &&
        !overExecutionRecoveryUsed &&
        executionCompliance.execution_passed &&
        executionCompliance.preservation_ok &&
        modePolicy.effective_naturalisation !== "off"
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
        over_execution_recovery_used: overExecutionRecoveryUsed,
        over_execution_recovery_error: overExecutionRecoveryError,
        surgical_recovery_used: Boolean(surgicalRecovery?.attempted),
        surgical_recovery_applied_edits: surgicalRecovery?.applied_edit_count ?? 0,
        source_retained_for_safety: sourceRetainedForSafety,
        rejected_over_execution: rejectedOverExecution,
        selected_attempt: sourceRetainedForSafety ? "transparent-no-edit-fallback" : selectedAttempt,
        first_attempt: firstAttemptCompliance,
        max_reconciliation_retries: 1,
        max_preservation_recovery_retries: 1,
        max_over_execution_recovery_retries: 1,
      };

      result.rewrite_mode_policy = modePolicy;
      result.residual_rework = residualRework;
      result.post_rewrite_diagnostics = residualRework?.after || residualRework?.before || null;
      result.naturalisation_applied = {
        ...(result.naturalisation_applied || {}),
        requested_level: modePolicy.requested_naturalisation,
        effective_generation_level: modePolicy.effective_naturalisation,
        requested_intensity: modePolicy.requested_intensity,
        effective_generation_intensity: modePolicy.effective_intensity,
        adaptive_human_reconstruction: modePolicy.adaptive_reconstruction,
        authorial_preservation_priority: sourceAssessment.authorial_texture?.preservation_priority,
        universal_rewrite_authorised: modePolicy.universal_rewrite_authorised,
        depth_permission: modePolicy.depth_permission,
        policy: modePolicy.policy,
      };
      result.candidate_verdict = {
        execution: sourceRetainedForSafety
          ? "no-safe-edit-available"
          : executionCompliance.execution_status || (executionCompliance.execution_passed ? "passed" : "under-executed"),
        preservation: sourceRetainedForSafety ? "source-preserved" : executionCompliance.preservation_ok ? "passed" : "failed",
        residual: sourceRetainedForSafety
          ? "not_run_on_non_edit_result"
          : overExecutionRecoveryUsed
            ? "surgical_local_recovery"
            : residualRework?.attempted
              ? (residualRework.accepted ? "improved" : "unresolved_or_rejected")
              : "not_required",
        final_status: finalCandidateStatus(executionCompliance, residualRework, sourceRetainedForSafety),
        note: sourceRetainedForSafety
          ? "No safe local correction survived after the broad rewrite exceeded authorial-preservation authority. The source is unchanged and this result is explicitly classified as a non-edit, not a successful revision."
          : overExecutionRecoveryUsed
            ? "The broad rewrite was rejected for over-editing. Only exact local grammar/clarity corrections that passed preservation and intervention ceilings were applied; all other source wording was retained."
            : "Final status separates minimum execution, maximum authorised breadth, factual preservation and residual writing-quality risk. Strong existing authorial texture narrows breadth; Deep/Aggressive remains permission for deep repair only where diagnostics justify it.",
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
