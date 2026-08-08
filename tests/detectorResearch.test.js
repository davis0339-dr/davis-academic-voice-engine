import { test } from "node:test";
import assert from "node:assert/strict";
import { linguisticProfile, positionalProfiles, buildDetectorResearchReport } from "../server/lib/detectorResearch.js";
import { detectorEvidenceSummary } from "../server/lib/detectorEvidenceBase.js";

const source = `Corporate debt is a central source of financing for U.S. businesses, but creditors price it using more than accounting ratios. They also assess the reliability of financial reporting, the quality of oversight, the concentration of managerial authority, and the board's capacity to monitor risk. The creditor therefore evaluates both accounting outcomes and the institutional arrangements surrounding those outcomes. A board can affect the information environment through monitoring, audit oversight, and the allocation of managerial authority. These mechanisms do not guarantee lower financing costs, but they provide a plausible governance channel through which lenders assess risk.

The scale of the U.S. corporate debt market makes small differences in borrowing cost economically important. Federal Reserve data indicate that nonfinancial corporate debt securities and loans totaled approximately $13.68 trillion in 2024. Small pricing differences can therefore become material at firm level when debt balances are large. The practical issue is not merely whether governance exists, but whether particular board arrangements correspond with financing terms after firm characteristics and time conditions are considered. That question requires evidence that separates board mechanisms rather than treating governance as one undifferentiated construct.`;

const candidate = `Business debt is a major source of funding for businesses in the United States, but creditors do not just use accounting ratios to price that debt. They evaluate reporting integrity and board oversight. Financing decisions therefore depend on more than one accounting measure. Board arrangements may affect how lenders understand risk, information quality, and managerial authority. The relationship is nevertheless expected to differ across specific governance mechanisms.

Small differences in corporate borrowing costs matter because the U.S. corporate debt market is large. Federal Reserve data place nonfinancial corporate debt securities and loans at approximately $13.68 trillion in 2024. Pricing differences can become economically material when debt balances are substantial. The proposed analysis therefore treats governance mechanisms separately and controls for firm characteristics and year effects. This structure allows the study to examine whether particular board arrangements are associated with financing costs rather than assuming a uniform governance effect.`;

test("linguistic profile measures features and reports sample adequacy without producing an authorship verdict", () => {
  const profile = linguisticProfile(source);
  assert.ok(profile.word_count > 100);
  assert.ok(profile.sentence_count >= 8);
  assert.ok(Number.isFinite(profile.sentence_length_cv));
  assert.ok(profile.sample_adequacy);
  assert.equal("ai_probability" in profile, false);
});

test("positional profiles exclude headings and use the first two substantive prose paragraphs", () => {
  const text = `Section 1: Foundation of the Study\n\nIntroduction\n\n${source}\n\nA third paragraph adds another evidential statement. It remains deliberately brief.`;
  const profiles = positionalProfiles(text);
  assert.equal(profiles.segmentation.headings_excluded, true);
  assert.ok(profiles.opening_two_paragraphs.word_count > 100);
  assert.ok(profiles.opening_two_paragraphs.sentence_count >= 8);
  assert.ok(profiles.whole_document.word_count > profiles.opening_two_paragraphs.word_count);
});

test("tiny passages retain measurements but suppress unstable cadence interpretation", () => {
  const profile = linguisticProfile("Short heading-like fragment only.");
  assert.equal(profile.sample_adequacy.sentence_dispersion, "insufficient");
  assert.equal(profile.sample_adequacy.cadence_inference, "insufficient");
  assert.ok(profile.sample_adequacy.cautions.length > 0);
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
  assert.equal(report.version, "detector-research-v3");
  assert.equal(report.detector_consensus.detector_count, 2);
  assert.equal(report.detector_consensus.disagreement, true);
  assert.ok(report.research_hypotheses.some((item) => /disagree/i.test(item)));
});

test("manual detector scores are bounded and sentence indices are sanitized", () => {
  const report = buildDetectorResearchReport({ candidateText: candidate, observations: [{ detector: "Manual external result", classification: "ai", aiScore: 140, humanScore: -10, flaggedSentenceIndices: [0, 2, -1, 1.5, "4"] }] });
  const observation = report.detector_consensus.observations[0];
  assert.equal(observation.ai_score, 100);
  assert.equal(observation.human_score, 0);
  assert.deepEqual(observation.flagged_sentence_indices, [0, 2, 4]);
  assert.equal(report.flagged_sentence_analysis.available, true);
});

test("opening detector highlights are measured against the first two prose paragraphs", () => {
  const text = `Section 1\n\nIntroduction\n\nOpening sentence one is highly regular. Opening sentence two is also highly regular. Opening sentence three continues the pattern.\n\nOpening paragraph two continues the pattern. It closes in the same way. Another statement is included.\n\nThe third paragraph is different. Evidence appears here. The argument then moves elsewhere.`;
  const report = buildDetectorResearchReport({ candidateText: text, observations: [{ detector: "Manual external result", classification: "ai", flaggedSentenceIndices: [0, 1, 2, 3] }] });
  assert.equal(report.flagged_sentence_analysis.available, true);
  assert.ok(report.flagged_sentence_analysis.opening_two_paragraphs.flagged_share > report.flagged_sentence_analysis.remainder.flagged_share);
});

test("corpus-relative interpretation exposes reference distributions without turning them into targets", () => {
  const report = buildDetectorResearchReport({ sourceText: source, candidateText: candidate, observations: [], styleFilters: {} });
  assert.ok(report.corpus_reference);
  assert.ok(report.corpus_reference.matched_documents > 0);
  assert.ok(report.corpus_reference.metrics.sentence_length_cv.reference);
  assert.match(report.corpus_reference.note, /not.*high\/low|descriptive|must not/i);
});

test("research hypotheses no longer call sentence dispersion narrow from a raw fixed CV threshold", () => {
  const report = buildDetectorResearchReport({ sourceText: source, candidateText: candidate, observations: [] });
  assert.equal(report.research_hypotheses.some((item) => /relatively narrow/i.test(item)), false);
});

test("detector research remains useful with no external observations", () => {
  const report = buildDetectorResearchReport({ sourceText: source, candidateText: candidate, observations: [] });
  assert.equal(report.detector_consensus.detector_count, 0);
  assert.equal(report.detector_consensus.disagreement, false);
  assert.ok(report.source_profiles.whole_document.word_count > 0);
  assert.equal("authorship_verdict" in report, false);
});

test("evidence registry separates implemented measurements from deeper planned NLP/statistical measures", () => {
  const evidence = detectorEvidenceSummary();
  assert.ok(evidence.version);
  assert.equal(evidence.sources.length, 3);
  assert.ok(evidence.sources.some((source) => source.doi === "10.1038/s41467-025-67145-1"));
  const syntaxFamily = evidence.feature_families.find((family) => family.id === "syntactic_structure");
  assert.ok(syntaxFamily.measures_now.length > 0);
  assert.ok(evidence.classifier_families.some((family) => family.id === "hybrid_ensemble"));
});
