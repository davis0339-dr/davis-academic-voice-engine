// Deterministic audit of whether a model response actually followed the planner's
// requested intervention. This is not an authorship detector. Concrete plan
// execution, paragraph-level discourse scope, visible-change plausibility,
// authorised disturbance and factual preservation are deliberately separated so
// textual distance is never treated as proof that an edit was executed well.

const SUBSTANTIVE_LEVELS = new Set([
  "SENTENCE_RESTRUCTURE",
  "SPLIT_OR_MERGE",
  "PARAGRAPH_REORDER",
  "CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT",
  "COMPRESS",
]);
const DISCOURSE_REPACKAGE_LEVEL = "DISCOURSE_REPACKAGE";

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
  const discourseRepackage = Number(summary[DISCOURSE_REPACKAGE_LEVEL] || 0);
  const paragraphReorders = Number(summary.PARAGRAPH_REORDER || 0);
  const substantive = [...SUBSTANTIVE_LEVELS].reduce((sum, key) => sum + Number(summary[key] || 0), 0);
  // DISCOURSE_REPACKAGE identifies material that belongs to a paragraph-level
  // reconstruction. It authorises structural handling but does not demand one
  // independently countable rewrite per source sentence.
  const intervention = Math.max(0, total - keep - discourseRepackage);
  const materialIntervention = Math.max(0, total - keep);
  return { total, keep, micro, substantive, discourseRepackage, paragraphReorders, intervention, materialIntervention };
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
  if (p.rhetorical_semantic_ok === false) reasons.push("The revision lost rhetorical functions or propositions, altered semantic force, or breached the selected length architecture.");
  if (p.new_factual_claims_detected) reasons.push("The preservation audit detected a new factual claim or factual drift.");
  return { passed: reasons.length === 0, reasons };
}

function executionStatus(underReasons, overReasons, varianceReasons = []) {
  if (underReasons.length && overReasons.length) return "conflicting-execution";
  if (underReasons.length) return "under-executed";
  if (overReasons.length) return "over-executed";
  if (varianceReasons.length) return "passed-with-variance";
  return "passed";
}

function candidateStatus(executionPassed, preservationPassed, status, hasVariance = false) {
  if (executionPassed && preservationPassed) return hasVariance ? "accepted_with_execution_variance" : "accepted";
  if (executionPassed && !preservationPassed) return "preservation_failed";
  if (!executionPassed && preservationPassed) return status === "over-executed" ? "execution_over" : "execution_under";
  return "execution_and_preservation_failed";
}

function assessSurgicalCompliance(result) {
  const surgical = result?.surgical_recovery;
  if (!surgical?.attempted) return null;

  const preservation = preservationAssessment(result);
  const proposedClear = Math.max(
    Number(surgical.considered_clear_edit_count || 0),
    Number(surgical.applied_edit_count || 0)
  );
  const applied = Number(surgical.applied_edit_count || 0);
  const acceptanceRatio = proposedClear ? clamp01(applied / proposedClear) : 1;
  const surgicalStatus = surgical.execution_status || (applied ? "surgical_plan_passed" : "no_safe_edit");
  const surgicalPlanPassed = surgicalStatus === "surgical_plan_passed" && preservation.passed;
  const partial = surgicalStatus === "surgical_partial";
  const reasons = [];

  const authority = result?.intervention_authority || {};
  const supersededPlan = plannedCounts(result);
  const supersededStructuralScope = supersededPlan.substantive + supersededPlan.discourseRepackage;
  const deepStructuralPlan = Boolean(
    (authority.author_choice_ceiling === "deep" || authority.depth_permission === "deep_where_diagnosed") &&
    (
      result?.intervention_intent?.effective === "discourse_reconstruction" ||
      supersededStructuralScope >= 6
    )
  );
  const deepPlanSuperseded = surgicalPlanPassed && deepStructuralPlan;
  const executionPassed = surgicalPlanPassed && !deepPlanSuperseded;
  const status = deepPlanSuperseded ? "under-executed" : surgicalStatus;

  if (deepPlanSuperseded) {
    reasons.push(
      `The bounded surgical fallback applied ${applied} local correction(s), but it did not execute the requested Deep structural plan (${supersededPlan.discourseRepackage} discourse-repackage and ${supersededPlan.substantive} concrete substantive unit(s) remained superseded). Safety recovery is not counted as successful fulfilment of Deep reconstruction.`
    );
  } else if (partial) {
    reasons.push(`Only ${applied} of ${proposedClear} clear defect-led edit candidates survived the surgical safeguards; an omission/rejection review is still warranted.`);
  } else if (surgicalStatus === "no_safe_edit") {
    reasons.push("No clear local correction survived the surgical safeguards.");
  }
  if (!preservation.passed) reasons.push(...preservation.reasons);

  const quality = result?.transformation_quality || {};
  const unchangedSentenceRatio = Number.isFinite(quality.unchanged_sentence_ratio)
    ? Number(quality.unchanged_sentence_ratio)
    : null;
  const changedSentenceRatio = unchangedSentenceRatio === null ? null : clamp01(1 - unchangedSentenceRatio);
  const changedCeiling = Number.isFinite(Number(authority.max_changed_sentence_ratio))
    ? Number(authority.max_changed_sentence_ratio)
    : Number(surgical.max_changed_sentence_ratio || 0.35);
  const underExecuted = partial || deepPlanSuperseded;
  const underExecutionCodes = [
    ...(partial ? ["SURGICAL_PARTIAL"] : []),
    ...(deepPlanSuperseded ? ["DEEP_PLAN_SUPERSEDED_BY_SURGICAL_FALLBACK"] : []),
  ];
  const underExecutionReasons = underExecuted
    ? reasons.filter((reason) => /Only \d+ of \d+|did not execute the requested Deep structural plan/.test(reason))
    : [];
  const structuralCoverage = deepPlanSuperseded && supersededStructuralScope > 0 ? 0 : 1;

  return {
    version: "surgical-defect-compliance-v2",
    passed: executionPassed,
    execution_passed: executionPassed,
    execution_status: status,
    surgical_execution_status: surgicalStatus,
    surgical_plan_passed: surgicalPlanPassed,
    plan_fidelity_status: executionPassed ? "passed" : underExecuted ? "under-executed" : surgicalStatus,
    plan_fidelity_passed: executionPassed,
    visible_change_plausibility_status: "not_applicable_surgical_plan",
    visible_change_plausibility_score: null,
    under_executed: underExecuted,
    over_executed: false,
    preservation_ok: preservation.passed,
    candidate_status: executionPassed ? "accepted" : preservation.passed ? "execution_under" : "execution_and_preservation_failed",
    score: Number(acceptanceRatio.toFixed(3)),
    execution_score: deepPlanSuperseded ? 0 : Number(acceptanceRatio.toFixed(3)),
    overall_score: deepPlanSuperseded
      ? Number(((preservation.passed ? 1 : 0) / 4).toFixed(3))
      : Number(((acceptanceRatio * 3 + (preservation.passed ? 1 : 0)) / 4).toFixed(3)),
    effective_intent: result?.intervention_intent?.effective || null,
    intervention_authority: authority,
    planner_superseded: true,
    superseded_plan: supersededPlan,
    deep_plan_superseded_by_surgical_fallback: deepPlanSuperseded,
    planned: {
      total: proposedClear,
      keep: 0,
      micro: proposedClear,
      substantive: 0,
      discourseRepackage: 0,
      intervention: proposedClear,
      materialIntervention: proposedClear,
    },
    reported: {
      total: applied,
      kept: 0,
      micro: applied,
      restructures: 0,
      splitMerge: 0,
      paragraphReorders: 0,
      substantive: 0,
      intervention: applied,
    },
    intervention_coverage: Number(acceptanceRatio.toFixed(3)),
    structural_coverage: structuralCoverage,
    planned_keep_ratio: 0,
    unchanged_sentence_ratio: unchangedSentenceRatio,
    changed_sentence_ratio: changedSentenceRatio === null ? null : Number(changedSentenceRatio.toFixed(3)),
    minimum_changed_sentence_ratio: null,
    unchanged_sentence_ceiling: null,
    changed_sentence_ceiling: Number(changedCeiling.toFixed(3)),
    substantive_operation_ratio: 0,
    substantive_operation_ceiling: 0,
    reasons,
    under_execution_codes: underExecutionCodes,
    over_execution_codes: [],
    execution_variance_codes: [],
    execution_variance_reasons: [],
    under_execution_reasons: underExecutionReasons,
    over_execution_reasons: [],
    execution_reasons: reasons,
    preservation_reasons: preservation.reasons,
    warnings: surgical.rejected_edits?.length
      ? [`${surgical.rejected_edits.length} proposed edit(s) were rejected by surgical safeguards. Rejection reasons are available in surgical_recovery.rejection_summary.`]
      : [],
    note: deepPlanSuperseded
      ? "The broad Deep structural plan was superseded by a bounded surgical safety fallback. The local fallback may be preservation-safe, but it is explicitly classified as under-execution of the requested Deep intervention rather than an accepted Deep revision."
      : "The original broad rewrite plan was superseded after over-editing a high-preservation source. Compliance is measured against the bounded defect-led surgical plan, while the rejected broad plan remains available as superseded_plan for auditability.",
  };
}

export function assessExecutionCompliance(result) {
  const surgicalCompliance = assessSurgicalCompliance(result);
  if (surgicalCompliance) return surgicalCompliance;

  const planned = plannedCounts(result);
  const reported = reportedCounts(result);
  const quality = result?.transformation_quality || {};
  const effectiveIntent = result?.intervention_intent?.effective || null;
  const authority = result?.intervention_authority || {};

  const interventionCoverage = ratio(reported.intervention, planned.intervention);
  const structuralCoverage = ratio(reported.substantive, planned.substantive);
  const planKeepRatio = ratio(planned.keep, planned.total, 0);
  const materialInterventionRatio = ratio(planned.materialIntervention, planned.total, 0);
  const unchangedSentenceRatio = Number.isFinite(quality.unchanged_sentence_ratio)
    ? Number(quality.unchanged_sentence_ratio)
    : null;
  const changedSentenceRatio = unchangedSentenceRatio === null ? null : clamp01(1 - unchangedSentenceRatio);
  const reportedSubstantiveRatio = planned.total ? reported.substantive / planned.total : 0;
  const diagnosticBreadth = authority.breadth_enforcement === "diagnostic";
  const preservation = preservationAssessment(result);

  const underReasons = [];
  const underCodes = [];
  const overReasons = [];
  const overCodes = [];
  const varianceReasons = [];
  const varianceCodes = [];
  const warnings = [];
  const addUnder = (code, reason) => {
    underCodes.push(code);
    underReasons.push(reason);
  };
  const addOver = (code, reason) => {
    overCodes.push(code);
    overReasons.push(reason);
  };
  const addVariance = (code, reason) => {
    varianceCodes.push(code);
    varianceReasons.push(reason);
    warnings.push(reason);
  };

  if (planned.intervention >= 8 && interventionCoverage < 0.67) {
    addUnder("PLAN_INTERVENTION_COVERAGE", `Only ${(interventionCoverage * 100).toFixed(0)}% of the planner's concrete sentence-operation load is represented in the model edit summary.`);
  } else if (planned.intervention >= 8 && interventionCoverage < 0.80) {
    warnings.push(`Planner-to-model concrete intervention coverage is ${(interventionCoverage * 100).toFixed(0)}%; acceptable but below the preferred 80% execution band.`);
  }

  if (planned.substantive >= 6 && structuralCoverage < 0.60) {
    addUnder("PLAN_STRUCTURAL_COVERAGE", `Only ${(structuralCoverage * 100).toFixed(0)}% of planned concrete substantive restructuring is represented in the model edit summary.`);
  }

  if (effectiveIntent === "discourse_reconstruction" && planned.substantive >= 6 && structuralCoverage < 0.67) {
    addUnder("DISCOURSE_CONCRETE_COVERAGE", "The effective intervention is discourse reconstruction, but the concrete sentence operations explicitly planned inside it were not represented sufficiently in the returned edit summary.");
  }

  if (planned.discourseRepackage > 0) {
    warnings.push(`${planned.discourseRepackage} planner unit(s) belong to paragraph-level DISCOURSE_REPACKAGE scope. Their success is evaluated through post-rewrite discourse diagnostics rather than a one-source-sentence/one-rewrite count.`);
  }

  const fallbackMinimumChanged = Math.max(0, materialInterventionRatio - 0.50);
  const minChangedSentenceRatio = Number.isFinite(Number(authority.min_changed_sentence_ratio))
    ? clamp01(Number(authority.min_changed_sentence_ratio))
    : fallbackMinimumChanged;
  const unchangedCeiling = clamp01(1 - minChangedSentenceRatio);

  if (
    planned.materialIntervention >= 8 &&
    minChangedSentenceRatio > 0 &&
    changedSentenceRatio !== null &&
    changedSentenceRatio + 0.03 < minChangedSentenceRatio
  ) {
    if (authority.minimum_basis === "broad_deep_discourse_execution_floor") {
      addUnder(
        "BROAD_DEEP_DISCOURSE_UNDER_TRANSFORMED",
        `Independent comparison finds ${(changedSentenceRatio * 100).toFixed(0)}% of source sentences visibly changed although Deep discourse reconstruction covered ${Math.round(Number(authority.planned_discourse_repackage_ratio || 0) * 100)}% of planner units. The ${Math.round(minChangedSentenceRatio * 100)}% floor is a plausibility safeguard for this unusually broad plan, not a rewrite quota; falling below it shows that the paragraph-level reconstruction was not materially realised.`
      );
    } else {
      addVariance(
        "VISIBLE_CHANGE_FLOOR",
        `Independent source/revision comparison finds ${(changedSentenceRatio * 100).toFixed(0)}% of source sentences visibly changed, below the ${Math.round(minChangedSentenceRatio * 100)}% preservation-aware plausibility floor. Concrete plan execution is evaluated separately; this is an execution variance for review, not a rewrite target and not a reason by itself to regenerate more text.`
      );
    }
  }

  const maxChangedSentenceRatio = Number.isFinite(Number(authority.max_changed_sentence_ratio))
    ? Number(authority.max_changed_sentence_ratio)
    : Math.min(0.95, 1 - planKeepRatio + 0.35);
  const maxSubstantiveRatio = Number.isFinite(Number(authority.max_substantive_operation_ratio))
    ? Number(authority.max_substantive_operation_ratio)
    : Math.min(0.92, ratio(planned.substantive + planned.discourseRepackage, planned.total, 0) + 0.30);

  if (planned.total >= 8 && changedSentenceRatio !== null && changedSentenceRatio > maxChangedSentenceRatio + 0.03) {
    const reason = diagnosticBreadth
      ? `Independent source/revision comparison finds ${(changedSentenceRatio * 100).toFixed(0)}% of source sentences changed, above the plan's ${Math.round(maxChangedSentenceRatio * 100)}% diagnostic reference. High change is not itself a defect; meaning, evidence, argument and structural authority are evaluated separately.`
      : `Independent source/revision comparison finds ${(changedSentenceRatio * 100).toFixed(0)}% of source sentences changed, above the ${Math.round(maxChangedSentenceRatio * 100)}% maximum breadth authorised by this plan.`;
    if (diagnosticBreadth) addVariance("HIGH_CHANGED_SENTENCE_BREADTH", reason);
    else addOver("MAX_CHANGED_SENTENCE_BREADTH", reason);
  }

  if (planned.total >= 8 && reportedSubstantiveRatio > maxSubstantiveRatio + 0.12) {
    const reason = diagnosticBreadth
      ? `Model-reported substantive operations equal ${(reportedSubstantiveRatio * 100).toFixed(0)}% of planner units, above the plan's ${Math.round(maxSubstantiveRatio * 100)}% diagnostic reference after split/merge tolerance.`
      : `Model-reported substantive operations equal ${(reportedSubstantiveRatio * 100).toFixed(0)}% of planner units, above the ${Math.round(maxSubstantiveRatio * 100)}% structural breadth ceiling after split/merge tolerance.`;
    if (diagnosticBreadth) addVariance("HIGH_SUBSTANTIVE_BREADTH", reason);
    else addOver("MAX_SUBSTANTIVE_BREADTH", reason);
  }

  if (
    reported.paragraphReorders > planned.paragraphReorders &&
    authority.paragraph_reordering_authorised !== true
  ) {
    addOver(
      "UNAUTHORISED_PARAGRAPH_REORDER",
      `The model reported ${reported.paragraphReorders} paragraph reorder(s), but this mode did not authorise paragraph resequencing.`
    );
  }

  // The model-authored edit summary is supporting evidence, not an independent
  // measurement. If deterministic comparison proves that the candidate changed
  // more text than authorised, a sparse self-report cannot simultaneously prove
  // that too little editing occurred. Preserve the discrepancy as an auditable
  // variance while classifying the actionable defect as over-execution.
  if (overCodes.includes("MAX_CHANGED_SENTENCE_BREADTH") && underCodes.length > 0) {
    const summaryCoverageCodes = new Set([
      "PLAN_INTERVENTION_COVERAGE",
      "PLAN_STRUCTURAL_COVERAGE",
      "DISCOURSE_CONCRETE_COVERAGE",
    ]);
    let movedSummaryCoverage = false;
    for (let index = underCodes.length - 1; index >= 0; index -= 1) {
      if (!summaryCoverageCodes.has(underCodes[index])) continue;
      underCodes.splice(index, 1);
      underReasons.splice(index, 1);
      movedSummaryCoverage = true;
    }
    if (movedSummaryCoverage) {
      addVariance(
        "MODEL_EDIT_SUMMARY_UNDERREPORTING",
        `The model reported ${reported.intervention} concrete edit(s), while independent source/revision comparison found ${(changedSentenceRatio * 100).toFixed(0)}% of source sentences changed. The self-reported edit counts are inconsistent and are not used to misclassify this over-edited candidate as under-executed.`
      );
    }
  }

  // In broad discourse reconstruction, deterministic source/revision distance
  // outranks the model's own edit-count narration. A candidate that materially
  // cleared the independently measured floor, passed the transformation gate,
  // and preserved the source cannot be rejected solely because the model
  // under-counted its edits. The discrepancy remains visible as variance.
  const independentlyMaterialExecution = effectiveIntent === "discourse_reconstruction"
    && changedSentenceRatio !== null
    && changedSentenceRatio >= Math.max(0.55, minChangedSentenceRatio)
    && quality.passed !== false
    && preservation.passed;
  if (independentlyMaterialExecution && underCodes.length > 0) {
    const summaryCoverageCodes = new Set([
      "PLAN_INTERVENTION_COVERAGE",
      "PLAN_STRUCTURAL_COVERAGE",
      "DISCOURSE_CONCRETE_COVERAGE",
    ]);
    let moved = false;
    for (let index = underCodes.length - 1; index >= 0; index -= 1) {
      if (!summaryCoverageCodes.has(underCodes[index])) continue;
      underCodes.splice(index, 1);
      underReasons.splice(index, 1);
      moved = true;
    }
    if (moved && !varianceCodes.includes("MODEL_EDIT_SUMMARY_UNDERREPORTING")) {
      addVariance(
        "MODEL_EDIT_SUMMARY_UNDERREPORTING",
        `The model's edit summary under-reports execution: independent comparison found ${(changedSentenceRatio * 100).toFixed(0)}% of source sentences changed, the transformation-quality gate passed, and factual preservation passed. Self-reported operation counts remain supporting evidence only.`
      );
    }
  }

  if (planned.total > 0 && reported.total > 0) {
    const countDrift = Math.abs(reported.total - planned.total) / planned.total;
    if (countDrift > 0.35) {
      warnings.push("Model edit-count totals differ substantially from the planner unit count; split/merge and paragraph-level repackaging can explain part of the difference, so counts are supporting rather than sole evidence.");
    }
  }

  const status = executionStatus(underReasons, overReasons, varianceReasons);
  const executionPassed = status === "passed" || status === "passed-with-variance";
  const hasVariance = varianceReasons.length > 0;

  const visiblePlausibilityScore = changedSentenceRatio === null || minChangedSentenceRatio <= 0 || changedSentenceRatio >= minChangedSentenceRatio
    ? 1
    : clamp01(changedSentenceRatio / Math.max(0.05, minChangedSentenceRatio));
  const breadthScore = diagnosticBreadth || changedSentenceRatio === null || changedSentenceRatio <= maxChangedSentenceRatio
    ? 1
    : clamp01(1 - (changedSentenceRatio - maxChangedSentenceRatio) / Math.max(0.15, maxChangedSentenceRatio));
  const substantiveBreadthScore = diagnosticBreadth || reportedSubstantiveRatio <= maxSubstantiveRatio + 0.12
    ? 1
    : clamp01(1 - (reportedSubstantiveRatio - maxSubstantiveRatio) / Math.max(0.15, maxSubstantiveRatio));

  // Execution score measures plan fidelity and authorised breadth. The independent
  // visible-change plausibility score is intentionally reported separately so a
  // low textual-distance percentage cannot lower plan fidelity or trigger a rewrite.
  const executionScoreComponents = [
    interventionCoverage,
    structuralCoverage,
    breadthScore,
    substantiveBreadthScore,
  ];
  const executionScore = Number((executionScoreComponents.reduce((a, b) => a + b, 0) / executionScoreComponents.length).toFixed(3));
  const overallScore = Number(((executionScore * 3 + (preservation.passed ? 1 : 0)) / 4).toFixed(3));

  return {
    version: "planner-execution-compliance-v8",
    passed: executionPassed,
    execution_passed: executionPassed,
    execution_status: status,
    plan_fidelity_status: underReasons.length ? "under-executed" : overReasons.length ? "over-executed" : "passed",
    plan_fidelity_passed: underReasons.length === 0 && overReasons.length === 0,
    visible_change_plausibility_status: varianceCodes.includes("VISIBLE_CHANGE_FLOOR")
      ? "below-plausibility-floor"
      : varianceCodes.some((code) => code.startsWith("HIGH_"))
        ? "high-change-diagnostic"
        : "within-authorised-band",
    visible_change_plausibility_score: Number(visiblePlausibilityScore.toFixed(3)),
    under_executed: underReasons.length > 0,
    over_executed: overReasons.length > 0,
    preservation_ok: preservation.passed,
    candidate_status: candidateStatus(executionPassed, preservation.passed, status, hasVariance),
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
    minimum_changed_sentence_ratio: Number(minChangedSentenceRatio.toFixed(3)),
    unchanged_sentence_ceiling: Number(unchangedCeiling.toFixed(3)),
    changed_sentence_ceiling: Number(maxChangedSentenceRatio.toFixed(3)),
    substantive_operation_ratio: Number(reportedSubstantiveRatio.toFixed(3)),
    substantive_operation_ceiling: Number(maxSubstantiveRatio.toFixed(3)),
    independent_execution_evidence: {
      deterministic_changed_sentence_ratio: changedSentenceRatio === null ? null : Number(changedSentenceRatio.toFixed(3)),
      transformation_quality_passed: quality.passed !== false,
      preservation_passed: preservation.passed,
      materially_executed: independentlyMaterialExecution,
      model_edit_summary_role: "supporting_not_controlling",
    },
    reasons: [...underReasons, ...overReasons],
    under_execution_codes: underCodes,
    over_execution_codes: overCodes,
    execution_variance_codes: varianceCodes,
    execution_variance_reasons: varianceReasons,
    under_execution_reasons: underReasons,
    over_execution_reasons: overReasons,
    execution_reasons: [...underReasons, ...overReasons],
    preservation_reasons: preservation.reasons,
    warnings,
    note: "Plan fidelity, visible-change plausibility, maximum authorised disturbance and factual preservation are separate dimensions. A below-floor visible-change result is reported as reviewable execution variance rather than under-execution when the concrete plan itself was carried out. No percentage is a rewrite target and none establishes authorship.",
  };
}

export function preferByExecutionCompliance(firstResult, secondResult) {
  const first = assessExecutionCompliance(firstResult);
  const second = assessExecutionCompliance(secondResult);

  if (second.preservation_ok && !first.preservation_ok) return { result: secondResult, compliance: second, selected: "second" };
  if (first.preservation_ok && !second.preservation_ok) return { result: firstResult, compliance: first, selected: "first" };

  if (second.execution_passed && !first.execution_passed) return { result: secondResult, compliance: second, selected: "second" };
  if (first.execution_passed && !second.execution_passed) return { result: firstResult, compliance: first, selected: "first" };

  if (second.overall_score > first.overall_score) return { result: secondResult, compliance: second, selected: "second" };
  return { result: firstResult, compliance: first, selected: "first" };
}

