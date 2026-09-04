import { test } from "node:test";
import assert from "node:assert/strict";
import { preservationAction, preservationCandidateStatus, selectPreservationRepairCandidate } from "../server/lib/preservationLifecycle.js";

function audit(overrides = {}) {
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

test("one unsupported year triggers repair but never suppresses the complete candidate", () => {
  const action = preservationAction(audit({
    new_factual_claims_detected: true,
    warnings: [{ type: "new_numeric_value_introduced", detail: "2022" }],
  }));
  assert.equal(action.attempt_repair, true);
  assert.equal(action.return_complete_candidate, true);
  assert.equal(action.accepted_without_review, false);
});

test("a factually repaired candidate wins even when Expand remains slightly short", () => {
  const original = {
    revised_text: "Complete unsafe expanded draft with 2022.",
    preservation: audit({
      new_factual_claims_detected: true,
      warnings: [{ type: "new_numeric_value_introduced", detail: "2022" }],
    }),
    length_contract: { satisfied: false },
  };
  const repaired = {
    revised_text: "Complete source-bounded expanded draft without the unsupported date.",
    preservation: audit(),
    preservation_repair: {
      attempted: true,
      passed: false,
      preservation_cleared: true,
      length_contract_satisfied: false,
    },
  };
  const selected = selectPreservationRepairCandidate(original, repaired);
  assert.equal(selected.selected, "repaired");
  assert.equal(selected.result.revised_text, repaired.revised_text);
  assert.equal(selected.review_required, true);
  assert.equal(selected.length_contract_satisfied, false);
});

test("a failed repair retains the original complete draft for explicit review", () => {
  const original = {
    revised_text: "Complete original candidate.",
    preservation: audit({ citations_ok: false, warnings: [{ type: "missing_citation", detail: "Smith (2020)" }] }),
  };
  const repaired = {
    revised_text: "Still unsafe repair.",
    preservation: audit({ citations_ok: false, warnings: [{ type: "missing_citation", detail: "Smith (2020)" }] }),
    preservation_repair: { attempted: true, passed: false, preservation_cleared: false, length_contract_satisfied: true },
  };
  const selected = selectPreservationRepairCandidate(original, repaired);
  assert.equal(selected.selected, "original");
  assert.equal(selected.result.revised_text, original.revised_text);
  assert.equal(selected.review_required, true);
});

test("rhetorical marker and voice review do not spend a repair call", () => {
  const action = preservationAction(audit({
    researcher_voice_ok: false,
    rhetorical_semantic_ok: false,
    rhetorical_semantic_preservation: { passed: false, review_required: true, possible_proposition_losses: [{ sentence_index: 2 }] },
    warnings: [
      { type: "researcher_voice_shift", detail: "voice" },
      { type: "rhetorical_semantic_preservation", detail: "marker evidence" },
    ],
  }));
  assert.equal(action.attempt_repair, false);
  assert.equal(action.release.review_required, true);
  assert.equal(action.return_complete_candidate, true);
});

test("complete unresolved preservation work returns a review status rather than a no-output status", () => {
  const status = preservationCandidateStatus({
    compliance: { preservation_ok: false },
    preservationRelease: { review_required: true, repair_required: true },
    outputAcceptance: { reasons: ["semantic_preservation_failed"] },
  });
  assert.equal(status, "preservation_review_required");
});

test("non-blocking preservation advice does not downgrade an internally safe candidate", () => {
  const status = preservationCandidateStatus({
    compliance: { preservation_ok: true, execution_passed: true },
    preservationRelease: { review_required: true, repair_required: false, candidate_may_be_labelled_accepted: true },
    outputAcceptance: { reasons: [] },
  });
  assert.equal(status, "accepted");
});

test("an otherwise cleared draft that misses Expand is returned for length review", () => {
  const status = preservationCandidateStatus({
    compliance: { preservation_ok: true },
    preservationRelease: { review_required: false },
    outputAcceptance: { reasons: ["expand_length_contract_missed"] },
  });
  assert.equal(status, "length_review_required");
});

test("a complete near-copy remains visible but cannot be labelled accepted", () => {
  const status = preservationCandidateStatus({
    compliance: { preservation_ok: true, execution_passed: false, under_executed: true },
    preservationRelease: { review_required: false },
    outputAcceptance: { reasons: [] },
  });
  assert.equal(status, "execution_review_required");
});

test("a completed-output review failure cannot be labelled internally accepted", () => {
  const status = preservationCandidateStatus({
    compliance: { preservation_ok: true, execution_passed: true },
    preservationRelease: { candidate_may_be_labelled_accepted: true, review_required: false },
    outputAcceptance: { status: "review_required", reasons: ["feedback_opening_reconstruction_insufficient"] },
  });
  assert.equal(status, "output_review_required");
});
