import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuthorialExecutionRecoveryDirective, shouldAttemptAuthorialExecutionRecovery } from "../server/lib/underExecutionRecovery.js";

test("deep execution recovery explains concrete under-execution without turning metrics into quotas", () => {
  const directive = buildAuthorialExecutionRecoveryDirective({
    attempt: 1,
    compliance: {
      under_execution_codes: ["PLAN_STRUCTURAL_COVERAGE", "VISIBLE_CHANGE_FLOOR"],
      under_execution_reasons: ["Only 20% of planned concrete substantive restructuring is represented.", "Independent comparison finds 18% of source sentences visibly changed."],
      structural_coverage: 0.2,
      changed_sentence_ratio: 0.18,
      minimum_changed_sentence_ratio: 0.35,
      intervention_coverage: 0.53,
      planned: { total: 50, keep: 0, substantive: 9, discourseRepackage: 41 },
    },
  });
  assert.match(directive, /Deep structural/i);
  assert.match(directive, /PLAN_STRUCTURAL_COVERAGE/);
  assert.match(directive, /VISIBLE_CHANGE_FLOOR/);
  assert.match(directive, /semantic and evidential fidelity/i);
  assert.match(directive, /not rewrite quotas/i);
  assert.match(directive, /concrete execution defect/i);
});

test("visible-change floor alone never triggers another deep rewrite pass", () => {
  const should = shouldAttemptAuthorialExecutionRecovery({
    modePolicy: { authorial_reconstruction: true, requested_intensity: "deep" },
    compliance: { preservation_ok: true, under_executed: true, over_executed: false, under_execution_codes: ["VISIBLE_CHANGE_FLOOR"] },
  });
  assert.equal(should, false);
});

test("authorial naturalisation cannot recover into Deep when the author selected Minor", () => {
  const should = shouldAttemptAuthorialExecutionRecovery({
    modePolicy: { authorial_reconstruction: false, requested_intensity: "minor" },
    compliance: { preservation_ok: true, under_executed: true, over_executed: false, under_execution_codes: ["PLAN_STRUCTURAL_COVERAGE"] },
  });
  assert.equal(should, false);
});
