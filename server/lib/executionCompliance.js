// Deterministic audit of whether a model response actually followed the planner's
// requested intervention. This is not an authorship detector. Execution depth,
// execution breadth and factual preservation are separate verdicts: a candidate
// can fail because it changed too little OR because it disturbed too much.

const SUBSTANTIVE_LEVELS = new Set([
  "SENTENCE_RESTRUCTURE",
  "SPLIT_OR_MERGE",
  "PARAGRAPH_REORDER",
  "CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT",
  "COMPRESS",
]);

function sumValues(obj) {
  return Object.values(obj || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function ratio(numerator, denominator, fallback = 1) {
  if (!denominator) return fallback;
  return clamp01(numerator / denominator);
}

function plannedCounts(result) {
  const summary = result?.intervention_plan_summary || {};
  const total = sumValues(summary);
  const keep = Number(summary.KEEP || 0);
  const micro = Number(summary.MICRO_EDIT || 0);
  const substantive = [...SUBSTANTIVE_LEVELS].reduce((sum, key) => sum + Number(summary[key] || 0), 0);
  const intervention = Math.max(0, total - keep);
  return { total, keep, micro, substantive, intervention };
}

function reportedCounts(result) {
  const edit = result?.edit_summary || {};
  const kept = Number(edit.kept || 0);
  const micro = Number(edit.micro_edits || 0);
  const restructures = Number(edit.sentence_restructures || 0);
  const splitMerge = Number(edit.split_or_merge || 0);
  const paragraphReorders = Number(edit.paragraph_reorders || 0);
  const total = kept + micro + restructures + splitMerge + paragraphReorders;
  const substantive = restructures + splitMerge + paragraphReorders;
  const intervention = Math.max(0, total - kept);
  return { total, kept, micro, restructures, splitMerge, paragraphReorders, substantive, intervention };
}

function preservationAssessment(result) {
  const p = result?.preservation || {};
  const reasons = [];
  if (!p.numbers_ok) reasons.push("Numbers or numeric relationships were not fully preserved.");
  if (!p.citations_ok) reasons.push("One or more source citations were dropped, altered or newly introduced.");
  if (!p.technical_terms_ok) reasons.push("Protected technical terms or acronyms were not fully preserved.");
  if (!p.quotes_ok) reasons.push("Quoted material did not survive the revision as required.");
  if (p.study_stage_ok === false) reasons.push("The revision changed proposal/completed-study orientation.");
  if (p.new_factual_claims_detected) reasons.push("The preservation audit detected a new factual claim or factual drift.");
  return { passed: reasons.length === 0, reasons };
}

function executionStatus(underReasons, overReasons) {
  if (underReasons.length && overReasons.length) return "conflicting-execution";
  if (underReasons.length) return "under-executed";
  if (overReasons.length) return "over-executed";
  return "passed";
}

function candidateStatus(executionPassed, preservationPassed, status) {
  if (executionPassed && preservationPassed) return "accepted";
  if (executionPassed && !preservationPassed) return "preservation_failed";
  if (!executionPassed && preservationPassed) return status === "over-executed" ? "execution_over" : "execution_under";
  return "execution_and_preservation_failed";
}

export function assessExecutionCompliance(result) {
  const planned = plannedCounts(result);
  const reported = reportedCounts(result);
  const quality = result?.transformation_quality || {};
  const effectiveIntent = result?.intervention_intent?.effective || null;
  const authority = result?.intervention_authority || {};

  const interventionCoverage = ratio(reported.intervention, planned.intervention);
  const structuralCoverage = ratio(reported.substantive, planned.substantive);
  const planKeepRatio = ratio(planned.keep, planned.total, 0);
  const unchangedSentenceRatio = Number.isFinite(quality.unchanged_sentence_ratio)
    ? Number(quality.unchanged_sentence_ratio)
    : null;
  const changedSentenceRatio = unchangedSentenceRatio === null ? null : clamp01(1 - unchangedSentenceRatio);
  const reportedSubstantiveRatio = planned.total ? reported.substantive / planned.total : 0;

  const underReasons = [];
  const overReasons = [];
  const warnings = [];

  if (planned.intervention >= 8 && interventionCoverage < 0.67) {
    underReasons.push(`Only ${(interventionCoverage * 100).toFixed(0)}% of the planner's intervention load is represented in the model edit summary.`);
  } else if (planned.intervention >= 8 && interventionCoverage < 0.80) {
    warnings.push(`Planner-to-model intervention coverage is ${(interventionCoverage * 100).toFixed(0)}%; acceptable but below the preferred 80% execution band.`);
  }

  if (planned.substantive >= 6 && structuralCoverage < 0.60) {
    underReasons.push(`Only ${(structuralCoverage * 100).toFixed(0)}% of planned substantive restructuring is represented in the model edit summary.`);
  }

  if (effectiveIntent === "discourse_reconstruction" && planned.substantive >= 6 && structuralCoverage < 0.67) {
    underReasons.push("The effective intervention is discourse reconstruction, but the returned structural edit count does not reflect enough of that plan.");
  }

  const unchangedCeiling = Math.min(0.78, planKeepRatio + 0.25);
  if (planned.substantive >= 8 && unchangedSentenceRatio !== null && unchangedSentenceRatio > unchangedCeiling) {
    underReasons.push(`Independent source/revision comparison finds ${(unchangedSentenceRatio * 100).toFixed(0)}% of source sentences unchanged, above the ${(unchangedCeiling * 100).toFixed(0)}% ceiling implied by this plan's intervention requirement.`);
  }

  // NEW: the planner also places a ceiling on intervention breadth. A candidate
  // cannot receive PASS simply because it changed at least the required amount.
  const maxChangedSentenceRatio = Number.isFinite(Number(authority.max_changed_sentence_ratio))
    ? Number(authority.max_changed_sentence_ratio)
    : Math.min(0.95, 1 - planKeepRatio + 0.35);
  const maxSubstantiveRatio = Number.isFinite(Number(authority.max_substantive_operation_ratio))
    ? Number(authority.max_substantive_operation_ratio)
    : Math.min(0.92, ratio(planned.substantive, planned.total, 0) + 0.30);

  if (planned.total >= 8 && changedSentenceRatio !== null && changedSentenceRatio > maxChangedSentenceRatio + 0.03) {
    overReasons.push(`Independent source/revision comparison finds ${(changedSentenceRatio * 100).toFixed(0)}% of source sentences changed, above the ${Math.round(maxChangedSentenceRatio * 100)}% maximum breadth authorised by this plan.`);
  }

  if (planned.total >= 8 && reportedSubstantiveRatio > maxSubstantiveRatio + 0.12) {
    overReasons.push(`Model-reported substantive operations equal ${(reportedSubstantiveRatio * 100).toFixed(0)}% of planner units, above the ${Math.round(maxSubstantiveRatio * 100)}% structural breadth ceiling after the split/merge tolerance.`);
  }

  if (planned.total > 0 && reported.total > 0) {
    const countDrift = Math.abs(reported.total - planned.total) / planned.total;
    if (countDrift > 0.35) {
      warnings.push("Model edit-count totals differ substantially from the planner unit count; split/merge operations may explain part of the difference, so counts are supporting rather than sole evidence.");
    }
  }

  const preservation = preservationAssessment(result);
  const status = executionStatus(underReasons, overReasons);
  const executionPassed = status === "passed";

  const breadthScore = changedSentenceRatio === null || changedSentenceRatio <= maxChangedSentenceRatio
    ? 1
    : clamp01(1 - (changedSentenceRatio - maxChangedSentenceRatio) / Math.max(0.15, maxChangedSentenceRatio));
  const substantiveBreadthScore = reportedSubstantiveRatio <= maxSubstantiveRatio + 0.12
    ? 1
    : clamp01(1 - (reportedSubstantiveRatio - maxSubstantiveRatio) / Math.max(0.15, maxSubstantiveRatio));

  const executionScoreComponents = [
    interventionCoverage,
    structuralCoverage,
    unchangedSentenceRatio === null ? 1 : clamp01(1 - Math.max(0, unchangedSentenceRatio - planKeepRatio)),
    breadthScore,
    substantiveBreadthScore,
  ];
  const executionScore = Number((executionScoreComponents.reduce((a, b) => a + b, 0) / executionScoreComponents.length).toFixed(3));
  const overallScore = Number(((executionScore * 3 + (preservation.passed ? 1 : 0)) / 4).toFixed(3));

  return {
    version: "planner-execution-compliance-v3",
    passed: executionPassed,
    execution_passed: executionPassed,
    execution_status: status,
    under_executed: underReasons.length > 0,
    over_executed: overReasons.length > 0,
    preservation_ok: preservation.passed,
    candidate_status: candidateStatus(executionPassed, preservation.passed, status),
    score: executionScore,
    execution_score: executionScore,
    overall_score: overallScore,
    effective_intent: effectiveIntent,
    intervention_authority: authority,
    planned,
    reported,
    intervention_coverage: Number(interventionCoverage.toFixed(3)),
    structural_coverage: Number(structuralCoverage.toFixed(3)),
    planned_keep_ratio: Number(planKeepRatio.toFixed(3)),
    unchanged_sentence_ratio: unchangedSentenceRatio,
    changed_sentence_ratio: changedSentenceRatio === null ? null : Number(changedSentenceRatio.toFixed(3)),
    unchanged_sentence_ceiling: Number(unchangedCeiling.toFixed(3)),
    changed_sentence_ceiling: Number(maxChangedSentenceRatio.toFixed(3)),
    substantive_operation_ratio: Number(reportedSubstantiveRatio.toFixed(3)),
    substantive_operation_ceiling: Number(maxSubstantiveRatio.toFixed(3)),
    reasons: [...underReasons, ...overReasons],
    under_execution_reasons: underReasons,
    over_execution_reasons: overReasons,
    execution_reasons: [...underReasons, ...overReasons],
    preservation_reasons: preservation.reasons,
    warnings,
    note: "Execution compliance now enforces both the planner's minimum required work and its maximum authorised disturbance. Preservation is assessed separately. None of these verdicts establishes authorship.",
  };
}

export function preferByExecutionCompliance(firstResult, secondResult) {
  const first = assessExecutionCompliance(firstResult);
  const second = assessExecutionCompliance(secondResult);

  // Preservation is a hard preference. A deeper rewrite never wins by damaging
  // protected facts, citations, quotations, technical terms or study stage.
  if (second.preservation_ok && !first.preservation_ok) return { result: secondResult, compliance: second, selected: "second" };
  if (first.preservation_ok && !second.preservation_ok) return { result: firstResult, compliance: first, selected: "first" };

  if (second.execution_passed && !first.execution_passed) return { result: secondResult, compliance: second, selected: "second" };
  if (first.execution_passed && !second.execution_passed) return { result: firstResult, compliance: first, selected: "first" };

  if (second.overall_score > first.overall_score) return { result: secondResult, compliance: second, selected: "second" };
  return { result: firstResult, compliance: first, selected: "first" };
}
