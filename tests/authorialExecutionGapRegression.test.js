import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveInterventionAuthority } from "../server/lib/interventionAuthority.js";
import { assessExecutionCompliance } from "../server/lib/executionCompliance.js";

const strongTexture = {
  preservation_priority: "high",
  texture_score: 0.87,
};

const discourseHeavyPlan = {
  DISCOURSE_REPACKAGE: 41,
  SPLIT_OR_MERGE: 9,
};

function preservationPassed() {
  return {
    numbers_ok: true,
    citations_ok: true,
    technical_terms_ok: true,
    quotes_ok: true,
    study_stage_ok: true,
    new_factual_claims_detected: false,
  };
}

test("deep authorial discourse reconstruction protects meaning without freezing source wording", () => {
  const authority = deriveInterventionAuthority({
    planSummary: discourseHeavyPlan,
    authorialTexture: strongTexture,
    requestedIntensity: "deep",
    requestedNaturalisation: "authorial",
    effectiveIntent: "discourse_reconstruction",
  });

  assert.equal(authority.authorial_mode, true);
  assert.equal(authority.authorial_discourse_mode, true);
  assert.equal(authority.preservation_basis, "semantic_evidential_fidelity");
  assert.equal(authority.surface_preservation_required, false);
  assert.equal(authority.max_changed_sentence_ratio, 1);
  assert.equal(authority.max_substantive_operation_ratio, 1);
  assert.ok(authority.min_changed_sentence_ratio >= 0.30);
  assert.match(authority.rule, /does not require preservation of source sentence wording/i);
});

test("material authorial reconstruction is not misclassified as over-editing when fidelity passes", () => {
  const authority = deriveInterventionAuthority({
    planSummary: discourseHeavyPlan,
    authorialTexture: strongTexture,
    requestedIntensity: "deep",
    requestedNaturalisation: "authorial",
    effectiveIntent: "discourse_reconstruction",
  });

  const compliance = assessExecutionCompliance({
    intervention_plan_summary: discourseHeavyPlan,
    intervention_intent: { effective: "discourse_reconstruction" },
    intervention_authority: authority,
    edit_summary: {
      kept: 0,
      micro_edits: 2,
      sentence_restructures: 30,
      split_or_merge: 18,
      paragraph_reorders: 0,
    },
    transformation_quality: { unchanged_sentence_ratio: 0.02 },
    preservation: preservationPassed(),
  });

  assert.equal(compliance.over_executed, false);
  assert.equal(compliance.under_executed, false);
  assert.equal(compliance.execution_passed, true);
  assert.equal(compliance.execution_status, "passed");
});

test("nominal deep reconstruction is rejected for concrete structural under-execution while low visible change remains a separate variance", () => {
  const authority = deriveInterventionAuthority({
    planSummary: discourseHeavyPlan,
    authorialTexture: strongTexture,
    requestedIntensity: "deep",
    requestedNaturalisation: "authorial",
    effectiveIntent: "discourse_reconstruction",
  });

  const compliance = assessExecutionCompliance({
    intervention_plan_summary: discourseHeavyPlan,
    intervention_intent: { effective: "discourse_reconstruction" },
    intervention_authority: authority,
    edit_summary: {
      kept: 41,
      micro_edits: 9,
      sentence_restructures: 0,
      split_or_merge: 0,
      paragraph_reorders: 0,
    },
    transformation_quality: { unchanged_sentence_ratio: 0.82 },
    preservation: preservationPassed(),
  });

  assert.equal(compliance.execution_passed, false);
  assert.equal(compliance.under_executed, true);
  assert.equal(compliance.plan_fidelity_status, "under-executed");
  assert.ok(compliance.under_execution_codes.includes("PLAN_STRUCTURAL_COVERAGE"));
  assert.equal(compliance.under_execution_codes.includes("VISIBLE_CHANGE_FLOOR"), false);
  assert.ok(compliance.execution_variance_codes.includes("VISIBLE_CHANGE_FLOOR"));
});
