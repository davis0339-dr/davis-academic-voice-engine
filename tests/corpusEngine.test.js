import { test } from "node:test";
import assert from "node:assert/strict";
import { compileFamily, computeStrength, listCoverageTable, STRENGTH_THRESHOLDS } from "../server/lib/corpusEngine.js";

test("empty filters resolve to the full included corpus with no fallback", () => {
  const result = compileFamily({});
  assert.equal(result.fallback_applied, false);
  assert.equal(result.matchCount, listCoverageTable().totalIncluded);
  assert.equal(result.evidence_strength, "supported");
});

test("matched corpus exposes descriptive cadence median and IQR", () => {
  const result = compileFamily({});
  const cv = result.cadence.reference.sentence_length_cv;
  assert.ok(cv.n >= STRENGTH_THRESHOLDS.supportedAt);
  assert.ok(Number.isFinite(cv.q1));
  assert.ok(Number.isFinite(cv.median));
  assert.ok(Number.isFinite(cv.q3));
  assert.ok(cv.q1 <= cv.median && cv.median <= cv.q3);
  assert.match(result.cadence.interpretation, /not.*target/i);
});

test("UK + thesis is well evidenced directly (no fallback needed)", () => {
  const result = compileFamily({ document_type: "thesis", region: "UK" });
  assert.equal(result.fallback_applied, false);
  assert.equal(result.evidence_strength, computeStrength(result.matchCount));
  assert.ok(result.matchCount >= STRENGTH_THRESHOLDS.supportedAt);
});

test("a narrow, genuinely sparse combination triggers real fallback with a trace", () => {
  const result = compileFamily({ document_type: "thesis", region: "Sub-Saharan Africa", degree: "PhD", discipline: "Sport Science", research_mode: "experimental" });
  assert.equal(result.fallback_applied, true);
  assert.ok(result.dropped.length > 0);
  assert.equal(result.evidence_strength, computeStrength(result.matchCount));
});

test("a section filter is always dropped since the corpus has no section-level data", () => {
  const result = compileFamily({ section: "discussion" });
  assert.ok(result.dropped.some((d) => d.dimension === "section"));
});

test("coverage table counts sum to the same total as an empty-filter match", () => {
  const table = listCoverageTable();
  const byDocType = table.table.document_type.reduce((sum, row) => sum + row.count, 0);
  assert.equal(byDocType, table.totalIncluded);
});

test("computeStrength respects the configured thresholds", () => {
  assert.equal(computeStrength(0), "insufficient");
  assert.equal(computeStrength(STRENGTH_THRESHOLDS.emergingAt), "emerging");
  assert.equal(computeStrength(STRENGTH_THRESHOLDS.supportedAt), "supported");
});
