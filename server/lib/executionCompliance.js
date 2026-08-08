// Deterministic audit of whether a model response actually executed the planner's
// requested intervention depth. This is not an authorship detector and does not
// infer who wrote the text. Execution depth and factual preservation are separate
// verdicts: a deeply rewritten candidate can execute the plan and still be rejected
// because it damaged protected content.

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

function candidateStatus(executionPassed, preservationPassed) {
  if (executionPassed && preservationPassed) return "accepted";
  if (executionPassed && !preservationPassed) return "preservation_failed";
  if (!executionPassed && preservationPassed) return "execution_under";
  return "execution_and_preservation_failed";
}

export function assessExecutionCompliance(result) {
  const planned = plannedCounts(result);
  const reported = reportedCounts(result);
  const quality = result?.transformation_quality || {};
  const effectiveIntent = result?.intervention_intent?.effective || null;

  const interventionCoverage = ratio(reported.intervention, planned.intervention);
  const structuralCoverage = ratio(reported.substantive, planned.substantive);
  const planKeepRatio = ratio(planned.keep, planned.total, 0);
  const unchangedSentenceRatio = Number.isFinite(quality.unchanged_sentence_ratio)
    ? Number(quality.unchanged_sentence_ratio)
    : null;

  const executionReasons = [];
  const warnings = [];

  if (planned.intervention >= 8 && interventionCoverage < 0.67) {
    executionReasons.push(`Only ${(interventionCoverage * 100).toFixed(0)}% of the planner's intervention load is represented in the model edit summary.`);
  } else if (planned.intervention >= 8 && interventionCoverage < 0.80) {
    warnings.push(`Planner-to-model intervention coverage is ${(interventionCoverage * 100).toFixed(0)}%; acceptable but below the preferred 80% execution band.`);
  }

  if (planned.substantive >= 6 && structuralCoverage < 0.60) {
    executionReasons.push(`Only ${(structuralCoverage * 100).toFixed(0)}% of planned substantive restructuring is represented in the model edit summary.`);
  }

  if (effectiveIntent === "discourse_reconstruction" && planned.substantive >= 6 && structuralCoverage < 0.67) {
    executionReasons.push("The effective intervention is discourse reconstruction, but the returned structural edit count does not reflect enough of that plan.");
  }

  const unchangedCeiling = Math.min(0.78, planKeepRatio + 0.25);
  if (planned.substantive >= 8 && unchangedSentenceRatio !== null && unchangedSentenceRatio > unchangedCeiling) {
    executionReasons.push(`Independent source/revision comparison finds ${(unchangedSentenceRatio * 100).toFixed(0)}% of source sentences unchanged, above the ${(unchangedCeiling * 100).toFixed(0)}% ceiling implied by this plan's KEEP share.`);
  }

  if (planned.total > 0 && reported.total > 0) {
    const countDrift = Math.abs(reported.total - planned.total) / planned.total;
    if (countDrift > 0.35) {
      warnings.push("Model edit-count totals differ substantially from the planner unit count; split/merge operations may explain part of the difference, so the counts are treated as supporting rather than sole evidence.");
    }
  }

  const preservation = preservationAssessment(result);
  const executionPassed = executionReasons.length === 0;

  const executionScoreComponents = [
    interventionCoverage,
    structuralCoverage,
    unchangedSentenceRatio === null ? 1 : clamp01(1 - Math.max(0, unchangedSentenceRatio - planKeepRatio)),
  ];
  const executionScore = Number((executionScoreComponents.reduce((a, b) => a + b, 0) / executionScoreComponents.length).toFixed(3));
  const overallScore = Number(((executionScore * 3 + (preservation.passed ? 1 : 0)) / 4).toFixed(3));

  return {
    version: "planner-execution-compliance-v2",
    // `passed` is retained for backward compatibility, but now means execution
    // compliance only. Preservation has its own explicit verdict below.
    passed: executionPassed,
    execution_passed: executionPassed,
    preservation_ok: preservation.passed,
    candidate_status: candidateStatus(executionPassed, preservation.passed),
    score: executionScore,
    execution_score: executionScore,
    overall_score: overallScore,
    effective_intent: effectiveIntent,
    planned,
    reported,
    intervention_coverage: Number(interventionCoverage.toFixed(3)),
    structural_coverage: Number(structuralCoverage.toFixed(3)),
    planned_keep_ratio: Number(planKeepRatio.toFixed(3)),
    unchanged_sentence_ratio: unchangedSentenceRatio,
    unchanged_sentence_ceiling: Number(unchangedCeiling.toFixed(3)),
    reasons: executionReasons,
    execution_reasons: executionReasons,
    preservation_reasons: preservation.reasons,
    warnings,
    note: "Execution compliance measures whether the planner's requested work was carried out. Preservation is assessed separately. Neither verdict is an AI-authorship score.",
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
