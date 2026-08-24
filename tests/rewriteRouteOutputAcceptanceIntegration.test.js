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
  const acceptanceIndex = route.indexOf("const baseOutputAcceptance = auditOutputAcceptance({");
  const verdictIndex = route.indexOf("result.candidate_verdict = {");
  assert.ok(residualIndex >= 0);
  assert.ok(acceptanceIndex > residualIndex);
  assert.ok(verdictIndex > acceptanceIndex);
});

test("hard preservation failure is converted to an explicit source-retained non-edit before release auditing", () => {
  const fallbackIndex = route.indexOf("retainSourceAfterPreservationFailure({");
  const acceptanceIndex = route.indexOf("const baseOutputAcceptance = auditOutputAcceptance({");
  assert.ok(fallbackIndex >= 0);
  assert.ok(acceptanceIndex > fallbackIndex);
  assert.match(route, /!executionCompliance\.preservation_ok && preservationRelease\.hard_failure/);
  assert.match(route, /rejected_preservation_failure: rejectedPreservationFailure/);
});

test("review-only rhetorical evidence is visible but cannot be labelled accepted", () => {
  assert.match(route, /if \(preservationRelease\?\.review_required\) return "preservation_review_required"/);
  assert.match(route, /preservationRelease\.review_required \? "review-required"/);
});

test("preservation recovery repairs the completed candidate instead of regenerating the whole source", () => {
  assert.match(route, /repairPreservationCandidate\(\{[\s\S]*sourceText: text,[\s\S]*candidateResult: result/);
  assert.doesNotMatch(route, /const recoveryResult = enrichForCompliance\(await runRewrite\(\)\)/);
  assert.match(route, /selectedAttempt = "preservation-candidate-repair"/);
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

test("historical duplicate candidates are blocked from final clearance and detector spending", () => {
  assert.match(route, /rewrite\(\{[\s\S]*priorCandidateHistory,[\s\S]*\}\)/);
  assert.match(route, /isHistoricalDuplicate\(result\.revised_text, priorCandidateHistory\)/);
  assert.match(route, /"historical_candidate_repetition"/);
  assert.match(route, /exact_historical_duplicate: historicalDuplicate/);
  assert.match(route, /rememberCandidate\(result\.revised_text, priorCandidateHistory\)/);
});

test("rewrite requests are provider-budgeted and expose request-scoped usage", () => {
  assert.match(route, /rewriteRouter\.post\("\/rewrite", llmProvider\.usageMiddleware/);
  assert.match(route, /provider_usage: llmProvider\.usageSnapshot\(\)/);
});

test("a failed optional model refinement blocks further residual provider spending", () => {
  assert.match(route, /const optionalProviderFailure = Boolean\(/);
  assert.match(route, /!optionalProviderFailure &&/);
  assert.match(route, /residualStageBlockedReason = "provider_refinement_failed"/);
});

test("execution defects are repaired selectively instead of regenerating the full manuscript", () => {
  assert.match(route, /const fullDocumentExecutionRecoveryAllowed = false/);
  assert.match(route, /fullDocumentExecutionRecoveryAllowed &&[\s\S]*shouldAttemptAuthorialExecutionRecovery/);
  assert.match(route, /execution_repair_deferred_to_selective_residual: true/);
  assert.match(route, /max_authorial_execution_recovery_retries: 0/);
  assert.match(route, /max_reconciliation_retries: 0/);
});
