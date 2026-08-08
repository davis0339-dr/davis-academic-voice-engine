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

test("surgical recovery supersedes the rejected broad plan for execution scoring", () => {
  const result = assessExecutionCompliance(baseResult({
    intervention_plan_summary: { KEEP: 36, SPLIT_OR_MERGE: 9 },
    edit_summary: {
      kept: 37,
      micro_edits: 8,
      sentence_restructures: 0,
      split_or_merge: 0,
      paragraph_reorders: 0,
      flags_for_author: [],
    },
    transformation_quality: { unchanged_sentence_ratio: 0.82 },
    surgical_recovery: {
      attempted: true,
      applied_edit_count: 8,
      considered_clear_edit_count: 9,
      execution_status: "surgical_plan_passed",
      execution_passed: true,
      max_changed_sentence_ratio: 0.38,
      rejected_edits: [{ rejected_reason: "optional_style_edit" }],
    },
  }));

  assert.equal(result.version, "surgical-defect-compliance-v1");
  assert.equal(result.planner_superseded, true);
  assert.equal(result.execution_passed, true);
  assert.equal(result.execution_status, "surgical_plan_passed");
  assert.equal(result.planned.intervention, 9);
  assert.equal(result.reported.intervention, 8);
  assert.equal(result.superseded_plan.intervention, 9);
});

test("surgical recovery remains visibly partial when too many clear proposals are rejected", () => {
  const result = assessExecutionCompliance(baseResult({
    intervention_plan_summary: { KEEP: 36, SPLIT_OR_MERGE: 9 },
    transformation_quality: { unchanged_sentence_ratio: 0.96 },
    surgical_recovery: {
      attempted: true,
      applied_edit_count: 2,
      considered_clear_edit_count: 10,
      execution_status: "surgical_partial",
      execution_passed: false,
      max_changed_sentence_ratio: 0.38,
      rejected_edits: new Array(8).fill({ rejected_reason: "replacement_not_surgical" }),
    },
  }));

  assert.equal(result.execution_passed, false);
  assert.equal(result.execution_status, "surgical_partial");
  assert.equal(result.under_executed, true);
  assert.equal(result.planner_superseded, true);
  assert.ok(result.execution_reasons.some((reason) => /2 of 10/i.test(reason)));
});
