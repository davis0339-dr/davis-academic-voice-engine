import { test } from "node:test";
import assert from "node:assert/strict";
import { assessExecutionCompliance } from "../server/lib/executionCompliance.js";

test("preservation-heavy plan fails when model rewrites nearly the entire source", () => {
  const result = {
    intervention_plan_summary: {
      KEEP: 36,
      SPLIT_OR_MERGE: 9,
    },
    intervention_intent: { effective: "clarity_flow" },
    intervention_authority: {
      preservation_priority: "high",
      breadth: "targeted",
      max_changed_sentence_ratio: 0.38,
      max_substantive_operation_ratio: 0.32,
    },
    edit_summary: {
      kept: 0,
      micro_edits: 28,
      sentence_restructures: 14,
      split_or_merge: 11,
      paragraph_reorders: 0,
    },
    transformation_quality: {
      unchanged_sentence_ratio: 0.04,
    },
    preservation: {
      numbers_ok: true,
      citations_ok: true,
      technical_terms_ok: true,
      quotes_ok: true,
      study_stage_ok: true,
      new_factual_claims_detected: false,
    },
  };

  const compliance = assessExecutionCompliance(result);
  assert.equal(compliance.execution_passed, false);
  assert.equal(compliance.over_executed, true);
  assert.equal(compliance.execution_status, "over-executed");
  assert.ok(compliance.over_execution_reasons.some((reason) => /maximum breadth/i.test(reason)));
});

test("targeted candidate passes when actual disturbance stays inside planner ceiling", () => {
  const result = {
    intervention_plan_summary: {
      KEEP: 36,
      SPLIT_OR_MERGE: 9,
    },
    intervention_intent: { effective: "clarity_flow" },
    intervention_authority: {
      preservation_priority: "high",
      breadth: "targeted",
      max_changed_sentence_ratio: 0.40,
      max_substantive_operation_ratio: 0.36,
    },
    edit_summary: {
      kept: 34,
      micro_edits: 2,
      sentence_restructures: 2,
      split_or_merge: 7,
      paragraph_reorders: 0,
    },
    transformation_quality: {
      unchanged_sentence_ratio: 0.71,
    },
    preservation: {
      numbers_ok: true,
      citations_ok: true,
      technical_terms_ok: true,
      quotes_ok: true,
      study_stage_ok: true,
      new_factual_claims_detected: false,
    },
  };

  const compliance = assessExecutionCompliance(result);
  assert.equal(compliance.over_executed, false);
  assert.equal(compliance.execution_status, "passed");
  assert.equal(compliance.execution_passed, true);
});
