import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRewriteModePolicy } from "../server/lib/rewriteModePolicy.js";
import { deriveInterventionAuthority } from "../server/lib/interventionAuthority.js";

const strongTexture = { preservation_priority: "high", texture_score: 0.88 };

test("Deep Authorial Reconstruction remains an explicit deep opt-in", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "deep", naturalisation: "authorial", authorialTexture: strongTexture });
  assert.equal(policy.requested_naturalisation, "authorial");
  assert.equal(policy.effective_naturalisation, "aggressive");
  assert.equal(policy.requested_intensity, "deep");
  assert.equal(policy.effective_intensity, "deep");
  assert.equal(policy.policy, "deep_authorial_reconstruction");
  assert.equal(policy.authorial_reconstruction, true);
  assert.equal(policy.author_choice_respected, true);
  assert.equal(policy.opening_register_priority, "first_two_prose_paragraphs");
});

test("Minor remains a hard ceiling even when Authorial reconstruction is selected", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "minor", naturalisation: "authorial", authorialTexture: strongTexture });
  assert.equal(policy.requested_naturalisation, "authorial");
  assert.equal(policy.effective_naturalisation, "faithful");
  assert.equal(policy.effective_intensity, "minor");
  assert.equal(policy.authorial_reconstruction, false);
  assert.equal(policy.depth_permission, "micro_edit_only");
  assert.equal(policy.author_choice_respected, true);
});

test("Minor also caps ordinary aggressive naturalisation", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "minor", naturalisation: "aggressive", authorialTexture: strongTexture });
  assert.equal(policy.effective_naturalisation, "faithful");
  assert.equal(policy.effective_intensity, "minor");
  assert.equal(policy.adaptive_reconstruction, false);
});

test("Moderate permits sentence, flow and diagnosed selective development but not hidden authorial reconstruction", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "moderate", naturalisation: "authorial", authorialTexture: strongTexture });
  assert.equal(policy.effective_naturalisation, "faithful");
  assert.equal(policy.effective_intensity, "moderate");
  assert.equal(policy.authorial_reconstruction, false);
  assert.equal(policy.depth_permission, "moderate_diagnostic_ceiling");
  assert.equal(policy.plan_execution_priority, "sentence_flow_and_selective_development");
});

test("authorial intervention authority is broad only when authorial mode is paired with Deep", () => {
  const planSummary = { KEEP: 20, DISCOURSE_REPACKAGE: 14, SPLIT_OR_MERGE: 5, SENTENCE_RESTRUCTURE: 2 };
  const minor = deriveInterventionAuthority({ planSummary, authorialTexture: strongTexture, requestedIntensity: "minor", requestedNaturalisation: "authorial", effectiveIntent: "preserve_polish" });
  const authorial = deriveInterventionAuthority({ planSummary, authorialTexture: strongTexture, requestedIntensity: "deep", requestedNaturalisation: "authorial", effectiveIntent: "discourse_reconstruction" });

  assert.equal(minor.authorial_mode, false);
  assert.equal(minor.min_changed_sentence_ratio, 0);
  assert.ok(minor.max_changed_sentence_ratio <= 0.35);
  assert.equal(authorial.authorial_mode, true);
  assert.ok(authorial.max_changed_sentence_ratio > minor.max_changed_sentence_ratio);
  assert.match(authorial.rule, /ceiling/i);
});
