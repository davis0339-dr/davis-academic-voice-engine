import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProfile, listProfiles } from "../server/lib/styleProfileStore.js";

test("empty request resolves to the global default without fallback", () => {
  const result = resolveProfile({});
  assert.equal(result.fallback_applied, false);
  assert.equal(result.effective.profile_id, "global-default");
  assert.equal(result.evidence_strength, "supported");
});

test("thesis document type resolves to the thesis family without fallback", () => {
  const result = resolveProfile({ document_type: "thesis" });
  assert.equal(result.fallback_applied, false);
  assert.equal(result.effective.profile_id, "thesis-dissertation");
});

test("a narrow, unevidenced combination triggers honest fallback, not a fabricated profile", () => {
  const result = resolveProfile({
    document_type: "thesis",
    region: "UK",
    degree: "PhD",
    discipline: "Finance",
    research_mode: "quantitative_archival",
    section: "discussion",
  });
  assert.equal(result.fallback_applied, true);
  assert.equal(result.effective.profile_id, "thesis-dissertation");
  assert.match(result.message, /Evidence too sparse/);
});

test("profile store exposes exactly the evidence-backed families, no invented narrow ones", () => {
  const profiles = listProfiles();
  assert.equal(profiles.length, 2);
  assert.ok(profiles.every((p) => p.evidence.strength === "supported"));
});
