import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveInterventionAuthority } from "../server/lib/interventionAuthority.js";
import { assessExecutionCompliance } from "../server/lib/executionCompliance.js";
import { shouldAttemptAuthorialExecutionRecovery } from "../server/lib/underExecutionRecovery.js";

const discourseHeavyPlan = {
  DISCOURSE_REPACKAGE: 41,
  SPLIT_OR_MERGE: 9,
};

const strongTexture = {
  preservation_priority: "high",
  texture_score: 0.87,
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

test("deep aggressive discourse plan is not falsely capped at 95 percent", () => {
  const authority = deriveInterventionAuthority({
    planSummary: discourseHeavyPlan,
    authorialTexture: strongTexture,
    requestedIntensity: "deep",
    requestedNaturalisation: "aggressive",
    effectiveIntent: "discourse_reconstruction",
  });

  assert.equal(authority.authorial_mode, false);
  assert.equal(authority.depth_permission, "deep_where_diagnosed");
  assert.equal(authority.max_changed_sentence_ratio, 1);
  assert.equal(authority.max_substantive_operation_ratio, 1);
  assert.match(authority.rule, /arbitrary 95% cap/i);
});

test("full-scope deep discourse execution can pass without triggering surgical over-edit recovery", () => {
  const authority = deriveInterventionAuthority({
    planSummary: discourseHeavyPlan,
    authorialTexture: strongTexture,
    requestedIntensity: "deep",
    requestedNaturalisation: "aggressive",
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
    transformation_quality: { unchanged_sentence_ratio: 0 },
    preservation: preservationPassed(),
  });

  assert.equal(compliance.over_executed, false);
  assert.equal(compliance.under_executed, false);
  assert.equal(compliance.execution_passed, true);
});

test("explicit deep aggressive mode receives dedicated structural under-execution recovery", () => {
  const should = shouldAttemptAuthorialExecutionRecovery({
    modePolicy: {
      requested_intensity: "deep",
      depth_permission: "deep_where_diagnosed",
      adaptive_reconstruction: true,
      authorial_reconstruction: false,
    },
    compliance: {
      preservation_ok: true,
      under_executed: true,
      over_executed: false,
      under_execution_codes: ["PLAN_STRUCTURAL_COVERAGE"],
    },
  });

  assert.equal(should, true);
});
