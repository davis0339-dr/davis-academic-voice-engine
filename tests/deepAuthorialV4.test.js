import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";
import { extractProtectedSpans } from "../server/lib/protect.js";
import { auditPreservation } from "../server/lib/preservation.js";

const source = [
  "Corporate debt is a central source of financing for U.S. businesses, but creditors price it using more than accounting ratios.",
  "The proposed study examines board governance and cost of debt among S&P 1500 manufacturing firms during 2015-2024.",
  "Approximately 10-15 corporate finance executives and lending professionals will be interviewed in the qualitative strand.",
].join("\n\n");

test("Deep Authorial v4 plans proposition-led reconstruction rather than sentence-aligned paraphrase", () => {
  const plan = buildDiagnosisScopedPlan(diagnose(source), {
    rewriteIntensity: "deep",
    naturalisation: "authorial",
    lengthPreference: "auto",
  });

  assert.equal(plan.authorialAuthorityActive, true);
  assert.equal(plan.scopePolicyVersion, "diagnosis-guided-authority-v3");
  assert.equal(plan.authorialProtocolVersion, "proposition-led-authorial-reconstruction-v4");
  assert.ok(plan.documentGuidance.some((rule) => /not a sentence-by-sentence paraphrase pass/i.test(rule)));
  assert.ok(plan.documentGuidance.some((rule) => /one-source-sentence -> one-revised-sentence/i.test(rule)));
  assert.ok(plan.documentGuidance.some((rule) => /vary rhetorical trajectory by function/i.test(rule)));
  assert.ok(plan.documentGuidance.some((rule) => /numeric relationships are atomic/i.test(rule)));
});

test("numeric ranges are protected as factual relationships", () => {
  const spans = extractProtectedSpans(source);
  assert.ok(spans.ranges.includes("2015-2024"));
  assert.ok(spans.ranges.includes("10-15"));

  const corrupted = source
    .replace("2015-2024", "2015, 2024")
    .replace("10-15", "10, 15");
  const audit = auditPreservation(source, corrupted, spans);
  assert.equal(audit.numbers_ok, false);
  assert.ok(audit.warnings.some((warning) => /range|numeric/i.test(`${warning.type} ${warning.detail}`)));
});
