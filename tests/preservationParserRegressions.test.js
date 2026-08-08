import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProtectedSpans } from "../server/lib/protect.js";
import { auditPreservation } from "../server/lib/preservation.js";

test("post-2015 is preserved as factual year 2015 rather than false negative -2015", () => {
  const spans = extractProtectedSpans("The post-2015 period warrants focused analysis.");
  assert.ok(spans.numbers.includes("2015"));
  assert.equal(spans.numbers.includes("-2015"), false);

  const audit = auditPreservation(
    "The post-2015 period warrants focused analysis.",
    "Focusing on the period after 2015 warrants focused analysis."
  );
  assert.equal(audit.numbers_ok, true);
  assert.equal(audit.warnings.some((warning) => warning.type === "missing_numeric_span"), false);
});

test("leading Because is not absorbed into a narrative citation identity", () => {
  const source = "Hojat and Sharifzadeh (2017) showed heterogeneous firm responses.";
  const revised = "Because Hojat and Sharifzadeh (2017) demonstrated heterogeneous firm responses, panel analysis is appropriate.";
  const audit = auditPreservation(source, revised);
  assert.equal(audit.citations_ok, true);
  assert.equal(audit.warnings.some((warning) => warning.type === "missing_citation"), false);
  assert.equal(audit.warnings.some((warning) => warning.type === "new_citation_introduced"), false);
});
