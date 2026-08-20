import { test } from "node:test";
import assert from "node:assert/strict";
import { retainSourceAfterPreservationFailure } from "../server/lib/finalSafetyFallback.js";

test("a preservation-failed candidate is quarantined and the source is returned unchanged", () => {
  const sourceText = "Debt costs were 7% in Smith (2022).";
  const unsafeCandidate = {
    revised_text: "Debt costs fell to 4% in Smith (2023).",
    intervention_plan_summary: { SENTENCE_RESTRUCTURE: 1 },
    edit_summary: {
      kept: 0,
      micro_edits: 0,
      sentence_restructures: 1,
      split_or_merge: 0,
      paragraph_reorders: 0,
      flags_for_author: [],
    },
    preservation: {
      numbers_ok: false,
      citations_ok: false,
      technical_terms_ok: true,
      quotes_ok: true,
      study_stage_ok: true,
      new_factual_claims_detected: true,
    },
  };

  const result = retainSourceAfterPreservationFailure({
    sourceText,
    result: unsafeCandidate,
  });

  assert.equal(result.revised_text, sourceText);
  assert.equal(result.safety_fallback.source_retained, true);
  assert.equal(result.safety_fallback.successful_revision, false);
  assert.equal(result.safety_fallback.reason_code, "PRESERVATION_FAILURE_AFTER_RECOVERY");
  assert.equal(result.preservation.numbers_ok, true);
  assert.equal(result.preservation.citations_ok, true);
  assert.deepEqual(result.rejected_preservation_candidate.preservation, unsafeCandidate.preservation);
  assert.equal(result.rejected_preservation_candidate.revised_text_included, false);
});
