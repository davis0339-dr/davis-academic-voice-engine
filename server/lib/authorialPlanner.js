// Preservation-aware wrapper around the established hierarchical planner.
// It keeps earlier diagnostics/planning behavior, but separates intervention
// DEPTH from intervention BREADTH and lets strong existing authorial texture
// constrain how much of the document may be disturbed.

import {
  buildInterventionPlan as buildBasePlan,
  LEVELS,
  PARAGRAPH_ACTIONS,
  KEEP_CLASSES,
} from "./planner.js";

const SUBSTANTIVE_LEVELS = new Set([
  LEVELS.SENTENCE_RESTRUCTURE,
  LEVELS.SPLIT_OR_MERGE,
  LEVELS.PARAGRAPH_REORDER,
  LEVELS.CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT,
  LEVELS.COMPRESS,
]);

function sumValues(obj) {
  return Object.values(obj || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isUnflaggedPermissionOnly(item) {
  const text = (item.reasons || []).join(" ").toLowerCase();
  return (
    text.includes("unflagged locally") ||
    text.includes("unflagged; light pass only") ||
    text.includes("deep mode still permits cadence/flow refinement") ||
    text.includes("deep intensity + expand preference on an otherwise clean sentence")
  );
}

function structureBlockForItem(diagnostics, item) {
  if (!Number.isInteger(item.paragraphBlockIndex)) return null;
  return diagnostics?.text_structure?.blocks?.find((block) => block.blockIndex === item.paragraphBlockIndex) || null;
}

function applyPreservationPriority(plan, diagnostics, authorialTexture) {
  const priority = authorialTexture?.preservation_priority || "medium";
  if (priority !== "high") return plan.items;

  return plan.items.map((item) => {
    const block = structureBlockForItem(diagnostics, item);

    if (block?.type === "page_artifact") {
      return {
        ...item,
        level: LEVELS.KEEP,
        decisionCode: "KEEP_PAGE_ARTIFACT",
        preservationClass: KEEP_CLASSES.KEEP_TECHNICAL,
        reasons: ["Isolated page number/pagination artifact is not prose and must remain untouched or be excluded from prose revision."],
      };
    }

    // In high-preservation sources, Deep is permission to intervene deeply where
    // a defect exists. It is not permission to micro-edit every clean sentence.
    if (
      [LEVELS.MICRO_EDIT, LEVELS.CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT].includes(item.level) &&
      isUnflaggedPermissionOnly(item)
    ) {
      return {
        ...item,
        level: LEVELS.KEEP,
        decisionCode: item.preservationClass || KEEP_CLASSES.KEEP_NATURAL,
        reasons: [
          "Strong existing authorial texture + no diagnosed local defect: preserve this sentence. Deep mode affects intervention depth where needed, not breadth across clean prose.",
        ],
      };
    }

    return item;
  });
}

function applyPageArtifactProtection(plan, diagnostics, items) {
  return items.map((item) => {
    const block = structureBlockForItem(diagnostics, item);
    if (block?.type !== "page_artifact") return item;
    return {
      ...item,
      level: LEVELS.KEEP,
      decisionCode: "KEEP_PAGE_ARTIFACT",
      preservationClass: KEEP_CLASSES.KEEP_TECHNICAL,
      reasons: ["Pagination artifact is excluded from prose editing."],
    };
  });
}

function summariseItems(items) {
  return items.reduce((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, {});
}

function buildAuthority({ items, authorialTexture, requestedIntensity, requestedNaturalisation, effectiveIntent }) {
  const total = items.length || 1;
  const keep = items.filter((item) => item.level === LEVELS.KEEP).length;
  const substantive = items.filter((item) => SUBSTANTIVE_LEVELS.has(item.level)).length;
  const intervention = total - keep;
  const interventionRatio = intervention / total;
  const substantiveRatio = substantive / total;
  const priority = authorialTexture?.preservation_priority || "medium";

  const breadth = priority === "high" ? "targeted" : priority === "medium" ? "selective" : "broad_if_diagnosed";
  const depthPermission = requestedNaturalisation === "aggressive" || requestedIntensity === "deep"
    ? "deep_where_diagnosed"
    : requestedIntensity === "minor"
      ? "light"
      : "moderate";

  const changeMargin = priority === "high" ? 0.18 : priority === "medium" ? 0.28 : 0.40;
  const substantiveMargin = priority === "high" ? 0.12 : priority === "medium" ? 0.20 : 0.30;
  const maxChangedSentenceRatio = clamp(interventionRatio + changeMargin, 0.12, 0.95);
  const maxSubstantiveRatio = clamp(substantiveRatio + substantiveMargin, 0.10, 0.92);

  return {
    version: "intervention-authority-v1",
    depth_permission: depthPermission,
    breadth,
    preservation_priority: priority,
    planned_keep_ratio: Number((keep / total).toFixed(3)),
    planned_intervention_ratio: Number(interventionRatio.toFixed(3)),
    planned_substantive_ratio: Number(substantiveRatio.toFixed(3)),
    max_changed_sentence_ratio: Number(maxChangedSentenceRatio.toFixed(3)),
    max_substantive_operation_ratio: Number(maxSubstantiveRatio.toFixed(3)),
    min_changed_sentence_ratio: Number(Math.max(0, interventionRatio - 0.18).toFixed(3)),
    effective_intent: effectiveIntent,
    rule: "Depth and breadth are independent. Strong existing authorial texture narrows breadth even when Deep/Aggressive grants permission for substantial reconstruction inside genuinely defective passages.",
  };
}

function adjustIntent(baseIntent, authorialTexture, requestedNaturalisation) {
  const priority = authorialTexture?.preservation_priority || "medium";
  const intent = {
    ...baseIntent,
    rationale: [...(baseIntent?.rationale || [])],
  };

  // The base planner receives faithful naturalisation below, so an Aggressive
  // request cannot automatically escalate the entire document. Record the
  // request as depth permission only.
  if (requestedNaturalisation === "aggressive") {
    intent.rationale.push(
      priority === "high"
        ? "Aggressive/Deep authority is constrained by high preservation priority: intervene deeply only where a diagnosed defect exists; do not broaden editing across already-organic prose."
        : "Aggressive mode grants deeper reconstruction authority where diagnostics justify it; it does not create a rewrite quota."
    );
  }

  return intent;
}

export function buildInterventionPlan(diagnostics, {
  rewriteIntensity,
  lengthPreference,
  naturalisation,
  authorialTexture,
} = {}) {
  const requestedNaturalisation = (naturalisation || "faithful").toLowerCase();
  const requestedIntensity = (rewriteIntensity || "auto").toLowerCase();

  // Prevent the legacy aggressive branch from authorising universal restyling.
  // Aggressive is represented later as depth permission, not blanket breadth.
  const baseNaturalisation = requestedNaturalisation === "aggressive" ? "faithful" : requestedNaturalisation;
  const base = buildBasePlan(diagnostics, {
    rewriteIntensity: requestedIntensity,
    lengthPreference,
    naturalisation: baseNaturalisation,
  });

  const intent = adjustIntent(base.intent, authorialTexture, requestedNaturalisation);
  let items = applyPreservationPriority(base, diagnostics, authorialTexture);
  items = applyPageArtifactProtection(base, diagnostics, items);
  const summary = summariseItems(items);
  const authority = buildAuthority({
    items,
    authorialTexture,
    requestedIntensity,
    requestedNaturalisation,
    effectiveIntent: intent.effective,
  });

  const trainingPrinciples = [
    ...(base.trainingPrinciples || []),
    "Recognise existing authorial texture before editing. Human-corpus conformity and absence of synthetic architecture increase preservation priority; they do not prove authorship.",
    "Separate intervention depth from intervention breadth. Deep means permission for deep repair inside selected passages, not permission to rewrite the whole document.",
    "A KEEP decision is an editing ceiling as well as a planner label. Do not substantially alter KEEP material unless a later preservation-safe diagnostic explicitly reclassifies it.",
    "Ordinary, direct, content-bearing sentences can be valuable authorial texture. Do not upgrade them into abstract or nominalised prose simply because a stronger mode was selected.",
  ];

  return {
    ...base,
    plannerVersion: "authorial-texture-v5",
    naturalisation: requestedNaturalisation,
    intent,
    authorialTexture,
    interventionAuthority: authority,
    interventionBudget: intent.budget,
    items,
    summary,
    trainingPrinciples,
    documentGuidance: [
      ...trainingPrinciples,
      ...(base.documentGuidance || []),
      `Authorial-texture preservation priority: ${authorialTexture?.preservation_priority || "unknown"}.`,
      `Intervention authority: depth=${authority.depth_permission}; breadth=${authority.breadth}; maximum changed-sentence ratio=${Math.round(authority.max_changed_sentence_ratio * 100)}%.`,
    ],
  };
}
