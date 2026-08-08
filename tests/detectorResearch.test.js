import { test } from "node:test";
import assert from "node:assert/strict";
import { linguisticProfile, positionalProfiles, buildDetectorResearchReport } from "../server/lib/detectorResearch.js";
import { detectorEvidenceSummary } from "../server/lib/detectorEvidenceBase.js";

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

test("manual external observations preserve cross-detector disagreement rather than collapsing it", () => {
  const report = buildDetectorResearchReport({
    sourceText: source,
    candidateText: candidate,
    observations: [
      { detector: "Independent detector A", version: "manual-test-a", classification: "ai", aiScore: 100 },
      { detector: "Independent detector B", version: "manual-test-b", classification: "human", humanScore: 100 },
    ],
  });
  assert.equal(report.version, "detector-research-v2");
  assert.equal(report.detector_consensus.detector_count, 2);
  assert.equal(report.detector_consensus.disagreement, true);
  assert.ok(report.research_hypotheses.some((item) => /disagree/i.test(item)));
});

test("manual detector scores are bounded and sentence indices are sanitized", () => {
  const report = buildDetectorResearchReport({
    candidateText: candidate,
    observations: [{ detector: "Manual external result", classification: "ai", aiScore: 140, humanScore: -10, flaggedSentenceIndices: [0, 2, -1, 1.5, "4"] }],
  });
  const observation = report.detector_consensus.observations[0];
  assert.equal(observation.ai_score, 100);
  assert.equal(observation.human_score, 0);
  assert.deepEqual(observation.flagged_sentence_indices, [0, 2, 4]);
  assert.equal(report.flagged_sentence_analysis.available, true);
  assert.equal(report.flagged_sentence_analysis.flagged_sentence_indices.length, 3);
});

test("opening detector highlights are measured separately from the remainder", () => {
  const text = `Opening sentence one is highly regular. Opening sentence two is also highly regular.\n\nOpening paragraph two continues the pattern. It closes in the same way.\n\nThe third paragraph is different. Evidence appears here. The argument then moves elsewhere.`;
  const report = buildDetectorResearchReport({
    candidateText: text,
    observations: [{ detector: "Manual external result", classification: "ai", flaggedSentenceIndices: [0, 1, 2] }],
  });
  assert.equal(report.flagged_sentence_analysis.available, true);
  assert.ok(report.flagged_sentence_analysis.opening_two_paragraphs.flagged_share > report.flagged_sentence_analysis.remainder.flagged_share);
  assert.ok(report.research_hypotheses.some((item) => /opening two paragraphs/i.test(item)));
});

test("detector research remains useful with no external observations at all", () => {
  const report = buildDetectorResearchReport({ sourceText: source, candidateText: candidate, observations: [] });
  assert.equal(report.detector_consensus.detector_count, 0);
  assert.equal(report.detector_consensus.disagreement, false);
  assert.ok(report.source_profiles.whole_document.word_count > 0);
  assert.ok(report.candidate_profiles.whole_document.word_count > 0);
  assert.equal("authorship_verdict" in report, false);
});

test("evidence registry separates implemented measurements from deeper planned NLP/statistical measures", () => {
  const evidence = detectorEvidenceSummary();
  assert.ok(evidence.version);
  assert.equal(evidence.sources.length, 3);
  assert.ok(evidence.sources.some((source) => source.doi === "10.1038/s41467-025-67145-1"));
  assert.ok(evidence.sources.some((source) => source.doi === "10.1007/s40979-026-00213-1"));
  assert.ok(evidence.sources.some((source) => source.doi === "10.1186/s40468-026-00433-9"));
  const syntaxFamily = evidence.feature_families.find((family) => family.id === "syntactic_structure");
  assert.ok(syntaxFamily.measures_now.length > 0);
  assert.ok(syntaxFamily.planned.some((item) => /dependency-distance/i.test(item)));
  assert.ok(evidence.classifier_families.some((family) => family.id === "hybrid_ensemble"));
});