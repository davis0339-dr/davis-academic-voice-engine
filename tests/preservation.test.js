import { test } from "node:test";
import assert from "node:assert/strict";
import { auditPreservation } from "../server/lib/preservation.js";
import { extractProtectedSpans } from "../server/lib/protect.js";

const source =
  "The sample included 214 firms and revenue grew 12.5% (Smith, 2020). The report called this \"a material weakness\".";

test("flags nothing when every protected span survives", () => {
  const revised =
    "Across 214 firms, revenue increased by 12.5% (Smith, 2020), a pattern the report called \"a material weakness\".";
  const result = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(result.numbers_ok, true);
  assert.equal(result.citations_ok, true);
  assert.equal(result.quotes_ok, true);
  assert.equal(result.study_stage_ok, true);
  assert.equal(result.warnings.length, 0);
});

test("flags a dropped citation", () => {
  const revised = "Across 214 firms, revenue increased by 12.5%, a pattern the report called \"a material weakness\".";
  const result = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(result.citations_ok, false);
  assert.ok(result.warnings.some((w) => w.type === "missing_citation"));
});

test("flags an altered number", () => {
  const revised = "Across 214 firms, revenue increased by 20% (Smith, 2020), a pattern the report called \"a material weakness\".";
  const result = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(result.numbers_ok, false);
});

test("flags an altered quotation", () => {
  const revised = "Across 214 firms, revenue increased by 12.5% (Smith, 2020), a pattern the report called \"a significant weakness\".";
  const result = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(result.quotes_ok, false);
});

test("flags a fabricated new citation that was not in the source", () => {
  const revised =
    "Across 214 firms, revenue increased by 12.5% (Smith, 2020; Jones, 2021), a pattern the report called \"a material weakness\".";
  const result = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(result.new_factual_claims_detected, true);
  assert.ok(result.warnings.some((w) => w.type === "new_citation_introduced"));
});

test("flags a proposal-stage shift from planned future research to present reporting", () => {
  const proposal = "In response to the identified gaps, this study will examine the effect of strategic initiatives on audit-firm performance while assessing the moderating role of proactiveness.";
  const shifted = "In response to the identified gaps, this study examines the effect of strategic initiatives on audit-firm performance while assessing the moderating role of proactiveness.";
  const result = auditPreservation(proposal, shifted, extractProtectedSpans(proposal));
  assert.equal(result.study_stage_ok, false);
  assert.ok(result.warnings.some((w) => w.type === "study_stage_shift"));
});

test("accepts a proposal-stage rephrase that remains explicitly planned", () => {
  const proposal = "This study will examine the effect of strategic initiatives on audit-firm performance.";
  const revised = "The present study aims to examine how strategic initiatives affect audit-firm performance.";
  const result = auditPreservation(proposal, revised, extractProtectedSpans(proposal));
  assert.equal(result.study_stage_ok, true);
});
