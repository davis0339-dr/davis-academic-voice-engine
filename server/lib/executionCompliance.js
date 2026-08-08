// Deterministic audit of whether a model response actually executed the planner's
// requested intervention depth. This is not an authorship detector and does not
// infer who wrote the text. It reconciles planner demand, model-reported edit
// counts and transformation evidence before the application presents a rewrite
// as successfully executed.

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

function preservationPassed(result) {
  const p = result?.preservation || {};
  const required = [
    p.numbers_ok,
    p.citations_ok,
    p.technical_terms_ok,
    p.quotes_ok,
    p.study_stage_ok !== false,
    !p.new_factual_claims_detected,
  ];
  return required.every(Boolean);
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

  const reasons = [];
  const warnings = [];

  // A small plan should not trigger a costly reconciliation retry. Once the
  // planner requests substantial work, however, a model cannot report carrying
  // out barely half the requested intervention and still be treated as fully
  // compliant.
  if (planned.intervention >= 8 && interventionCoverage < 0.67) {
    reasons.push(`Only ${(interventionCoverage * 100).toFixed(0)}% of the planner's intervention load is represented in the model edit summary.`);
  } else if (planned.intervention >= 8 && interventionCoverage < 0.80) {
    warnings.push(`Planner-to-model intervention coverage is ${(interventionCoverage * 100).toFixed(0)}%; acceptable but below the preferred 80% execution band.`);
  }

  if (planned.substantive >= 6 && structuralCoverage < 0.60) {
    reasons.push(`Only ${(structuralCoverage * 100).toFixed(0)}% of planned substantive restructuring is represented in the model edit summary.`);
  }

  if (effectiveIntent === "discourse_reconstruction" && planned.substantive >= 6 && structuralCoverage < 0.67) {
    reasons.push("The effective intervention is discourse reconstruction, but the returned structural edit count does not reflect enough of that plan.");
  }

  // Model-reported counts are useful but not sufficient. The unchanged-sentence
  // ratio is calculated independently from source and revision, so it supplies a
  // second piece of evidence about whether a structurally demanding plan was
  // actually executed.
  const unchangedCeiling = Math.min(0.78, planKeepRatio + 0.25);
  if (planned.substantive >= 8 && unchangedSentenceRatio !== null && unchangedSentenceRatio > unchangedCeiling) {
    reasons.push(`Independent source/revision comparison finds ${(unchangedSentenceRatio * 100).toFixed(0)}% of source sentences unchanged, above the ${(unchangedCeiling * 100).toFixed(0)}% ceiling implied by this plan's KEEP share.`);
  }

  if (planned.total > 0 && reported.total > 0) {
    const countDrift = Math.abs(reported.total - planned.total) / planned.total;
    if (countDrift > 0.35) {
      warnings.push("Model edit-count totals differ substantially from the planner unit count; split/merge operations may explain part of the difference, so the counts are treated as supporting rather than sole evidence.");
    }
  }

  const preservationOk = preservationPassed(result);
  if (!preservationOk) {
    reasons.push("The candidate does not pass factual/preservation safeguards, so it cannot be preferred solely for higher rewrite depth.");
  }

  const scoreComponents = [
    interventionCoverage,
    structuralCoverage,
    unchangedSentenceRatio === null ? 1 : clamp01(1 - Math.max(0, unchangedSentenceRatio - planKeepRatio)),
    preservationOk ? 1 : 0,
  ];
  const score = Number((scoreComponents.reduce((a, b) => a + b, 0) / scoreComponents.length).toFixed(3));

  return {
    version: "planner-execution-compliance-v1",
    passed: reasons.length === 0,
    score,
    effective_intent: effectiveIntent,
    planned,
    reported,
    intervention_coverage: Number(interventionCoverage.toFixed(3)),
    structural_coverage: Number(structuralCoverage.toFixed(3)),
    planned_keep_ratio: Number(planKeepRatio.toFixed(3)),
    unchanged_sentence_ratio: unchangedSentenceRatio,
    unchanged_sentence_ceiling: Number(unchangedCeiling.toFixed(3)),
    preservation_ok: preservationOk,
    reasons,
    warnings,
    note: "Execution compliance reconciles planner demand, model-reported operations and independently measured source/revision overlap. It is a rewrite-process quality check, not an AI-authorship score.",
  };
}

export function preferByExecutionCompliance(firstResult, secondResult) {
  const first = assessExecutionCompliance(firstResult);
  const second = assessExecutionCompliance(secondResult);

  if (second.preservation_ok && !first.preservation_ok) return { result: secondResult, compliance: second, selected: "second" };
  if (first.preservation_ok && !second.preservation_ok) return { result: firstResult, compliance: first, selected: "first" };
  if (second.passed && !first.passed) return { result: secondResult, compliance: second, selected: "second" };
  if (first.passed && !second.passed) return { result: firstResult, compliance: first, selected: "first" };
  if (second.score > first.score) return { result: secondResult, compliance: second, selected: "second" };
  return { result: firstResult, compliance: first, selected: "first" };
}
