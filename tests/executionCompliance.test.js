import { test } from "node:test";
import assert from "node:assert/strict";
import { assessExecutionCompliance, preferByExecutionCompliance } from "../server/lib/executionCompliance.js";

function baseResult(overrides = {}) {
  return {
    intervention_plan_summary: { KEEP: 41, SPLIT_OR_MERGE: 20, SENTENCE_RESTRUCTURE: 21 },
    intervention_intent: { effective: "discourse_reconstruction" },
    edit_summary: {
      kept: 41,
      micro_edits: 0,
      sentence_restructures: 21,
      split_or_merge: 20,
      paragraph_reorders: 0,
      flags_for_author: [],
    },
    transformation_quality: {
      unchanged_sentence_ratio: 0.42,
    },
    preservation: {
      numbers_ok: true,
      citations_ok: true,
      technical_terms_ok: true,
      quotes_ok: true,
      study_stage_ok: true,
      new_factual_claims_detected: false,
    },
    ...overrides,
  };
}

test("passes execution when model work broadly matches a demanding discourse-reconstruction plan", () => {
  const result = assessExecutionCompliance(baseResult());
  assert.equal(result.execution_passed, true);
  assert.equal(result.preservation_ok, true);
  assert.equal(result.candidate_status, "accepted");
  assert.equal(result.planned.intervention, 41);
  assert.equal(result.reported.intervention, 41);
  assert.equal(result.intervention_coverage, 1);
  assert.equal(result.structural_coverage, 1);
});

test("flags the observed 41-planned-versus-24-executed mismatch as under-execution", () => {
  const result = assessExecutionCompliance(baseResult({
    edit_summary: {
      kept: 58,
      micro_edits: 0,
      sentence_restructures: 12,
      split_or_merge: 12,
      paragraph_reorders: 0,
      flags_for_author: [],
    },
    transformation_quality: { unchanged_sentence_ratio: 0.62 },
  }));

  assert.equal(result.execution_passed, false);
  assert.equal(result.preservation_ok, true);
  assert.equal(result.candidate_status, "execution_under");
  assert.equal(result.planned.intervention, 41);
  assert.equal(result.reported.intervention, 24);
  assert.ok(result.intervention_coverage < 0.67);
  assert.ok(result.execution_reasons.some((reason) => /planner's intervention load/i.test(reason)));
});

test("uses independently measured unchanged-sentence evidence rather than trusting edit counts alone", () => {
  const result = assessExecutionCompliance(baseResult({
    transformation_quality: { unchanged_sentence_ratio: 0.9 },
  }));
  assert.equal(result.execution_passed, false);
  assert.ok(result.execution_reasons.some((reason) => /independent source\/revision comparison/i.test(reason)));
});

test("does not force a retry-level failure for a tiny, mostly-KEEP polish plan", () => {
  const result = assessExecutionCompliance(baseResult({
    intervention_plan_summary: { KEEP: 9, MICRO_EDIT: 2, SENTENCE_RESTRUCTURE: 1 },
    intervention_intent: { effective: "preserve_polish" },
    edit_summary: {
      kept: 10,
      micro_edits: 1,
      sentence_restructures: 1,
      split_or_merge: 0,
      paragraph_reorders: 0,
      flags_for_author: [],
    },
    transformation_quality: { unchanged_sentence_ratio: 0.8 },
  }));
  assert.equal(result.execution_passed, true);
});

test("deep execution can pass while factual preservation fails, without being mislabeled under-executed", () => {
  const result = assessExecutionCompliance(baseResult({
    preservation: {
      numbers_ok: true,
      citations_ok: true,
      technical_terms_ok: true,
      quotes_ok: false,
      study_stage_ok: true,
      new_factual_claims_detected: false,
    },
  }));

  assert.equal(result.execution_passed, true);
  assert.equal(result.passed, true);
  assert.equal(result.preservation_ok, false);
  assert.equal(result.candidate_status, "preservation_failed");
  assert.equal(result.execution_reasons.length, 0);
  assert.ok(result.preservation_reasons.some((reason) => /quoted material/i.test(reason)));
});

test("prefers a compliant second attempt when preservation remains intact", () => {
  const first = baseResult({
    revised_text: "first",
    edit_summary: {
      kept: 58,
      micro_edits: 0,
      sentence_restructures: 12,
      split_or_merge: 12,
      paragraph_reorders: 0,
      flags_for_author: [],
    },
    transformation_quality: { unchanged_sentence_ratio: 0.62 },
  });
  const second = baseResult({ revised_text: "second" });
  const preferred = preferByExecutionCompliance(first, second);
  assert.equal(preferred.selected, "second");
  assert.equal(preferred.result.revised_text, "second");
  assert.equal(preferred.compliance.execution_passed, true);
});

test("never prefers a deeper rewrite that breaks preservation", () => {
  const first = baseResult({ revised_text: "safe" });
  const second = baseResult({
    revised_text: "unsafe",
    preservation: {
      numbers_ok: false,
      citations_ok: true,
      technical_terms_ok: true,
      quotes_ok: true,
      study_stage_ok: true,
      new_factual_claims_detected: false,
    },
  });
  const preferred = preferByExecutionCompliance(first, second);
  assert.equal(preferred.selected, "first");
  assert.equal(preferred.result.revised_text, "safe");
});
