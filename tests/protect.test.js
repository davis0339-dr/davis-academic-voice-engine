import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProtectedSpans } from "../server/lib/protect.js";

test("extracts parenthetical, narrative and numbered citations", () => {
  const text =
    "Prior work (Smith, 2020) established this. Jones (2019) disagreed. See also (Ahmed & Lee, 2018; Chen et al., 2021) and [3].";
  const spans = extractProtectedSpans(text);
  assert.ok(spans.citations.includes("(Smith, 2020)"));
  assert.ok(spans.citations.includes("Jones (2019)"));
  assert.ok(spans.citations.includes("(Ahmed & Lee, 2018; Chen et al., 2021)"));
  assert.ok(spans.citations.includes("[3]"));
});

test("extracts institutional and multi-word corporate-author citations", () => {
  const text =
    "The market expanded rapidly (Market Data Forecast, 2025; Grand View Research, 2025). Financial Reporting Council (2024) reported a similar pattern. A later estimate relied on (Financial Reporting Council, as cited in Bloomberg Tax, 2025; CK Search Global, 2024).";
  const spans = extractProtectedSpans(text);
  assert.ok(spans.citations.includes("(Market Data Forecast, 2025; Grand View Research, 2025)"));
  assert.ok(spans.citations.includes("Financial Reporting Council (2024)"));
  assert.ok(spans.citations.includes("(Financial Reporting Council, as cited in Bloomberg Tax, 2025; CK Search Global, 2024)"));
});

test("extracts percentages, decimals and monetary values without double counting citation years", () => {
  const text = "Revenue grew 12.5% to $4.2 million, compared with (Smith, 2020)'s baseline of 214 firms.";
  const spans = extractProtectedSpans(text);
  assert.ok(spans.numbers.some((n) => n.includes("12.5")));
  assert.ok(spans.numbers.includes("214"));
  assert.ok(spans.monetary.some((m) => m.includes("4.2")));
  assert.equal(spans.numbers.includes("2020"), false, "citation year must not leak into bare numbers");
});

test("extracts naira and currency-code monetary spans", () => {
  const text = "Audit fees increased from ₦17.34 billion to ₦28.2 billion while USD 226.6 billion was reported globally.";
  const spans = extractProtectedSpans(text);
  assert.ok(spans.monetary.includes("₦17.34 billion"));
  assert.ok(spans.monetary.includes("₦28.2 billion"));
  assert.ok(spans.monetary.includes("USD 226.6 billion"));
});

test("extracts statistical notation", () => {
  const text = "The model was significant, R² = 0.61, p = 0.03, with β = 0.42.";
  const spans = extractProtectedSpans(text);
  assert.ok(spans.statNotation.some((s) => s.replace(/\s/g, "").includes("R²=0.61")));
  assert.ok(spans.statNotation.some((s) => s.includes("0.42")));
});

test("extracts quoted material", () => {
  const text = 'The report described the finding as "a material weakness in internal controls".';
  const spans = extractProtectedSpans(text);
  assert.ok(spans.quotes.includes("a material weakness in internal controls"));
});

test("extracts acronyms as technical terms", () => {
  const text = "The FASB and IASB standards diverge on ROA and ROE treatment.";
  const spans = extractProtectedSpans(text);
  for (const acr of ["FASB", "IASB", "ROA", "ROE"]) {
    assert.ok(spans.acronyms.includes(acr), `expected ${acr} to be detected`);
  }
});
