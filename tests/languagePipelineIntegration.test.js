import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse } from "../server/lib/pipeline.js";

test("analysis injects corpus-derived language guidance into the rewrite profile", () => {
  const sourceText = `The study indicates that audit quality is important for market confidence. The study indicates that audit quality is important for investors. The study indicates that audit quality is important for creditors. The study indicates that audit quality is important for regulators. The study indicates that audit quality is important for shareholders. The study indicates that audit quality is important for governance. The study indicates that audit quality is important for reporting. The study indicates that audit quality is important for assurance.`;

  const result = analyse({
    sourceText,
    styleFilters: { document_type: "thesis", region: "UK", degree: "PhD", discipline: "Accounting" },
    rewriteIntensity: "substantial",
    grammarIntensity: "standard",
    lengthPreference: "same",
    naturalisation: "aggressive",
  });

  assert.ok(result.diagnostics.language_fingerprint);
  assert.ok(result.diagnostics.measured_language_deviation.available);
  assert.ok(result.measured_language_family.measured_document_count >= 3);
  const guidance = result.style_profile_used.effective.features.source_specific_measured_guidance;
  assert.ok(guidance);
  assert.ok(Array.isArray(guidance.recommendations));
  assert.ok(guidance.high_priority_signals.length > 0);
});

test("measured corpus guidance remains advisory rather than changing protected facts", () => {
  const sourceText = `Audit fees increased to USD 212 billion in 2024 (IFAC, 2024). The evidence may vary across settings, but the reported value must remain unchanged.`;
  const result = analyse({
    sourceText,
    styleFilters: { document_type: "thesis" },
    rewriteIntensity: "substantial",
    grammarIntensity: "standard",
    lengthPreference: "same",
    naturalisation: "aggressive",
  });

  assert.ok(result.protectedSpans.citations.includes("(IFAC, 2024)"));
  assert.ok(result.protectedSpans.monetary.some((v) => v.includes("USD 212")) || result.protectedSpans.numbers.includes("212"));
  assert.ok(result.style_profile_used.effective.features.source_specific_measured_guidance.preserve_not_targeted.length > 0);
});
