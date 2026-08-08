import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRewriteModePolicy } from "../server/lib/rewriteModePolicy.js";
import { deriveInterventionAuthority } from "../server/lib/interventionAuthority.js";

const strongTexture = {
  preservation_priority: "high",
  texture_score: 0.88,
};

test("Deep Authorial Reconstruction does not silently downgrade a strong-texture source", () => {
  const policy = resolveRewriteModePolicy({
    rewriteIntensity: "deep",
    naturalisation: "authorial",
    authorialTexture: strongTexture,
  });

  assert.equal(policy.requested_naturalisation, "authorial");
  assert.equal(policy.effective_naturalisation, "aggressive");
  assert.equal(policy.requested_intensity, "deep");
  assert.equal(policy.effective_intensity, "deep");
  assert.equal(policy.policy, "deep_authorial_reconstruction");
  assert.equal(policy.preservation_priority, "high");
  assert.equal(policy.authorial_reconstruction, true);
  assert.equal(policy.universal_rewrite_authorised, false);
  assert.equal(policy.detector_targeting, false);
  assert.equal(policy.opening_register_priority, "first_two_prose_paragraphs");
});

test("ordinary aggressive mode remains preservation-constrained for strong existing texture", () => {
  const policy = resolveRewriteModePolicy({
    rewriteIntensity: "deep",
    naturalisation: "aggressive",
    authorialTexture: strongTexture,
  });

  assert.equal(policy.requested_naturalisation, "aggressive");
  assert.equal(policy.effective_naturalisation, "faithful");
  assert.equal(policy.effective_intensity, "auto");
  assert.equal(policy.authorial_reconstruction, false);
});

test("authorial intervention authority is broader than ordinary high-preservation authority but remains a ceiling", () => {
  const planSummary = { KEEP: 20, DISCOURSE_REPACKAGE: 14, SPLIT_OR_MERGE: 5, SENTENCE_RESTRUCTURE: 2 };

  const ordinary = deriveInterventionAuthority({
    planSummary,
    authorialTexture: strongTexture,
    requestedIntensity: "deep",
    requestedNaturalisation: "aggressive",
    effectiveIntent: "discourse_reconstruction",
  });
  const authorial = deriveInterventionAuthority({
    planSummary,
    authorialTexture: strongTexture,
    requestedIntensity: "deep",
    requestedNaturalisation: "authorial",
    effectiveIntent: "discourse_reconstruction",
  });

  assert.equal(authorial.authorial_mode, true);
  assert.ok(authorial.max_changed_sentence_ratio > ordinary.max_changed_sentence_ratio);
  assert.ok(authorial.max_changed_sentence_ratio <= 0.95);
  assert.match(authorial.rule, /ceiling/i);
  assert.match(authorial.rule, /factual/i);
});
