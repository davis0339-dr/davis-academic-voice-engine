// Derive the amount of document disturbance authorised by the planner and the
// author's explicit rewrite choice. Diagnostic recommendation and execution
// authority are separate. Strong existing surface texture does not automatically
// block evidence-led development of under-explained reasoning.

const SUBSTANTIVE_KEYS = new Set([
  "SENTENCE_RESTRUCTURE",
  "SPLIT_OR_MERGE",
  "PARAGRAPH_REORDER",
  "CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT",
  "COMPRESS",
  "DISCOURSE_REPACKAGE",
]);

function sum(obj) {
  return Object.values(obj || {}).reduce((total, value) => total + (Number(value) || 0), 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function deriveInterventionAuthority({ planSummary, authorialTexture, requestedIntensity, requestedNaturalisation, effectiveIntent } = {}) {
  const total = Math.max(1, sum(planSummary));
  const keep = Number(planSummary?.KEEP || 0);
  const discourseRepackage = Number(planSummary?.DISCOURSE_REPACKAGE || 0);
  const substantive = Object.entries(planSummary || {}).reduce(
    (acc, [key, value]) => acc + (SUBSTANTIVE_KEYS.has(key) ? Number(value) || 0 : 0),
    0
  );
  const intervention = Math.max(0, total - keep);
  const interventionRatio = intervention / total;
  const substantiveRatio = substantive / total;
  const discourseRatio = discourseRepackage / total;
  const priority = authorialTexture?.preservation_priority || "medium";
  const intensity = ["auto", "minor", "moderate", "deep"].includes(requestedIntensity) ? requestedIntensity : "auto";
  const explicitMinor = intensity === "minor";
  const explicitModerate = intensity === "moderate";
  const selectiveDevelopment = effectiveIntent === "context_scholarly_strengthening";
  const authorialMode = requestedNaturalisation === "authorial" && intensity === "deep";
  const authorialDiscourseMode = authorialMode && effectiveIntent === "discourse_reconstruction";
  const deepDiscourseMode = intensity === "deep" && effectiveIntent === "discourse_reconstruction";

  if (explicitMinor) {
    return {
      version: "intervention-authority-v7",
      preservation_priority: priority,
      preservation_basis: "surface_and_semantic_fidelity",
      surface_preservation_required: true,
      discourse_development_permission: "none",
      breadth: "author_selected_local",
      authorial_mode: false,
      authorial_discourse_mode: false,
      author_choice_ceiling: "minor",
      author_choice_respected: true,
      depth_permission: "micro_edit_only",
      planned_keep_ratio: Number((keep / total).toFixed(3)),
      planned_intervention_ratio: Number(interventionRatio.toFixed(3)),
      planned_substantive_ratio: Number(substantiveRatio.toFixed(3)),
      planned_discourse_repackage_ratio: Number(discourseRatio.toFixed(3)),
      max_changed_sentence_ratio: Number(clamp(Math.max(0.08, interventionRatio + 0.10), 0.08, 0.35).toFixed(3)),
      max_substantive_operation_ratio: 0.08,
      min_changed_sentence_ratio: 0,
      minimum_basis: "no_change_quota_for_minor_edit",
      effective_intent: effectiveIntent || null,
      rule: "Minor is an explicit authorial ceiling. Deeper diagnostic recommendations remain visible, but this run may only make bounded local wording, grammar and clarity edits. No minimum amount of change is required, and paragraph/discourse development is not authorised.",
    };
  }

  if (explicitModerate) {
    const developmentCeiling = selectiveDevelopment
      ? Number(clamp(Math.max(interventionRatio + 0.28, substantiveRatio + 0.20), 0.25, 0.75).toFixed(3))
      : Number(clamp(interventionRatio + 0.20, 0.15, 0.60).toFixed(3));
    const substantiveCeiling = selectiveDevelopment
      ? Number(clamp(substantiveRatio + 0.24, 0.18, 0.68).toFixed(3))
      : Number(clamp(substantiveRatio + 0.15, 0.12, 0.55).toFixed(3));

    return {
      version: "intervention-authority-v7",
      preservation_priority: priority,
      preservation_basis: "surface_and_semantic_fidelity",
      surface_preservation_required: true,
      discourse_development_permission: selectiveDevelopment ? "selective_paragraph_development_without_resequence" : "sentence_flow_only",
      breadth: selectiveDevelopment ? "author_selected_moderate_developmental" : "author_selected_moderate",
      authorial_mode: false,
      authorial_discourse_mode: false,
      author_choice_ceiling: "moderate",
      author_choice_respected: true,
      depth_permission: selectiveDevelopment ? "selective_development_where_diagnosed" : "sentence_level_where_diagnosed",
      planned_keep_ratio: Number((keep / total).toFixed(3)),
      planned_intervention_ratio: Number(interventionRatio.toFixed(3)),
      planned_substantive_ratio: Number(substantiveRatio.toFixed(3)),
      planned_discourse_repackage_ratio: Number(discourseRatio.toFixed(3)),
      max_changed_sentence_ratio: developmentCeiling,
      max_substantive_operation_ratio: substantiveCeiling,
      min_changed_sentence_ratio: 0,
      minimum_basis: "no_change_quota_for_moderate_edit",
      effective_intent: effectiveIntent || null,
      rule: selectiveDevelopment
        ? "Moderate remains an authorial ceiling: wholesale discourse reconstruction, paragraph resequencing and unsupported expansion are not authorised. However, diagnosed paragraphs may be selectively developed from existing reasoning/evidence so that strong surface texture does not preserve argumentative compression. Added words must complete an identified rhetorical function; word-count growth is never a target."
        : "Moderate is an explicit authorial ceiling. Sentence restructuring, split/merge and flow repair are permitted where diagnosed, but deeper paragraph/discourse recommendations are advisory for this run. There is no minimum rewrite quota.",
    };
  }

  const changeMargin = authorialMode
    ? (priority === "high" ? 0.34 : priority === "medium" ? 0.40 : 0.46)
    : (priority === "high" ? 0.18 : priority === "medium" ? 0.28 : 0.40);
  const substantiveMargin = authorialMode
    ? (priority === "high" ? 0.30 : priority === "medium" ? 0.34 : 0.40)
    : (priority === "high" ? 0.12 : priority === "medium" ? 0.20 : 0.30);
  const minimumSlack = authorialMode
    ? (priority === "high" ? 0.58 : priority === "medium" ? 0.46 : 0.34)
    : (priority === "high" ? 0.65 : priority === "medium" ? 0.50 : 0.35);
  const breadth = authorialMode
    ? "semantic_fidelity_broad_reconstruction"
    : deepDiscourseMode ? "diagnosed_deep_reconstruction"
      : selectiveDevelopment ? "selective_argument_development"
        : priority === "high" ? "targeted" : priority === "medium" ? "selective" : "broad_if_diagnosed";

  const ordinaryMinimumChanged = Math.max(0, interventionRatio - minimumSlack);
  const authorialPlanDemand = clamp(substantiveRatio, 0, 1);
  const authorialMinimumChanged = authorialDiscourseMode
    ? clamp(Math.max(0.15, authorialPlanDemand * 0.35), 0, 0.55)
    : ordinaryMinimumChanged;

  const ordinaryChangedUpper = deepDiscourseMode && interventionRatio >= 0.85 ? 1 : 0.95;
  const ordinarySubstantiveUpper = deepDiscourseMode && substantiveRatio >= 0.85 ? 1 : 0.92;
  const ordinaryMaxChanged = clamp(interventionRatio + changeMargin + (selectiveDevelopment ? 0.08 : 0), 0.12, ordinaryChangedUpper);
  const ordinaryMaxSubstantive = clamp(substantiveRatio + substantiveMargin + (selectiveDevelopment ? 0.08 : 0), 0.10, ordinarySubstantiveUpper);
  const authorialMaxChanged = clamp(interventionRatio + changeMargin, 0.20, 1);
  const authorialStructuralEnvelope = clamp(substantiveRatio + discourseRatio + 0.15, 0.35, 1);
  const authorialMaxSubstantive = authorialDiscourseMode
    ? Math.max(ordinaryMaxSubstantive, authorialStructuralEnvelope)
    : clamp(substantiveRatio + substantiveMargin, 0.15, 1);

  return {
    version: "intervention-authority-v7",
    preservation_priority: priority,
    preservation_basis: authorialMode ? "semantic_evidential_fidelity" : "surface_and_semantic_fidelity",
    surface_preservation_required: !authorialMode,
    discourse_development_permission: deepDiscourseMode || authorialMode
      ? "deep_where_diagnosed"
      : selectiveDevelopment ? "selective_argument_development" : "as_planned",
    breadth,
    authorial_mode: authorialMode,
    authorial_discourse_mode: authorialDiscourseMode,
    author_choice_ceiling: intensity,
    author_choice_respected: true,
    depth_permission: intensity === "deep" || authorialMode
      ? "deep_where_diagnosed"
      : selectiveDevelopment ? "selective_development_where_diagnosed" : "as_planned",
    planned_keep_ratio: Number((keep / total).toFixed(3)),
    planned_intervention_ratio: Number(interventionRatio.toFixed(3)),
    planned_substantive_ratio: Number(substantiveRatio.toFixed(3)),
    planned_discourse_repackage_ratio: Number(discourseRatio.toFixed(3)),
    max_changed_sentence_ratio: Number((authorialMode ? authorialMaxChanged : ordinaryMaxChanged).toFixed(3)),
    max_substantive_operation_ratio: Number((authorialMode ? authorialMaxSubstantive : ordinaryMaxSubstantive).toFixed(3)),
    min_changed_sentence_ratio: Number((authorialMode ? authorialMinimumChanged : ordinaryMinimumChanged).toFixed(3)),
    minimum_basis: authorialDiscourseMode
      ? "plan_responsive_authorial_execution_floor"
      : authorialMode
        ? "authorial_preservation_aware_plausibility_floor"
        : "preservation_aware_plausibility_floor",
    effective_intent: effectiveIntent || null,
    rule: authorialMode
      ? "Deep Authorial Reconstruction preserves argument, evidence, citations, numbers, methods, variables, qualifications, epistemic strength, factual relationships and technical meaning; it does not require preservation of source sentence wording or sentence boundaries. Maximum breadth is an authority ceiling and the minimum is only an execution safeguard, never a rewrite target."
      : deepDiscourseMode
        ? "Deep discourse reconstruction may redevelop every diagnosed sentence when the planner places the whole passage in intervention scope. The breadth ceiling follows that diagnosed scope rather than imposing an arbitrary 95% cap; factual and semantic preservation remain separate hard requirements."
        : selectiveDevelopment
          ? "Selective argumentative development may add explanatory space only where the planner identifies compressed evidence, conditions, measures or context. Strong surface texture remains protected, and expansion is justified by rhetorical work rather than desired word count."
          : "Maximum changed-sentence breadth is an authorised disturbance ceiling, never a rewrite target. Minimum changed-sentence breadth is only a plausibility safeguard for demanding plans. Diagnosis determines where intervention is warranted; clean text may remain unchanged.",
  };
}
