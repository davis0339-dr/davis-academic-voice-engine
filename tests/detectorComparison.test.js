import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSourceRevisionComparison } from "../server/lib/detectorComparison.js";

test("comparison labels source and revised explicitly and returns metric deltas", () => {
  const source = "Introduction\nCorporate debt is important for firms because financing choices affect investment. Creditors assess governance and reporting quality.\n\nA second paragraph contains a much longer sentence because it carries qualification, context, and an explanation of why the relationship may vary across firms and periods.";
  const revised = "Introduction\nCorporate debt matters for investment and financing. Lenders also examine governance.\n\nThe relationship varies across firms and over time because credit conditions change.\n\nA third paragraph adds another distinct analytical unit for comparison.";
  const report = buildSourceRevisionComparison(source, revised);

  assert.equal(report.labels.source, "Original source (before)");
  assert.equal(report.labels.revised, "Revised candidate (after)");
  assert.ok(Array.isArray(report.metrics));
  assert.ok(report.metrics.length >= 10);
  assert.ok(report.metrics.some((row) => row.key === "mean_sentence_words" && row.delta !== null));
  assert.equal(report.note.includes("not an AI-authorship score"), true);
});

test("opening profile uses the first two prose paragraphs rather than the whole document", () => {
  const source = "First source paragraph.\n\nSecond source paragraph.";
  const revised = "Heading\nShort opening one.\n\nShort opening two.\n\nThis third paragraph is intentionally much longer because it should not be included in the opening-two-paragraph profile and therefore should make the whole-document profile measurably different from the opening profile.";
  const report = buildSourceRevisionComparison(source, revised);
  assert.equal(report.revised_opening_text_available, true);
  assert.notEqual(report.revised.word_count, report.revised_opening_two_paragraphs.word_count);
});
