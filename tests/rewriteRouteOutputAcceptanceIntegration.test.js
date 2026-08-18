import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../server/routes/rewrite.js", import.meta.url), "utf8");

test("rewrite route forwards full context into selective residual recovery", () => {
  assert.match(
    route,
    /selectiveResidualRework\(\{[\s\S]*styleFilters: styleFilters \|\| \{\}[\s\S]*rewriteIntensity: modePolicy\.effective_intensity[\s\S]*naturalisation: modePolicy\.effective_naturalisation[\s\S]*planSummary: result\.intervention_plan_summary \|\| \{\}/
  );
});

test("completed-output acceptance runs after residual recovery and before final verdict", () => {
  const residualIndex = route.indexOf("selectiveResidualRework({");
  const acceptanceIndex = route.indexOf("const completedOutputAcceptance = auditOutputAcceptance({");
  const verdictIndex = route.indexOf("result.candidate_verdict = {");
  assert.ok(residualIndex >= 0);
  assert.ok(acceptanceIndex > residualIndex);
  assert.ok(verdictIndex > acceptanceIndex);
});

test("preservation failure is converted to an explicit source-retained non-edit before release auditing", () => {
  const fallbackIndex = route.indexOf("retainSourceAfterPreservationFailure({");
  const acceptanceIndex = route.indexOf("const completedOutputAcceptance = auditOutputAcceptance({");
  assert.ok(fallbackIndex >= 0);
  assert.ok(acceptanceIndex > fallbackIndex);
  assert.match(route, /if \(!sourceRetainedForSafety && !executionCompliance\.preservation_ok\)/);
  assert.match(route, /rejected_preservation_failure: rejectedPreservationFailure/);
});

test("Moderate/Deep assertive output gate can block final acceptance", () => {
  assert.match(
    route,
    /outputAcceptanceEnforced && outputAcceptance\?\.status !== "pass"\) return "internal_quality_review_required"/
  );
  assert.match(route, /\["moderate", "deep"\]/);
  assert.match(route, /\["aggressive", "authorial"\]/);
});

test("candidate verdict reports internal acceptance and external-check recommendation", () => {
  assert.match(route, /output_acceptance: completedOutputAcceptance\.status/);
  assert.match(route, /output_acceptance_score: completedOutputAcceptance\.score/);
  assert.match(route, /external_detector_check_recommended:/);
});
