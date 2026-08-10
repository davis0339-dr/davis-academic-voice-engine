import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rewrite } from "../lib/pipeline.js";
import { assessExecutionCompliance, preferByExecutionCompliance } from "../lib/executionCompliance.js";
import { selectiveResidualRework } from "../lib/residualRework.js";
import { auditOutputAcceptance } from "../lib/outputAcceptance.js";
import { resolveRewriteModePolicy } from "../lib/rewriteModePolicy.js";
import { assessSourceBeforeRewrite } from "../lib/sourceAssessment.js";
import { deriveInterventionAuthority } from "../lib/interventionAuthority.js";
import { extractProtectedSpans } from "../lib/protect.js";
import { auditPreservation } from "../lib/preservation.js";
import { assessTransformationQuality } from "../lib/transformationQuality.js";
import { assessIterativeRegularisation } from "../lib/iterativeRewriteGuard.js";
import { surgicalHumanEdit } from "../lib/surgicalHumanEdit.js";
import {
  AUTHORIAL_EXECUTION_RECOVERY_LIMIT,
  shouldAttemptAuthorialExecutionRecovery,
  executionRecoveryAttemptSummary,
} from "../lib/underExecutionRecovery.js";
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

function underExecutionCodes(compliance) {
  return Array.isArray(compliance?.under_execution_codes) ? compliance.under_execution_codes : [];
}

function visibleChangeOnlyUnderExecution(compliance) {
  const codes = underExecutionCodes(compliance);
  return Boolean(compliance?.under_executed && codes.length > 0 && codes.every((code) => code === "VISIBLE_CHANGE_FLOOR"));
}

function hasConcreteUnderExecution(compliance) {
  if (!compliance?.under_executed) return false;
  const codes = underExecutionCodes(compliance);
  if (!codes.length) return true;
  return codes.some((code) => code !== "VISIBLE_CHANGE_FLOOR");
}

function refreshTransformationQuality(sourceText, result, revisedText, naturalisationLevel) {
  const previous = result?.transformation_quality || {};
  const refreshed = assessTransformationQuality(
    sourceText,
    revisedText,
    naturalisationLevel,
    { protectedSpans: extractProtectedSpans(sourceText) }
  );
  return {
    ...refreshed,
    corrective_retry_used: Boolean(previous.corrective_retry_used),
    rescue_retry_used: Boolean(previous.rescue_retry_used),
    first_attempt: previous.first_attempt || null,
    pre_rescue_attempt: previous.pre_rescue_attempt || null,
    recomputed_after_residual_rework: true,
  };
}

function refreshIterativeQuality(sourceText, result, revisedText, rewriteLineage) {
  const previous = result?.iterative_rewrite_quality || {};
  const refreshed = assessIterativeRegularisation({
    sourceText,
    candidateText: revisedText,
    rewriteLineage,
  });
  return {
    ...refreshed,
    first_attempt: previous.first_attempt || null,
    pre_rescue_attempt: previous.pre_rescue_attempt || null,
    recomputed_after_residual_rework: true,
  };
}

function finalCandidateStatus(
  compliance,
  residual,
  outputAcceptance,
  outputAcceptanceEnforced = false,
  sourceRetainedForSafety = false
) {
  if (sourceRetainedForSafety) return "no_safe_edit_available";
  if (!compliance?.execution_passed && !compliance?.preservation_ok) return "execution_and_preservation_failed";
  if (!compliance?.execution_passed) {
    if (compliance?.execution_status === "over-executed") return "execution_over";
    if (compliance?.execution_status === "conflicting-execution") return "execution_conflict";
    return "execution_under";
  }
  if (!compliance?.preservation_ok) return "preservation_failed";
  if (outputAcceptanceEnforced && outputAcceptance?.status !== "pass") return "internal_quality_review_required";
  if (residual?.attempted && !residual?.accepted && residual?.before?.should_rework) return "accepted_with_residual_risks";
  return "accepted";
}

rewriteRouter.post("/rewrite", async (req, res) => {
  const requestId = randomUUID();
  const { text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation, rewriteLineage } = req.body || {};

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string.", requestId });
  }

  try {
    enforceWordLimit(text, SINGLE_EDITOR_WORD_LIMIT, "Single-text editor");
    if (typeof rewriteLineage?.rootSourceText === "string" && rewriteLineage.rootSourceText.trim()) {
      enforceWordLimit(rewriteLineage.rootSourceText, SINGLE_EDITOR_WORD_LIMIT, "Rewrite lineage root source");
    }
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
    rewriteLineage,
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
      let authorialExecutionRecoveryUsed = false;
      const authorialExecutionRecoveryAttempts = [];
      const authorialExecutionRecoveryErrors = [];

      // Explicit Deep structural modes treat concrete under-execution as a
      // recoverable generation failure. The loop is independent of the internal
      // cadence/quality retries so a linguistically fluent but structurally shallow
      // candidate is not accepted merely because it preserved facts.
      if (shouldAttemptAuthorialExecutionRecovery({ modePolicy, compliance: executionCompliance })) {
        firstAttemptCompliance = executionCompliance;
        for (
          let recoveryAttempt = 1;
          recoveryAttempt <= AUTHORIAL_EXECUTION_RECOVERY_LIMIT &&
          shouldAttemptAuthorialExecutionRecovery({ modePolicy, compliance: executionCompliance });
          recoveryAttempt += 1
        ) {
          authorialExecutionRecoveryUsed = true;
          try {
            const recoveryResult = enrichForCompliance(await runRewriteWith({
              intensity: "deep",
              naturalisationLevel: "aggressive",
            }));
            const recoveryCompliance = assessExecutionCompliance(recoveryResult);

            // A recovery candidate that damages preservation or overshoots its
            // authorised breadth must not replace a safer candidate merely because
            // it changed more text. Reject it and use the remaining recovery budget.
            let preferred;
            if (!recoveryCompliance.preservation_ok || recoveryCompliance.over_executed) {
              preferred = { result, compliance: executionCompliance, selected: "first" };
            } else {
              preferred = preferByExecutionCompliance(result, recoveryResult);
            }

            const selectedRecovery = preferred.selected === "second";
            authorialExecutionRecoveryAttempts.push(executionRecoveryAttemptSummary({
              attempt: recoveryAttempt,
              compliance: recoveryCompliance,
              selected: selectedRecovery,
            }));

            result = preferred.result;
            executionCompliance = preferred.compliance;
            if (selectedRecovery) selectedAttempt = `authorial-execution-recovery-${recoveryAttempt}`;

            if (executionCompliance.execution_passed && executionCompliance.preservation_ok) break;
          } catch (retryErr) {
            authorialExecutionRecoveryErrors.push({
              attempt: recoveryAttempt,
              code: retryErr.code || retryErr.healthState || "AUTHORIAL_EXECUTION_RECOVERY_FAILED",
              message: retryErr.message || "The Deep structural execution recovery attempt failed.",
            });
          }
        }
      }

      // High-preservation over-execution remains a separate failure mode. It is
      // never used merely because Deep reconstruction under-executed.
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
              iterative_rewrite_quality: refreshIterativeQuality(text, result, surgicalRecovery.revised_text, rewriteLineage),
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
            iterative_rewrite_quality: refreshIterativeQuality(text, result, text, rewriteLineage),
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

      // Ordinary modes retain the existing one-shot reconciliation rule. Explicit
      // Deep structural modes use the dedicated recovery loop above and are never
      // suppressed merely because the internal quality pipeline already ran.
      if (
        !authorialExecutionRecoveryUsed &&
        !sourceRetainedForSafety &&
        !overExecutionRecoveryUsed &&
        hasConcreteUnderExecution(executionCompliance) &&
        !executionCompliance.over_executed &&
        modePolicy.effective_naturalisation !== "off" &&
        !qualityPipelineAlreadyRetried(result)
      ) {
        firstAttemptCompliance = firstAttemptCompliance || executionCompliance;
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

      let residualRework = null;
      let residualStageEligible = false;
      let residualStageBlockedReason = null;
      const visibleOnlyUnder = visibleChangeOnlyUnderExecution(executionCompliance);
      residualStageEligible = Boolean(
        !sourceRetainedForSafety &&
        !overExecutionRecoveryUsed &&
        executionCompliance.preservation_ok &&
        !executionCompliance.over_executed &&
        (executionCompliance.execution_passed || visibleOnlyUnder) &&
        modePolicy.effective_naturalisation !== "off"
      );

      if (!residualStageEligible) {
        if (sourceRetainedForSafety) residualStageBlockedReason = "non_edit_result";
        else if (overExecutionRecoveryUsed) residualStageBlockedReason = "surgical_recovery_is_final";
        else if (modePolicy.effective_naturalisation === "off") residualStageBlockedReason = "naturalisation_off";
        else if (!executionCompliance.preservation_ok) residualStageBlockedReason = "preservation_failed";
        else if (executionCompliance.over_executed) residualStageBlockedReason = "over_execution";
        else residualStageBlockedReason = "concrete_execution_failure";
      }

      if (residualStageEligible) {
        try {
          residualRework = await selectiveResidualRework({
            sourceText: text,
            candidateText: result.revised_text,
            styleFilters: styleFilters || {},
            rewriteIntensity: modePolicy.effective_intensity,
            naturalisation: modePolicy.effective_naturalisation,
            planSummary: result.intervention_plan_summary || {},
          });
          if (residualRework.accepted) {
            const refreshedQuality = refreshTransformationQuality(
              text,
              result,
              residualRework.revised_text,
              modePolicy.effective_naturalisation
            );
            result = {
              ...result,
              revised_text: residualRework.revised_text,
              preservation: residualRework.preservation || result.preservation,
              transformation_quality: refreshedQuality,
              iterative_rewrite_quality: refreshIterativeQuality(text, result, residualRework.revised_text, rewriteLineage),
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

      const completedOutputAcceptance = auditOutputAcceptance({
        sourceText: text,
        candidateText: result.revised_text,
        styleFilters: styleFilters || {},
        rewriteIntensity: modePolicy.effective_intensity,
        naturalisation: modePolicy.effective_naturalisation,
        planSummary: result.intervention_plan_summary || {},
      });
      const outputAcceptanceEnforced = Boolean(
        ["moderate", "deep"].includes(String(modePolicy.effective_intensity || "").toLowerCase()) &&
        ["aggressive", "authorial"].includes(String(modePolicy.effective_naturalisation || "").toLowerCase())
      );
      result.output_acceptance = {
        ...completedOutputAcceptance,
        enforced_for_final_release: outputAcceptanceEnforced,
      };

      result.execution_compliance = {
        ...executionCompliance,
        reconciliation_retry_used: reconciliationRetryUsed,
        reconciliation_retry_error: reconciliationRetryError,
        preservation_recovery_used: preservationRecoveryUsed,
        preservation_recovery_error: preservationRecoveryError,
        authorial_execution_recovery_used: authorialExecutionRecoveryUsed,
        authorial_execution_recovery_attempts: authorialExecutionRecoveryAttempts,
        authorial_execution_recovery_errors: authorialExecutionRecoveryErrors,
        over_execution_recovery_used: overExecutionRecoveryUsed,
        over_execution_recovery_error: overExecutionRecoveryError,
        surgical_recovery_used: Boolean(surgicalRecovery?.attempted),
        surgical_recovery_applied_edits: surgicalRecovery?.applied_edit_count ?? 0,
        source_retained_for_safety: sourceRetainedForSafety,
        rejected_over_execution: rejectedOverExecution,
        selected_attempt: sourceRetainedForSafety ? "transparent-no-edit-fallback" : selectedAttempt,
        first_attempt: firstAttemptCompliance,
        residual_stage_eligible: residualStageEligible,
        residual_stage_blocked_reason: residualStageBlockedReason,
        max_authorial_execution_recovery_retries: AUTHORIAL_EXECUTION_RECOVERY_LIMIT,
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

      const residualVerdict = sourceRetainedForSafety
        ? "not_run_on_non_edit_result"
        : overExecutionRecoveryUsed
          ? "surgical_local_recovery"
          : residualRework?.attempted
            ? (residualRework.accepted ? "improved" : "unresolved_or_rejected")
            : residualStageEligible
              ? "not_required"
              : modePolicy.effective_naturalisation === "off"
                ? "not_applicable"
                : "not_run_execution_blocked";

      let verdictNote;
      if (sourceRetainedForSafety) {
        verdictNote = "No safe local correction survived after the broad rewrite exceeded authorial-preservation authority. The source is unchanged and this result is explicitly classified as a non-edit, not a successful revision.";
      } else if (authorialExecutionRecoveryUsed && executionCompliance.execution_passed && executionCompliance.preservation_ok) {
        verdictNote = "The first Deep candidate under-executed the structural plan. Automatic Deep execution recovery produced a preservation-safe candidate that now satisfies execution compliance; under-execution was treated as a generation defect, not as a safe stopping point.";
      } else if (authorialExecutionRecoveryUsed && executionCompliance.under_executed) {
        verdictNote = `Deep reconstruction remained under-executed after ${authorialExecutionRecoveryAttempts.length} recovery attempt(s). This is reported as an execution failure, not as a successful safety-preserving revision.`;
      } else if (overExecutionRecoveryUsed) {
        verdictNote = executionCompliance.deep_plan_superseded_by_surgical_fallback
          ? "The broad Deep rewrite was rejected for over-editing and a bounded surgical fallback was applied. That local fallback may be preservation-safe, but it is explicitly classified as under-execution of the requested Deep structural plan rather than a successful Deep revision."
          : "The broad rewrite was rejected for over-editing. Only exact local grammar/clarity corrections that passed preservation and intervention ceilings were applied; all other source wording was retained.";
      } else if (residualVerdict === "not_run_execution_blocked") {
        verdictNote = "Residual discourse quality was not declared unnecessary: that stage was blocked by a concrete execution failure. Final status separates concrete plan execution, preservation-aware visible-change plausibility, maximum authorised breadth, factual preservation and residual discourse risk.";
      } else if (outputAcceptanceEnforced && completedOutputAcceptance.status !== "pass") {
        verdictNote = `Completed-output acceptance did not clear this ${modePolicy.effective_intensity} + ${modePolicy.effective_naturalisation} candidate. Residual machine-pattern regularity, source-skeleton dependence or another completed-output quality condition remains unresolved. Do not treat this as a successful authorial result or spend an external detector check until the internal gate passes.`;
      } else if (result.iterative_rewrite_quality?.blocking) {
        verdictNote = "The candidate still shows cumulative rewrite-chain regularisation relative to the retained root source. It is preserved for auditability, but the result should be reviewed rather than treated as a successful authorial recovery.";
      } else {
        verdictNote = "Final status separates concrete plan execution, preservation-aware visible-change plausibility, maximum authorised breadth, factual preservation, rewrite-chain regularisation and residual discourse risk. Strong existing authorial texture narrows ordinary modes; Deep reconstruction may materially redevelop diagnosed passages without requiring lexical inflation or uniform polish.";
      }

      result.candidate_verdict = {
        execution: sourceRetainedForSafety
          ? "no-safe-edit-available"
          : executionCompliance.execution_status || (executionCompliance.execution_passed ? "passed" : "under-executed"),
        preservation: sourceRetainedForSafety ? "source-preserved" : executionCompliance.preservation_ok ? "passed" : "failed",
        residual: residualVerdict,
        rewrite_chain: result.iterative_rewrite_quality?.available
          ? (result.iterative_rewrite_quality.blocking ? "regularisation-risk" : "within-root-register-band")
          : "not-applicable",
        output_acceptance: completedOutputAcceptance.status,
        output_acceptance_score: completedOutputAcceptance.score,
        output_acceptance_enforced: outputAcceptanceEnforced,
        external_detector_check_recommended: Boolean(
          completedOutputAcceptance.release_gate?.external_detector_check_recommended &&
          (!outputAcceptanceEnforced || completedOutputAcceptance.status === "pass")
        ),
        final_status: finalCandidateStatus(
          executionCompliance,
          residualRework,
          completedOutputAcceptance,
          outputAcceptanceEnforced,
          sourceRetainedForSafety
        ),
        note: verdictNote,
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

  const state = lastErr?.healthState || "PROVIDER_ERROR";
  const httpStatus =
    state === "AUTH_FAILED" ? 401 :
    state === "RATE_LIMITED" ? 429 :
    state === "NETWORK_TIMEOUT" ? 504 :
    state === "PROVIDER_OVERLOADED" || state === "PROVIDER_UNAVAILABLE" ? 503 :
    502;

  res.status(httpStatus).json({
    error: lastErr?.code || state,
    message: lastErr?.message || "Rewrite failed.",
    requestId,
  });
});