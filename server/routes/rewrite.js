import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rewrite } from "../lib/pipeline.js";
import { assessExecutionCompliance } from "../lib/executionCompliance.js";
import { selectiveResidualRework } from "../lib/residualRework.js";
import { auditOutputAcceptance } from "../lib/outputAcceptance.js";
import { resolveRewriteModePolicy } from "../lib/rewriteModePolicy.js";
import { assessSourceBeforeRewrite } from "../lib/sourceAssessment.js";
import { deriveInterventionAuthority } from "../lib/interventionAuthority.js";
import { extractProtectedSpans } from "../lib/protect.js";
import { assessTransformationQuality } from "../lib/transformationQuality.js";
import { assessIterativeRegularisation } from "../lib/iterativeRewriteGuard.js";
import { llmProvider } from "../lib/llmProvider.js";
import { SINGLE_EDITOR_WORD_LIMIT, SINGLE_REFINEMENT_WORD_LIMIT, enforceWordLimit } from "../config/limits.js";
import { normalizeAdditionalInputs, normalizeRevisionPurpose } from "../lib/collaborativeRevision.js";
import { repairPreservationCandidate } from "../lib/preservationRepair.js";
import { classifyPreservationRelease } from "../lib/preservationRelease.js";
import { preservationCandidateStatus, selectPreservationRepairCandidate } from "../lib/preservationLifecycle.js";
import { candidateHistoryFor, isHistoricalDuplicate, rememberCandidate } from "../lib/candidateHistory.js";
import { DEFAULT_EXPAND_MIN_ADDITION_WORDS, manuscriptWordCount } from "../lib/lengthContract.js";
import { auditFeedbackRefinementChange, resolveDetectorFeedback } from "../lib/detectorFeedback.js";
import { auditPreservation } from "../lib/preservation.js";
import { analyseResidualWriting } from "../lib/residualDiagnostics.js";
import { assessAuthorialAnchor, AUTHORIAL_ANCHOR_MAX_WORDS } from "../lib/authorialAnchor.js";

export const rewriteRouter = Router();

const TRANSIENT_STATES = new Set([
  "RATE_LIMITED",
  "PROVIDER_OVERLOADED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_ERROR",
]);
const MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    corrective_retry_error: previous.corrective_retry_error || null,
    rescue_retry_error: previous.rescue_retry_error || null,
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

rewriteRouter.post("/rewrite", llmProvider.usageMiddleware, async (req, res) => {
  const requestId = randomUUID();
  const { text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation, revisionPurpose, rewriteLineage, detectorFeedback, refinementMode, authorialAnchor } = req.body || {};
  const effectiveRevisionPurpose = normalizeRevisionPurpose(revisionPurpose);
  const minimumExpansionWords = DEFAULT_EXPAND_MIN_ADDITION_WORDS;
  const rootSourceText = typeof rewriteLineage?.rootSourceText === "string" ? rewriteLineage.rootSourceText.trim() : "";
  const candidateRefinement = refinementMode === "tested_candidate";
  if (candidateRefinement && (!rootSourceText || Number(rewriteLineage?.sourceGeneration || 0) < 1)) {
    return res.status(400).json({ error: "INVALID_REFINEMENT_LINEAGE", message: "Candidate refinement requires an exact tested candidate and its retained original source.", requestId });
  }
  if (candidateRefinement && Number(rewriteLineage?.sourceGeneration || 0) >= 3) {
    return res.status(409).json({ error: "REFINEMENT_LIMIT_REACHED", message: "This candidate has already used the two bounded feedback-guided refinements. Compare the retained versions or begin a new researcher-authorised revision lineage.", requestId });
  }
  const auditAnchorText = candidateRefinement ? rootSourceText : text;

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string.", requestId });
  }

  try {
    enforceWordLimit(text, candidateRefinement ? SINGLE_REFINEMENT_WORD_LIMIT : SINGLE_EDITOR_WORD_LIMIT, candidateRefinement ? "Tested-candidate refinement" : "Single-text editor");
    if (typeof rewriteLineage?.rootSourceText === "string" && rewriteLineage.rootSourceText.trim()) {
      enforceWordLimit(rewriteLineage.rootSourceText, SINGLE_EDITOR_WORD_LIMIT, "Rewrite lineage root source");
    }
    if (typeof authorialAnchor === "string" && authorialAnchor.trim()) {
      enforceWordLimit(authorialAnchor, AUTHORIAL_ANCHOR_MAX_WORDS, "Researcher-authored calibration sample");
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
  const priorCandidateHistory = candidateHistoryFor({
    sourceText: auditAnchorText,
    rewriteIntensity: modePolicy.effective_intensity,
    naturalisation: modePolicy.effective_naturalisation,
    lengthPreference,
  });
  const detectorFeedbackProfile = resolveDetectorFeedback(detectorFeedback, priorCandidateHistory, candidateRefinement ? text : "");
  const authorialAnchorAssessment = assessAuthorialAnchor(authorialAnchor);
  if (candidateRefinement && detectorFeedbackProfile?.high_machine_pattern_signal && !authorialAnchorAssessment.sufficient) {
    return res.status(422).json({
      error: "AUTHORIAL_ANCHOR_REQUIRED",
      message: `This detector-guided retry requires ${authorialAnchorAssessment.minimum_words}-${authorialAnchorAssessment.maximum_words} words genuinely written by the researcher. Another blind model-only reconstruction would repeat the failure pattern and spend provider credits without an authorial reference.`,
      authorial_anchor: authorialAnchorAssessment,
      requestId,
    });
  }

  const runRewrite = () => rewrite({
    sourceText: text,
    styleFilters: styleFilters || {},
    rewriteIntensity: modePolicy.effective_intensity,
    grammarIntensity,
    lengthPreference,
    naturalisation: modePolicy.effective_naturalisation,
    revisionPurpose: effectiveRevisionPurpose,
    rewriteLineage,
    priorCandidateHistory,
    minimumExpansionWords,
    detectorFeedback: detectorFeedbackProfile,
    authorialAnchor,
  });

  function applyDualAnchorPreservation(result) {
    if (!result?.revised_text) return result;
    const immediate = auditPreservation(text, result.revised_text, extractProtectedSpans(text), { lengthPreference });
    const root = auditPreservation(auditAnchorText, result.revised_text, extractProtectedSpans(auditAnchorText), { lengthPreference });
    return {
      ...result,
      preservation: root,
      preservation_chain: {
        mode: candidateRefinement ? "dual_anchor" : "single_anchor",
        authoritative_anchor: "root_source",
        root,
        immediate_candidate: immediate,
      },
    };
  }

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
      let result = applyDualAnchorPreservation(enrichForCompliance(await runRewrite()));
      let executionCompliance = assessExecutionCompliance(result);

      const reconciliationRetryUsed = false;
      const reconciliationRetryError = null;
      let preservationRecoveryUsed = false;
      let preservationRecoveryError = null;
      const overExecutionRecoveryUsed = false;
      const overExecutionRecoveryError = null;
      const surgicalRecovery = null;
      const sourceRetainedForSafety = false;
      const rejectedOverExecution = null;
      let rejectedPreservationFailure = null;
      const firstAttemptCompliance = null;
      let selectedAttempt = "first";
      const authorialExecutionRecoveryUsed = false;
      const authorialExecutionRecoveryAttempts = [];
      const authorialExecutionRecoveryErrors = [];
      // Full-manuscript regeneration repeatedly converged on the same fluent local
      // optimum while multiplying latency and provider cost. Execution defects are
      // now handed to the bounded paragraph-level residual pass below.
      const fullDocumentExecutionRecoveryAllowed = false;
      // A high changed-sentence percentage is not semantic damage. Do not discard
      // a broad reconstruction or replace it with a surface edit merely because
      // it exceeded a planner breadth estimate; the preservation audit below is
      // the release authority for facts, evidence and argumentative force.
      const overExecutionRecoveryAllowed = false;

      // Full-document execution and over-edit recovery are intentionally absent.
      // They previously spent extra calls, converged on near-duplicate prose and
      // could replace a complete revision with the source. Execution diagnostics
      // remain visible; only the bounded preservation repair below may spend one
      // additional call, and it can never suppress the existing candidate.

      if (
        !sourceRetainedForSafety &&
        !overExecutionRecoveryUsed &&
        !executionCompliance.preservation_ok
      ) {
        preservationRecoveryUsed = true;
        try {
          const repairedResult = await repairPreservationCandidate({
            sourceText: auditAnchorText,
            candidateResult: result,
            revisionPurpose: effectiveRevisionPurpose,
            lengthPreference,
            minimumExpansionWords,
          });
          const repairSelection = selectPreservationRepairCandidate(result, repairedResult);
          if (repairSelection.selected === "repaired") {
            result = applyDualAnchorPreservation({
              ...repairSelection.result,
              transformation_quality: refreshTransformationQuality(
                text,
                result,
                repairSelection.result.revised_text,
                modePolicy.effective_naturalisation
              ),
              iterative_rewrite_quality: refreshIterativeQuality(
                text,
                result,
                repairSelection.result.revised_text,
                rewriteLineage
              ),
            });
            executionCompliance = assessExecutionCompliance(result);
            selectedAttempt = "preservation-candidate-repair";
            if (!repairSelection.length_contract_satisfied) {
              preservationRecoveryError = {
                code: "PRESERVATION_REPAIRED_LENGTH_REVIEW_REQUIRED",
                message: "The safer repaired candidate was retained, but it remains below the selected Expand length contract and is returned for researcher review.",
              };
            }
          } else {
            preservationRecoveryError = {
              code: "PRESERVATION_REPAIR_REJECTED",
              message: "The repair candidate did not clear concrete preservation; the prior complete candidate was retained for researcher review.",
            };
          }
        } catch (retryErr) {
          preservationRecoveryError = {
            code: retryErr.code || retryErr.healthState || "PRESERVATION_RECOVERY_FAILED",
            message: retryErr.message || "The optional preservation recovery failed; the existing candidate was retained.",
          };
        }
      }

      // Preservation governs clearance, not visibility. Concrete or semantic-
      // force defects receive one bounded repair above. If that repair cannot
      // clear every issue, retain the complete candidate with an explicit review
      // status instead of erasing paid work and returning an empty Revised box.
      let preservationRelease = classifyPreservationRelease(result.preservation);
      if (!sourceRetainedForSafety && !executionCompliance.preservation_ok && preservationRelease.hard_failure) {
        rejectedPreservationFailure = {
          compliance: executionCompliance,
          preservation: result.preservation || null,
          selected_attempt: selectedAttempt,
          candidate_retained_for_review: true,
        };
        preservationRelease = {
          ...preservationRelease,
          candidate_quarantined: false,
          candidate_retained_for_review: true,
        };
      } else {
        preservationRelease = classifyPreservationRelease(result.preservation);
      }
      result.preservation_release = preservationRelease;

      let residualRework = null;
      let residualStageEligible = false;
      let residualStageBlockedReason = null;
      const optionalProviderFailure = Boolean(
        result.transformation_quality?.corrective_retry_error ||
        result.transformation_quality?.rescue_retry_error
      );
      residualStageEligible = Boolean(
        !sourceRetainedForSafety &&
        !overExecutionRecoveryUsed &&
        !optionalProviderFailure &&
        executionCompliance.preservation_ok &&
        !executionCompliance.over_executed &&
        modePolicy.effective_naturalisation !== "off"
      );

      if (!residualStageEligible) {
        if (sourceRetainedForSafety) residualStageBlockedReason = "non_edit_result";
        else if (overExecutionRecoveryUsed) residualStageBlockedReason = "surgical_recovery_is_final";
        else if (optionalProviderFailure) residualStageBlockedReason = "provider_refinement_failed";
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
            lengthPreference,
            minimumExpansionWords,
            maxBlocks: detectorFeedbackProfile?.high_machine_pattern_signal ? 8 : 4,
          });
          if (residualRework.accepted) {
            const refreshedQuality = refreshTransformationQuality(
              text,
              result,
              residualRework.revised_text,
              modePolicy.effective_naturalisation
            );
            result = applyDualAnchorPreservation({
              ...result,
              revised_text: residualRework.revised_text,
              preservation: residualRework.preservation || result.preservation,
              transformation_quality: refreshedQuality,
              iterative_rewrite_quality: refreshIterativeQuality(text, result, residualRework.revised_text, rewriteLineage),
            });
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

      const baseOutputAcceptance = auditOutputAcceptance({
        sourceText: auditAnchorText,
        candidateText: result.revised_text,
        styleFilters: styleFilters || {},
        rewriteIntensity: modePolicy.effective_intensity,
        naturalisation: modePolicy.effective_naturalisation,
        planSummary: result.intervention_plan_summary || {},
        lengthPreference,
        minimumExpansionWords,
      });
      const feedbackOpeningChangeAudit = candidateRefinement && detectorFeedbackProfile
        ? auditFeedbackRefinementChange(text, result.revised_text)
        : null;
      const historicalDuplicate = !sourceRetainedForSafety && isHistoricalDuplicate(result.revised_text, priorCandidateHistory);
      let completedOutputAcceptance = historicalDuplicate ? {
        ...baseOutputAcceptance,
        status: "review_required",
        reasons: [...new Set([...(baseOutputAcceptance.reasons || []), "historical_candidate_repetition"])],
        release_gate: {
          ...(baseOutputAcceptance.release_gate || {}),
          external_detector_check_recommended: false,
        },
      } : baseOutputAcceptance;
      if (feedbackOpeningChangeAudit?.available && !feedbackOpeningChangeAudit.materially_reconstructed) {
        completedOutputAcceptance = {
          ...completedOutputAcceptance,
          status: "review_required",
          reasons: [...new Set([...(completedOutputAcceptance.reasons || []), "feedback_opening_reconstruction_insufficient"])],
        };
      }
      const outputAcceptanceEnforced = false;
      result.output_acceptance = {
        ...completedOutputAcceptance,
        enforced_for_final_release: outputAcceptanceEnforced,
      };
      if (result.length_contract?.mode === "expand") {
        const actualAddition = manuscriptWordCount(result.revised_text) - manuscriptWordCount(auditAnchorText);
        result.length_contract = {
          ...result.length_contract,
          actual_addition_words: actualAddition,
          satisfied: actualAddition >= minimumExpansionWords,
          effective_outcome: actualAddition >= minimumExpansionWords ? "expand_completed" : "maintain_fallback",
          outcome_note: actualAddition >= minimumExpansionWords
            ? `Expand completed with ${actualAddition} net additional words.`
            : `The bounded Expand attempt could not add ${minimumExpansionWords} words without losing preservation or completed-output quality. This complete draft is returned as an explicit Maintain fallback, not mislabelled as Expand.`,
        };
      }
      result.candidate_history = {
        prior_candidate_count: priorCandidateHistory.candidates.length,
        exact_historical_duplicate: historicalDuplicate,
        repetition_blocking: historicalDuplicate,
        detector_feedback_received: Boolean(detectorFeedback),
        detector_feedback_applied: Boolean(detectorFeedbackProfile),
        refinement_mode: candidateRefinement ? "tested_candidate" : "source",
        root_source_anchor_used: candidateRefinement,
        source_generation: Number(rewriteLineage?.sourceGeneration || 0),
        maximum_feedback_refinements: 2,
        feedback_opening_change_audit: feedbackOpeningChangeAudit,
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
        rejected_preservation_failure: rejectedPreservationFailure,
        selected_attempt: sourceRetainedForSafety ? "transparent-no-edit-fallback" : selectedAttempt,
        first_attempt: firstAttemptCompliance,
        residual_stage_eligible: residualStageEligible,
        residual_stage_blocked_reason: residualStageBlockedReason,
        full_document_execution_recovery_allowed: fullDocumentExecutionRecoveryAllowed,
        execution_repair_deferred_to_selective_residual: true,
        max_authorial_execution_recovery_retries: 0,
        max_reconciliation_retries: 0,
        max_preservation_recovery_retries: 1,
        over_execution_recovery_allowed: overExecutionRecoveryAllowed,
        max_over_execution_recovery_retries: 0,
      };

      result.rewrite_mode_policy = modePolicy;
      result.residual_rework = residualRework;
      // Always diagnose the candidate actually returned. Previously a
      // preservation-blocked residual stage left this null, and the UI rendered
      // "0 post-rewrite signals" even when the final candidate still contained
      // strong triadic and balanced-contrast recurrence.
      result.post_rewrite_diagnostics = residualRework?.after || residualRework?.before || analyseResidualWriting(result.revised_text);
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
        verdictNote = result.safety_fallback?.reason || "No safe revision survived the final safeguards. The source is unchanged and this result is explicitly classified as a non-edit, not a successful revision.";
      } else if (preservationRelease.hard_failure) {
        verdictNote = "Revision delivered for researcher review. One bounded repair was unable to clear every concrete evidence, stage, structure or semantic-force warning. The complete draft remains visible and is not labelled accepted; inspect the Preservation panel before use.";
      } else if (!preservationRelease.candidate_may_be_labelled_accepted) {
        verdictNote = "Revision delivered for researcher review. Concrete evidence invariants passed, but material rhetorical-semantic preservation still requires review before internal clearance.";
      } else if (preservationRelease.review_required) {
        verdictNote = "Revision delivered and internally cleared with advisory evidence. Concrete evidence, study stage and semantic force passed; non-blocking rhetorical-marker, voice or soft-length signals remain visible for researcher judgement.";
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
        verdictNote = "Revision delivered and internally cleared. Protected facts, citations, study stage and semantic force passed the shared release boundary. Execution breadth, rewrite-chain regularisation and machine-pattern diagnostics remain visible evidence for refinement rather than hidden vetoes.";
      }

      result.candidate_verdict = {
        execution: sourceRetainedForSafety ? "no-safe-edit-available" : preservationRelease.candidate_may_be_labelled_accepted ? "completed" : "completed-for-review",
        execution_diagnostic: executionCompliance.execution_status || (executionCompliance.execution_passed ? "passed" : "under-executed"),
        preservation: sourceRetainedForSafety ? "source-preserved" : preservationRelease.hard_failure ? "repair-or-review-required" : !preservationRelease.candidate_may_be_labelled_accepted ? "review-required" : preservationRelease.review_required ? "passed-with-advisory" : "passed",
        residual: sourceRetainedForSafety ? residualVerdict : residualRework?.accepted ? "improved" : "advisory",
        residual_diagnostic: residualVerdict,
        rewrite_chain: result.iterative_rewrite_quality?.available
          ? (result.iterative_rewrite_quality.blocking ? "advisory" : "within-root-register-band")
          : "not-applicable",
        output_acceptance: completedOutputAcceptance.status,
        output_acceptance_score: completedOutputAcceptance.score,
        output_acceptance_enforced: outputAcceptanceEnforced,
        external_detector_check_recommended: Boolean(
          !sourceRetainedForSafety &&
          preservationRelease.cleared &&
          executionCompliance.execution_passed &&
          completedOutputAcceptance.status === "pass" &&
          !(completedOutputAcceptance.reasons || []).includes("expand_length_contract_missed")
        ),
        final_status: preservationCandidateStatus({
          compliance: executionCompliance,
          outputAcceptance: completedOutputAcceptance,
          sourceRetainedForSafety,
          preservationRelease,
        }),
        note: verdictNote,
      };

      result.revision_purpose = effectiveRevisionPurpose;
      result.additional_inputs = normalizeAdditionalInputs(result.additional_inputs, effectiveRevisionPurpose);
      const rememberedCandidate = !sourceRetainedForSafety ? rememberCandidate(result.revised_text, priorCandidateHistory) : null;
      result.candidate_history.current_candidate_id = rememberedCandidate?.candidate_id || null;
      return res.json({ ...result, provider_usage: llmProvider.usageSnapshot(), requestId });
    } catch (err) {
      lastErr = err;
      const state = err.healthState;
      // A timeout on a long rewrite must not restart the complete pipeline and
      // repeat the same large request. Provider overload/rate errors may still
      // receive bounded retry treatment because they normally fail quickly.
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
    state === "PROVIDER_CALL_BUDGET_EXCEEDED" ? 503 :
    state === "PROVIDER_TIME_BUDGET_EXCEEDED" ? 503 :
    state === "NETWORK_TIMEOUT" ? 504 :
    state === "PROVIDER_OVERLOADED" || state === "PROVIDER_UNAVAILABLE" ? 503 :
    502;

  res.status(httpStatus).json({
    error: lastErr?.code || state,
    message: lastErr?.message || "Rewrite failed.",
    provider_usage: llmProvider.usageSnapshot(),
    requestId,
  });
});

