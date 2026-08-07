// Phase 4 seed (Section 15/21): the first real, evidence-grounded
// writing-quality diagnostic that goes beyond keyword matching.
//
// Origin: on 2026-08-07 the product owner supplied one document described
// as AI-generated and one described as human-written (both academic
// introductions/chapters, saved as tests/fixtures/detector-benchmark/).
// The existing keyword-based diagnostics (generic phrasing, transition
// stacking) found NOTHING in either -- zero hits on both. What did show a
// sharp difference was sentence-length distribution: the AI sample ran to
// 41.7 words/sentence with 54% of sentences at 40+ words, while the human
// sample ran 24.5 words/sentence with 11.9% at 40+ words, and comfortably
// inside the range already measured across the 45-document historical
// corpus (whose most extreme single document, Chapman 2016, tops out at
// 32.1 words/sentence mean).
//
// IMPORTANT HONESTY BOUNDARY: this is ONE labeled pair, not a calibrated
// benchmark. Section 21.2 specifies what a real evaluation set needs
// (historical human corpus, recent authenticated human writing, multiple
// LLM outputs, human-edited AI text, polished human writing, second-
// language writers, short and long texts, multiple disciplines) -- this
// module does not have that yet. It therefore:
//   - compares against the ACTUAL measured range of the resolved corpus
//     family (real per-document numbers, not a guessed constant);
//   - refuses to flag anything when the family has fewer than 3 measured
//     sources (MIN_FAMILY_SAMPLE below) rather than compare against noise;
//   - is presented as a descriptive "outside the observed range" flag,
//     never a score, and never a claim about authorship (Section 9.1:
//     "long sentences are not automatically AI").
// Expanding the corpus (more real documents in corpusDocuments.js) makes
// this diagnostic more defensible over time; it does not need recalibration
// the way a trained/threshold-fit score would.

import { splitSentences, wordCount } from "./sentences.js";
import { compileFamily } from "./corpusEngine.js";

const MIN_FAMILY_SAMPLE = 3;
const LONG_SENTENCE_WORDS = 30; // matches the corpus note's own >=30-word measurement convention
const MEAN_MARGIN = 1.15; // 15% beyond the most extreme observed family mean before flagging
const PCT_LONG_MARGIN = 10; // percentage points beyond the most extreme observed family pctLong

function computeDocCadence(text) {
  const sentences = splitSentences(text);
  const lengths = sentences.map(wordCount);
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const longCount = lengths.filter((n) => n >= LONG_SENTENCE_WORDS).length;
  const pctLong = lengths.length ? (100 * longCount) / lengths.length : 0;
  return { sentenceCount: sentences.length, mean, pctLong };
}

export function assessCadenceDeviation(text, styleFilters) {
  const doc = computeDocCadence(text);
  const family = compileFamily(styleFilters || {});
  const cadence = family.cadence;

  if (cadence.measuredSources < MIN_FAMILY_SAMPLE) {
    return {
      available: false,
      reason: `Resolved family (${family.effectiveLabel}) has only ${cadence.measuredSources} measured source(s) -- below the ${MIN_FAMILY_SAMPLE}-source minimum this build requires before comparing against it.`,
      doc,
      family: cadence,
    };
  }

  const flags = [];
  if (doc.mean > cadence.meanSentenceLengthMax * MEAN_MARGIN) {
    flags.push({
      type: "mean_sentence_length_exceeds_observed_range",
      detail: `Document mean sentence length (${doc.mean.toFixed(1)} words) exceeds the most extreme mean observed across ${cadence.measuredSources} measured sources in this family (${cadence.meanSentenceLengthMax.toFixed(1)} words) by more than ${Math.round((MEAN_MARGIN - 1) * 100)}%.`,
    });
  }
  if (cadence.pctLongMax !== null && doc.pctLong > cadence.pctLongMax + PCT_LONG_MARGIN) {
    flags.push({
      type: "long_sentence_proportion_exceeds_observed_range",
      detail: `${doc.pctLong.toFixed(1)}% of sentences are ${LONG_SENTENCE_WORDS}+ words, versus a maximum of ${cadence.pctLongMax.toFixed(1)}% observed across measured sources in this family.`,
    });
  }

  return {
    available: true,
    doc,
    family: cadence,
    flags,
    note:
      "Sentence-rhythm comparison against this document's resolved corpus family -- a writing-quality/style-fit observation, not evidence of who or what wrote the text. Long or uniform sentences occur in credible human academic writing too (Section 9.1); this only flags when a document sits outside the RANGE this build has actually measured, and says exactly which family and how many sources that range is based on.",
  };
}
