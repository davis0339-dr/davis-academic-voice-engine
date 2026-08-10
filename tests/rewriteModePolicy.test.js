import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRewriteModePolicy } from "../server/lib/rewriteModePolicy.js";

test("Deep aggressive remains explicit deep authority without becoming a universal rewrite quota", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "deep", naturalisation: "aggressive" });
  assert.equal(policy.requested_naturalisation, "aggressive");
  assert.equal(policy.effective_naturalisation, "aggressive");
  assert.equal(policy.effective_intensity, "deep");
  assert.equal(policy.policy, "deep_diagnostic_authority");
  assert.equal(policy.universal_rewrite_authorised, false);
  assert.equal(policy.adaptive_reconstruction, true);
  assert.equal(policy.author_choice_respected, true);
});

test("Moderate aggressive honours expressive preference without enlarging the Moderate structural ceiling", () => {
  const policy = resolveRewriteModePolicy({
    rewriteIntensity: "moderate",
    naturalisation: "aggressive",
    authorialTexture: {
      semantic_preservation: { priority: "very_high" },
      expressive_preservation: { priority: "low" },
    },
  });
  assert.equal(policy.requested_naturalisation, "aggressive");
  assert.equal(policy.effective_naturalisation, "aggressive");
  assert.equal(policy.effective_intensity, "moderate");
  assert.equal(policy.depth_permission, "moderate_diagnostic_ceiling");
  assert.equal(policy.universal_rewrite_authorised, false);
  assert.equal(policy.semantic_preservation_priority, "very_high");
  assert.equal(policy.expressive_preservation_priority, "low");
  assert.equal(policy.surface_preservation_required, false);
});

test("Auto faithful leaves depth to diagnosis", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "auto", naturalisation: "faithful" });
  assert.equal(policy.effective_naturalisation, "faithful");
  assert.equal(policy.policy, "diagnostic_led_auto");
  assert.equal(policy.effective_intensity, "auto");
  assert.equal(policy.universal_rewrite_authorised, false);
});

test("Minor off remains local clarity-only authority", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "minor", naturalisation: "off" });
  assert.equal(policy.effective_naturalisation, "off");
  assert.equal(policy.policy, "minor_clarity_only");
  assert.equal(policy.effective_intensity, "minor");
  assert.equal(policy.adaptive_reconstruction, false);
  assert.equal(policy.depth_permission, "micro_edit_only");
});
