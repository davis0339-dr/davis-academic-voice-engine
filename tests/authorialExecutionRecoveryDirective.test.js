import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuthorialExecutionRecoveryDirective } from "../server/lib/underExecutionRecovery.js";

test("authorial execution recovery directive explains the actual under-execution without turning metrics into quotas", () => {
  const directive = buildAuthorialExecutionRecoveryDirective({
    attempt: 1,
    compliance: {
      under_execution_codes: ["PLAN_STRUCTURAL_COVERAGE", "VISIBLE_CHANGE_FLOOR"],
      under_execution_reasons: [
        "Only 20% of planned concrete substantive restructuring is represented.",
        "Independent comparison finds 18% of source sentences visibly changed.",
      ],
      structural_coverage: 0.2,
      changed_sentence_ratio: 0.18,
      minimum_changed_sentence_ratio: 0.35,
      intervention_coverage: 0.53,
      planned: {
        total: 50,
        keep: 0,
        substantive: 9,
        discourseRepackage: 41,
      },
    },
  });

  assert.match(directive, /previous Deep Authorial candidate under-executed/i);
  assert.match(directive, /PLAN_STRUCTURAL_COVERAGE/);
  assert.match(directive, /VISIBLE_CHANGE_FLOOR/);
  assert.match(directive, /41/);
  assert.match(directive, /semantic and evidential fidelity/i);
  assert.match(directive, /not numeric quotas/i);
  assert.match(directive, /execute the diagnosed structural work/i);
});
