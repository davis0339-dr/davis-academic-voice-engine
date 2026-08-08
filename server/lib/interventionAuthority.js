// Derives the amount of document disturbance authorised by a planner result and
// the source's preservation priority. Maximum breadth is a hard ceiling; minimum
// breadth is only a plausibility floor. Deep Authorial Reconstruction protects
// semantic/evidential fidelity rather than freezing source sentence wording.

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
  const authorialMode = requestedNaturalisation === "authorial";
  const authorialDiscourseMode = authorialMode && effectiveIntent === "discourse_reconstruction";

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
    : priority === "high" ? "targeted" : priority === "medium" ? "selective" : "broad_if_diagnosed";

  // In ordinary modes, strong existing texture can legitimately make the visible
  // change floor very small. Deep Authorial Reconstruction is different: when the
  // planner itself selected discourse reconstruction, a nearly unchanged output is
  // an execution failure because the user explicitly authorised rebuilding the
  // reasoning presentation. The floor remains deliberately moderate; it is not a
  // quota and it never overrides factual/citation/methodological fidelity.
  const ordinaryMinimumChanged = Math.max(0, interventionRatio - minimumSlack);
  const authorialPlanDemand = clamp(substantiveRatio, 0, 1);
  const authorialMinimumChanged = authorialDiscourseMode
    ? clamp(Math.max(0.15, authorialPlanDemand * 0.35), 0, 0.55)
    : ordinaryMinimumChanged;

  // DISCOURSE_REPACKAGE is paragraph-level scope. During a genuine reconstruction
  // it can legitimately materialise as many sentence restructures/splits/merges,
  // so the sentence-operation ceiling must not incorrectly treat those concrete
  // operations as over-editing. In authorial discourse mode, surface change may
  // reach the whole passage if semantic/evidential preservation passes.
  const ordinaryMaxChanged = clamp(interventionRatio + changeMargin, 0.12, 0.95);
  const ordinaryMaxSubstantive = clamp(substantiveRatio + substantiveMargin, 0.10, 0.92);
  const authorialMaxChanged = authorialDiscourseMode ? 1 : clamp(interventionRatio + changeMargin, 0.20, 1);
  const authorialStructuralEnvelope = clamp(substantiveRatio + discourseRatio + 0.15, 0.35, 1);
  const authorialMaxSubstantive = authorialDiscourseMode
    ? Math.max(ordinaryMaxSubstantive, authorialStructuralEnvelope)
    : clamp(substantiveRatio + substantiveMargin, 0.15, 1);

  return {
    version: "intervention-authority-v4",
    preservation_priority: priority,
    preservation_basis: authorialMode ? "semantic_evidential_fidelity" : "surface_and_semantic_fidelity",
    surface_preservation_required: !authorialMode,
    breadth,
    authorial_mode: authorialMode,
    authorial_discourse_mode: authorialDiscourseMode,
    depth_permission: requestedIntensity === "deep" || requestedNaturalisation === "aggressive" || authorialMode
      ? "deep_where_diagnosed"
      : "as_planned",
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
      ? "Deep Authorial Reconstruction preserves the writer's argument, evidence, citations, numbers, methods, variables, qualifications, epistemic strength and technical meaning; it does not require preservation of source sentence wording or sentence boundaries. When discourse reconstruction is planned, substantial or even passage-wide surface redevelopment is permissible if those fidelity constraints pass. The maximum remains an authority ceiling and the minimum remains only an execution safeguard against a nominal 'deep reconstruction' that returns essentially the same prose. DISCOURSE_REPACKAGE is paragraph-level scope and may legitimately produce multiple concrete sentence restructures."
      : "Maximum changed-sentence breadth is an authorised disturbance ceiling, never a rewrite target. Minimum changed-sentence breadth is only a preservation-aware plausibility floor used to detect implausibly unchanged output when a demanding plan was reported as executed. DISCOURSE_REPACKAGE contributes to structural authority but is not a one-sentence-one-rewrite quota. High authorial-texture preservation priority lowers the minimum floor because clean source sentences may legitimately survive even when deep repair is permitted inside diagnosed passages.",
  };
}
