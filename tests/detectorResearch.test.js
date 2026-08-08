import { test } from "node:test";
import assert from "node:assert/strict";
import { linguisticProfile, positionalProfiles, buildDetectorResearchReport } from "../server/lib/detectorResearch.js";
import { normalizeCopyleaksResponse } from "../server/lib/detectorProviders/copyleaks.js";

const source = `Corporate debt is a central source of financing for U.S. businesses, but creditors price it using more than accounting ratios. They also assess the reliability of financial reporting, the quality of oversight, the concentration of managerial authority, and the board's capacity to monitor risk.

The scale of the U.S. corporate debt market makes small differences in borrowing cost economically important. Federal Reserve data indicate that nonfinancial corporate debt securities and loans totaled approximately $13.68 trillion in 2024.`;

const candidate = `Business debt is a major source of funding for businesses in the United States, but creditors do not just use accounting ratios to price that debt. They evaluate reporting integrity and board oversight. The financing decision therefore depends on more than one accounting measure.

Small differences in corporate borrowing costs matter because the U.S. corporate debt market is large. Federal Reserve data place nonfinancial corporate debt securities and loans at approximately $13.68 trillion in 2024.`;

test("linguistic profile measures cadence, lexical and discourse features without producing an authorship verdict", () => {
  const profile = linguisticProfile(source);
  assert.ok(profile.word_count > 30);
  assert.ok(profile.sentence_count >= 3);
  assert.ok(Number.isFinite(profile.sentence_length_cv));
  assert.ok(Number.isFinite(profile.transition_density_per_100_words));
  assert.ok(Number.isFinite(profile.lexical_type_token_ratio));
  assert.equal("ai_probability" in profile, false);
});

test("positional profiles expose the opening two paragraphs separately from the whole document", () => {
  const profiles = positionalProfiles(`${source}\n\nA third paragraph adds another evidential statement. It remains deliberately brief.`);
  assert.ok(profiles.opening_two_paragraphs.word_count > 0);
  assert.ok(profiles.whole_document.word_count > profiles.opening_two_paragraphs.word_count);
});

test("detector research report preserves cross-detector disagreement rather than collapsing it", () => {
  const report = buildDetectorResearchReport({
    sourceText: source,
    candidateText: candidate,
    observations: [
      { detector: "GPTZero", version: "4.8b", classification: "ai", aiScore: 100 },
      { detector: "Stealthwriter", version: "V1", classification: "human", humanScore: 100 },
    ],
  });
  assert.equal(report.version, "detector-research-v1");
  assert.equal(report.detector_consensus.detector_count, 2);
  assert.equal(report.detector_consensus.disagreement, true);
  assert.ok(report.research_hypotheses.some((item) => /disagree/i.test(item)));
});

test("manual detector scores are bounded and sentence indices are sanitized", () => {
  const report = buildDetectorResearchReport({
    candidateText: candidate,
    observations: [{ detector: "Other", classification: "ai", aiScore: 140, humanScore: -10, flaggedSentenceIndices: [0, 2, -1, 1.5, "4"] }],
  });
  const observation = report.detector_consensus.observations[0];
  assert.equal(observation.ai_score, 100);
  assert.equal(observation.human_score, 0);
  assert.deepEqual(observation.flagged_sentence_indices, [0, 2, 4]);
});

test("Copyleaks normalizer retains model version, section probabilities and explainable spans", () => {
  const normalized = normalizeCopyleaksResponse({
    modelVersion: "v9.0",
    summary: { human: 0.2, ai: 0.8 },
    results: [{ classification: 2, probability: 0.91, matches: [{ text: { chars: { starts: [10], lengths: [25] } } }] }],
    explain: { patterns: { statistics: { aiCount: [3], humanCount: [1] }, text: { chars: { starts: [12], lengths: [8] } } } },
  });
  assert.equal(normalized.modelVersion, "v9.0");
  assert.equal(normalized.summary.ai, 0.8);
  assert.equal(normalized.sections[0].classification, "ai");
  assert.deepEqual(normalized.sections[0].matches, [{ start: 10, length: 25 }]);
  assert.deepEqual(normalized.explain.spans, [{ start: 12, length: 8 }]);
});
