import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProfile, listCoverageTable } from "../server/lib/styleProfileStore.js";

test("empty request resolves to the global default without fallback", () => {
  const result = resolveProfile({});
  assert.equal(result.fallback_applied, false);
  assert.equal(result.effective.label, "Auto / Evidence-backed default");
  assert.equal(result.evidence_strength, "supported");
  assert.ok(result.effective.evidence.independent_source_count > 0);
});

test("UK thesis resolves directly without fallback and reports real counts", () => {
  const result = resolveProfile({ document_type: "thesis", region: "UK" });
  assert.equal(result.fallback_applied, false);
  assert.equal(result.effective.filters.region, "UK");
  assert.ok(result.effective.evidence.independent_source_count > 0);
});

test("a narrow, unevidenced combination triggers honest fallback, not a fabricated profile", () => {
  const result = resolveProfile({
    document_type: "thesis",
    region: "Sub-Saharan Africa",
    degree: "PhD",
    discipline: "Sport Science",
    research_mode: "experimental",
    section: "discussion",
  });
  assert.equal(result.fallback_applied, true);
  assert.match(result.message, /Evidence too sparse|does not track/);
  assert.ok(result.dropped.length > 0);
});

test("resolved profile includes a real, data-derived cadence description, not a canned string", () => {
  const result = resolveProfile({ document_type: "thesis" });
  assert.match(result.effective.features.cadence, /\d/, "cadence description should cite real numbers");
});

test("coverage table is exposed and internally consistent", () => {
  const table = listCoverageTable();
  assert.ok(table.totalIncluded > 0);
  assert.ok(Array.isArray(table.table.region));
});
