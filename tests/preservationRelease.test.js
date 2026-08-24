import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPreservationRelease } from "../server/lib/preservationRelease.js";

function safeBase(overrides = {}) {
  return {
    numbers_ok: true,
    citations_ok: true,
    technical_terms_ok: true,
    quotes_ok: true,
    study_stage_ok: true,
    researcher_voice_ok: true,
    document_structure_ok: true,
    list_counts_ok: true,
    new_factual_claims_detected: false,
    warnings: [],
    rhetorical_semantic_ok: true,
    rhetorical_semantic_preservation: { passed: true, review_required: false },
    ...overrides,
  };
}

test("review-only rhetorical evidence keeps a complete candidate visible without clearing it", () => {
  const decision = classifyPreservationRelease(safeBase({
    rhetorical_semantic_ok: false,
    rhetorical_semantic_preservation: {
      passed: false,
      review_required: true,
      possible_proposition_losses: [{ sentence_index: 3 }],
      material_proposition_loss: true,
    },
    warnings: [{ type: "rhetorical_semantic_preservation", detail: "Possible proposition loss." }],
  }));

  assert.equal(decision.hard_failure, false);
  assert.equal(decision.review_required, true);
  assert.equal(decision.candidate_may_be_shown_for_review, true);
});

test("citation, numeric and study-stage failures remain hard blockers", () => {
  for (const preservation of [
    safeBase({ citations_ok: false, warnings: [{ type: "missing_citation", detail: "Smith (2022)" }] }),
    safeBase({ numbers_ok: false, warnings: [{ type: "missing_numeric_span", detail: "7%" }] }),
    safeBase({ study_stage_ok: false, warnings: [{ type: "study_stage_shift", detail: "proposal became completed" }] }),
  ]) {
    const decision = classifyPreservationRelease(preservation);
    assert.equal(decision.hard_failure, true);
    assert.equal(decision.candidate_may_be_shown_for_review, false);
  }
});

test("modality, causality, scope and comparison drift remain hard blockers", () => {
  for (const field of [
    "modality_changes",
    "causality_changes",
    "scope_or_generalisation_changes",
    "comparison_magnitude_or_direction_changes",
  ]) {
    const decision = classifyPreservationRelease(safeBase({
      rhetorical_semantic_ok: false,
      rhetorical_semantic_preservation: {
        passed: false,
        review_required: true,
        [field]: [{ type: field }],
      },
    }));
    assert.equal(decision.hard_failure, true, `${field} must remain blocking`);
  }
});
