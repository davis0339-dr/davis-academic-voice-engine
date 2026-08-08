import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProtectedSpans } from "../server/lib/protect.js";
import { auditPreservation } from "../server/lib/preservation.js";
import { buildDocumentMap } from "../server/lib/documentMap.js";
import { chunkDocument } from "../server/lib/chunker.js";

test("range endpoints are never misread as negative numbers", () => {
  const spans = extractProtectedSpans("The study covers 2015-2024 and interviews last 45-60 minutes.");
  assert.ok(spans.ranges.includes("2015-2024"));
  assert.ok(spans.ranges.includes("45-60"));
  assert.ok(spans.numbers.includes("2015"));
  assert.ok(spans.numbers.includes("2024"));
  assert.ok(!spans.numbers.includes("-2024"));
  assert.ok(!spans.numbers.includes("-2015"));
});

test("between X and Y is accepted as the same numeric range meaning", () => {
  const source = "Each interview is expected to last 45-60 minutes.";
  const revised = "Each interview is expected to last between 45 and 60 minutes.";
  const audit = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(audit.ranges_ok, true);
  assert.ok(!audit.warnings.some((warning) => warning.type === "range_corruption"));
});

test("comma-separated range endpoints are still rejected because they no longer express an interval", () => {
  const source = "The panel covers 2015-2024 firm-year observations.";
  const revised = "The panel covers 2015, 2024 firm-year observations.";
  const audit = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(audit.ranges_ok, false);
  assert.ok(audit.warnings.some((warning) => warning.type === "range_corruption"));
});

test("citation preservation is author-year semantic rather than parenthetical-versus-narrative formatting", () => {
  const source = "Trustworthiness follows established qualitative criteria (Lincoln & Guba, 1985). Data will also be verified (Securities and Exchange Commission [SEC], 2025a, 2025b).";
  const revised = "Trustworthiness follows the criteria proposed by Lincoln & Guba (1985). Data will also be verified using filings from the Securities and Exchange Commission [SEC] (2025a, 2025b).";
  const audit = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(audit.citations_ok, true);
  assert.ok(!audit.warnings.some((warning) => warning.type === "missing_citation"));
  assert.ok(!audit.warnings.some((warning) => warning.type === "new_citation_introduced"));
});

test("ordinary prose mentioning two frameworks is not misclassified as an explicit two-item list", () => {
  const source = "Integrating these two frameworks yields a straightforward causal logic: governance affects monitoring and information credibility; those channels shape lender assessment; and risk assessments affect contract terms.";
  const revised = source;
  const audit = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(audit.list_counts_ok, true);
  assert.ok(!audit.warnings.some((warning) => warning.type === "list_count_mismatch"));
});

test("standalone institutional Section labels are detected and retained as passthrough chunks", () => {
  const source = "Section 1\n\nIntroduction\n\nThe study examines corporate governance.\n\nSection 2\n\nLiterature Review\n\nPrior evidence is mixed.";
  const map = buildDocumentMap(source);
  assert.ok(map.headings.some((heading) => heading.text === "Section 1"));
  assert.ok(map.headings.some((heading) => heading.text === "Section 2"));
  const chunks = chunkDocument(source, map, { targetWordsPerChunk: 300 }).chunks;
  const section1 = chunks.find((chunk) => chunk.heading === "Section 1");
  const section2 = chunks.find((chunk) => chunk.heading === "Section 2");
  assert.ok(section1);
  assert.ok(section2);
  assert.equal(section1.rewriteMode, "passthrough");
  assert.equal(section2.rewriteMode, "passthrough");
});
