import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTHORIAL_EXECUTION_RECOVERY_LIMIT,
  shouldAttemptAuthorialExecutionRecovery,
  executionRecoveryAttemptSummary,
} from "../server/lib/underExecutionRecovery.js";

const authorialMode = { authorial_reconstruction: true };
const ordinaryMode = { authorial_reconstruction: false };

function compliance(overrides = {}) {
  return {
    preservation_ok: true,
    under_executed: true,
    over_executed: false,
    execution_status: "under-executed",
    execution_score: 0.61,
    under_execution_codes: ["PLAN_STRUCTURAL_COVERAGE"],
    changed_sentence_ratio: 0.22,
    structural_coverage: 0.33,
    ...overrides,
  };
}

test("deep authorial under-execution is automatically eligible for recovery", () => {
  assert.equal(shouldAttemptAuthorialExecutionRecovery({
    modePolicy: authorialMode,
    compliance: compliance(),
  }), true);
});

test("authorial recovery is independent of whether the internal quality pipeline already retried", () => {
  const result = {
    transformation_quality: {
      corrective_retry_used: true,
      rescue_retry_used: true,
    },
  };
  assert.equal(Boolean(result.transformation_quality.corrective_retry_used || result.transformation_quality.rescue_retry_used), true);
  assert.equal(shouldAttemptAuthorialExecutionRecovery({
    modePolicy: authorialMode,
    compliance: compliance(),
  }), true);
});

test("recovery stops when execution passes or preservation fails", () => {
  assert.equal(shouldAttemptAuthorialExecutionRecovery({
    modePolicy: authorialMode,
    compliance: compliance({ under_executed: false, execution_status: "passed" }),
  }), false);
  assert.equal(shouldAttemptAuthorialExecutionRecovery({
    modePolicy: authorialMode,
    compliance: compliance({ preservation_ok: false }),
  }), false);
});

test("over-execution and ordinary modes do not enter the authorial under-execution loop", () => {
  assert.equal(shouldAttemptAuthorialExecutionRecovery({
    modePolicy: authorialMode,
    compliance: compliance({ over_executed: true }),
  }), false);
  assert.equal(shouldAttemptAuthorialExecutionRecovery({
    modePolicy: ordinaryMode,
    compliance: compliance(),
  }), false);
});

test("authorial execution recovery has two additional attempts and exposes concise diagnostics", () => {
  assert.equal(AUTHORIAL_EXECUTION_RECOVERY_LIMIT, 2);
  const summary = executionRecoveryAttemptSummary({ attempt: 2, compliance: compliance(), selected: true });
  assert.deepEqual(summary, {
    attempt: 2,
    selected: true,
    execution_status: "under-executed",
    execution_score: 0.61,
    preservation_ok: true,
    under_execution_codes: ["PLAN_STRUCTURAL_COVERAGE"],
    changed_sentence_ratio: 0.22,
    structural_coverage: 0.33,
  });
});
