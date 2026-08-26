const REPAIR_REQUIRED_WARNING_TYPES = new Set([
  "missing_numeric_span",
  "range_corruption",
  "missing_citation",
  "missing_technical_term",
  "altered_quotation",
  "new_citation_introduced",
  "new_numeric_value_introduced",
  "list_count_mismatch",
  "study_stage_shift",
  "document_structure_shift",
]);

const REVIEW_ONLY_WARNING_TYPES = new Set([
  "researcher_voice_shift",
  "rhetorical_semantic_preservation",
  "length_range_review",
  "claim_attachment_review",
]);

function count(list) {
  return Array.isArray(list) ? list.length : 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

// One preservation authority for every rewrite path. Concrete evidence,
// stage, structure and semantic-force defects receive one bounded repair and
// prevent an accepted label. Rhetorical marker/overlap, voice and length
// evidence remains advisory. A complete paid draft is always visible: these
// safeguards govern clearance, not whether the result is erased.
export function classifyPreservationRelease(preservation = {}) {
  const rhetorical = preservation.rhetorical_semantic_preservation || {};
  const warnings = Array.isArray(preservation.warnings) ? preservation.warnings : [];
  const repairWarnings = warnings.filter((warning) => REPAIR_REQUIRED_WARNING_TYPES.has(warning?.type));
  const reviewWarnings = warnings.filter((warning) => REVIEW_ONLY_WARNING_TYPES.has(warning?.type));
  const semanticForceChanges = [
    ...(rhetorical.modality_changes || []),
    ...(rhetorical.causality_changes || []),
    ...(rhetorical.scope_or_generalisation_changes || []),
    ...(rhetorical.comparison_magnitude_or_direction_changes || []),
    ...(rhetorical.temporality_changes || []),
    ...(rhetorical.unsupported_additions || []),
  ];
  const concreteInvariantFailure = Boolean(
    preservation.numbers_ok === false ||
    preservation.citations_ok === false ||
    preservation.technical_terms_ok === false ||
    preservation.quotes_ok === false ||
    preservation.study_stage_ok === false ||
    preservation.document_structure_ok === false ||
    preservation.list_counts_ok === false
  );
  const semanticForceFailure = semanticForceChanges.length > 0;
  // Retain compatibility with externally constructed or older audit payloads
  // that expose only the aggregate factual-drift flag. Current audits also
  // provide the precise warning type used in UI and repair instructions.
  const aggregateFactualFailure = preservation.new_factual_claims_detected === true;
  const repairRequired = concreteInvariantFailure || repairWarnings.length > 0 || semanticForceFailure || aggregateFactualFailure;
  const rhetoricalReview = Boolean(
    preservation.rhetorical_semantic_ok === false ||
    rhetorical.review_required ||
    count(rhetorical.possible_proposition_losses) ||
    rhetorical.material_proposition_loss ||
    rhetorical.material_rhetorical_role_loss
  );

  const voiceReview = preservation.researcher_voice_ok === false;
  const reviewRequired = repairRequired || rhetoricalReview || voiceReview || reviewWarnings.length > 0;
  // Review-only marker, register and soft-length evidence must remain visible,
  // but it must not contradictorily prevent an otherwise safe complete draft
  // from being labelled internally cleared. Material rhetorical-semantic loss
  // still blocks clearance through rhetorical_semantic_ok=false.
  const acceptanceBlocked = repairRequired || preservation.rhetorical_semantic_ok === false;
  const releaseStatus = repairRequired
    ? "repair_or_researcher_review_required"
    : acceptanceBlocked
      ? "researcher_review_required"
      : reviewRequired
        ? "cleared_with_advisory"
        : "cleared";

  return {
    release_status: releaseStatus,
    cleared: !acceptanceBlocked,
    hard_failure: repairRequired,
    repair_required: repairRequired,
    review_required: reviewRequired,
    concrete_invariant_failure: concreteInvariantFailure,
    protected_invariant_failure: concreteInvariantFailure,
    semantic_force_failure: semanticForceFailure,
    aggregate_factual_failure: aggregateFactualFailure,
    repair_warning_types: unique(repairWarnings.map((warning) => warning.type)),
    hard_warning_types: unique(repairWarnings.map((warning) => warning.type)),
    review_warning_types: unique(reviewWarnings.map((warning) => warning.type)),
    semantic_force_change_count: semanticForceChanges.length,
    candidate_may_be_shown_for_review: true,
    candidate_may_be_labelled_accepted: !acceptanceBlocked,
    note: repairRequired
      ? "A complete draft may be shown, but it cannot be labelled accepted until its concrete evidence, stage, structure or semantic-force defect is repaired or reviewed by the researcher."
      : reviewRequired
        ? "The candidate is internally cleared with advisory evidence. Rhetorical markers, voice or soft-length signals remain visible for researcher judgement but do not suppress or downgrade the complete draft."
        : "The candidate cleared concrete invariants and advisory preservation review.",
  };
}
