const HARD_WARNING_TYPES = new Set([
  "missing_numeric_span",
  "range_corruption",
  "missing_citation",
  "missing_technical_term",
  "altered_quotation",
  "new_citation_introduced",
  "new_numeric_value_introduced",
  "list_count_mismatch",
  "study_stage_shift",
  "researcher_voice_shift",
  "document_structure_shift",
]);

function count(list) {
  return Array.isArray(list) ? list.length : 0;
}

// Deterministic protected-item and semantic-force failures remain release
// blockers. Rhetorical matching is valuable evidence, but its lexical/marker
// heuristics must not silently destroy a complete candidate that otherwise
// preserved citations, figures, stage and factual force. Such a candidate is
// returned visibly as review-required, never labelled as accepted.
export function classifyPreservationRelease(preservation = {}) {
  const rhetorical = preservation.rhetorical_semantic_preservation || {};
  const hardWarnings = (preservation.warnings || [])
    .filter((warning) => HARD_WARNING_TYPES.has(warning?.type));
  const semanticForceChanges = [
    ...(rhetorical.modality_changes || []),
    ...(rhetorical.causality_changes || []),
    ...(rhetorical.scope_or_generalisation_changes || []),
    ...(rhetorical.comparison_magnitude_or_direction_changes || []),
    ...(rhetorical.temporality_changes || []),
    ...(rhetorical.unsupported_additions || []),
  ];
  const protectedInvariantFailure = Boolean(
    preservation.numbers_ok === false ||
    preservation.citations_ok === false ||
    preservation.technical_terms_ok === false ||
    preservation.quotes_ok === false ||
    preservation.study_stage_ok === false ||
    preservation.researcher_voice_ok === false ||
    preservation.document_structure_ok === false ||
    preservation.list_counts_ok === false
  );
  const hardFailure = protectedInvariantFailure || hardWarnings.length > 0 || semanticForceChanges.length > 0;
  const rhetoricalReview = Boolean(
    preservation.rhetorical_semantic_ok === false ||
    rhetorical.review_required ||
    count(rhetorical.possible_proposition_losses) ||
    rhetorical.material_proposition_loss ||
    rhetorical.material_rhetorical_role_loss
  );

  return {
    hard_failure: hardFailure,
    review_required: !hardFailure && rhetoricalReview,
    protected_invariant_failure: protectedInvariantFailure,
    hard_warning_types: [...new Set(hardWarnings.map((warning) => warning.type))],
    semantic_force_change_count: semanticForceChanges.length,
    candidate_may_be_shown_for_review: !hardFailure,
    note: hardFailure
      ? "The candidate breaches a protected factual, evidential, stage, structural or semantic-force invariant and must not be released."
      : rhetoricalReview
        ? "Hard evidence invariants passed. Rhetorical preservation heuristics require researcher review, so the candidate remains visible but is not cleared as successful."
        : "The candidate cleared hard invariants and rhetorical preservation review.",
  };
}
