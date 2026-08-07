import { test } from "node:test";
import assert from "node:assert/strict";
import { compileMeasuredLanguageFamily, assessLanguageDeviation } from "../server/lib/languageFamilyEngine.js";
import { measureLanguageFingerprint } from "../server/lib/languageFingerprint.js";

test("broad measured language family is built from real pilot documents", () => {
  const family = compileMeasuredLanguageFamily({});
  assert.equal(family.measured_document_count, 10);
  assert.equal(family.fallback_applied, false);
  assert.ok(family.metrics.sentence_mean.median > 0);
  assert.ok(family.metrics.sentence_initial_diversity.q25 > 0);
  assert.ok(family.metrics.transition_per_100_sent.q75 > family.metrics.transition_per_100_sent.q25);
});

test("supported UK PhD Accounting cell resolves to measured documents without inventing a narrow profile", () => {
  const family = compileMeasuredLanguageFamily({ document_type: "thesis", region: "UK", degree: "PhD", discipline: "Accounting" });
  assert.ok(family.measured_document_count >= 3);
  assert.equal(family.effective.region, "UK");
  assert.equal(family.effective.discipline, "Accounting");
});

test("sparse measured language cells back off hierarchically", () => {
  const family = compileMeasuredLanguageFamily({ document_type: "thesis", region: "Australasia", degree: "PhD", discipline: "Accounting", research_mode: "quantitative_archival" });
  assert.equal(family.fallback_applied, true);
  assert.ok(family.measured_document_count >= 3);
  assert.ok(family.dropped.length > 0);
});

test("family deviation diagnostics flag mechanically uniform and repetitive prose", () => {
  const family = compileMeasuredLanguageFamily({ document_type: "thesis" });
  const text = Array.from({ length: 12 }, (_, i) => `The study indicates that audit quality improves market confidence in case ${i + 1}.`).join(" ");
  const fingerprint = measureLanguageFingerprint(text);
  const deviation = assessLanguageDeviation(fingerprint, family);

  assert.equal(deviation.available, true);
  assert.ok(deviation.signals.some((s) => s.metric === "sentence_sd" || s.metric === "sentence_initial_diversity" || s.metric === "repeated_content_4gram_per_1k"));
  assert.ok(deviation.family_alignment_score < 1);
});
