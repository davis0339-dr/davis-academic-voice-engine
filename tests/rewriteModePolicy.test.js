import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRewriteModePolicy } from "../server/lib/rewriteModePolicy.js";

test("aggressive mode is diagnostic-led permission, not universal rewrite", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "deep", naturalisation: "aggressive" });
  assert.equal(policy.requested_naturalisation, "aggressive");
  assert.equal(policy.effective_naturalisation, "faithful");
  assert.equal(policy.effective_intensity, "deep");
  assert.equal(policy.policy, "adaptive_human_reconstruction");
  assert.equal(policy.universal_rewrite_authorised, false);
  assert.equal(policy.adaptive_reconstruction, true);
});

test("faithful mode remains faithful and selective", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "auto", naturalisation: "faithful" });
  assert.equal(policy.effective_naturalisation, "faithful");
  assert.equal(policy.policy, "faithful_selective");
  assert.equal(policy.universal_rewrite_authorised, false);
});

test("off mode does not enable adaptive reconstruction", () => {
  const policy = resolveRewriteModePolicy({ rewriteIntensity: "minor", naturalisation: "off" });
  assert.equal(policy.effective_naturalisation, "off");
  assert.equal(policy.policy, "clarity_only");
  assert.equal(policy.adaptive_reconstruction, false);
});
