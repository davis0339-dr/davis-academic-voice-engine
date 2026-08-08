// Derives the maximum amount of document disturbance authorised by a planner
// result and the source's preservation priority. Used by compliance after model
// generation so over-editing can fail just as under-editing can fail.

const SUBSTANTIVE_KEYS = new Set([
  "SENTENCE_RESTRUCTURE",
  "SPLIT_OR_MERGE",
  "PARAGRAPH_REORDER",
  "CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT",
  "COMPRESS",
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
  const substantive = Object.entries(planSummary || {}).reduce(
    (acc, [key, value]) => acc + (SUBSTANTIVE_KEYS.has(key) ? Number(value) || 0 : 0),
    0
  );
  const intervention = Math.max(0, total - keep);
  const interventionRatio = intervention / total;
  const substantiveRatio = substantive / total;
  const priority = authorialTexture?.preservation_priority || "medium";

  const changeMargin = priority === "high" ? 0.18 : priority === "medium" ? 0.28 : 0.40;
  const substantiveMargin = priority === "high" ? 0.12 : priority === "medium" ? 0.20 : 0.30;
  const breadth = priority === "high" ? "targeted" : priority === "medium" ? "selective" : "broad_if_diagnosed";

  return {
    version: "intervention-authority-v1",
    preservation_priority: priority,
    breadth,
    depth_permission: requestedIntensity === "deep" || requestedNaturalisation === "aggressive"
      ? "deep_where_diagnosed"
      : "as_planned",
    planned_keep_ratio: Number((keep / total).toFixed(3)),
    planned_intervention_ratio: Number(interventionRatio.toFixed(3)),
    planned_substantive_ratio: Number(substantiveRatio.toFixed(3)),
    max_changed_sentence_ratio: Number(clamp(interventionRatio + changeMargin, 0.12, 0.95).toFixed(3)),
    max_substantive_operation_ratio: Number(clamp(substantiveRatio + substantiveMargin, 0.10, 0.92).toFixed(3)),
    min_changed_sentence_ratio: Number(Math.max(0, interventionRatio - 0.18).toFixed(3)),
    effective_intent: effectiveIntent || null,
    rule: "The planner authorises both a minimum necessary intervention and a maximum disturbance ceiling. High authorial-texture preservation priority narrows breadth even when deep reconstruction is permitted inside selected passages.",
  };
}
