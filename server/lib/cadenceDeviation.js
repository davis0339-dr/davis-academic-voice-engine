// Phase 4 seed (Section 15/21): an evidence-grounded writing-quality
// diagnostic that compares sentence cadence with the actually measured corpus
// family. It is descriptive style evidence, never an authorship claim.

import { splitSentences, wordCount } from "./sentences.js";
import { compileFamily } from "./corpusEngine.js";

const MIN_FAMILY_SAMPLE = 3;
const LONG_SENTENCE_WORDS = 30;
const MEAN_MARGIN = 1.15;
const PCT_LONG_MARGIN = 10;

function computeDocCadence(text) {
  const sentences = splitSentences(text);
  const lengths = sentences.map(wordCount);
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const longCount = lengths.filter((n) => n >= LONG_SENTENCE_WORDS).length;
  const pctLong = lengths.length ? (100 * longCount) / lengths.length : 0;
  return { sentenceCount: sentences.length, mean, pctLong };
}

function observedRangePosition(doc, cadence) {
  if (!Number.isFinite(doc.mean) || !Number.isFinite(cadence.meanSentenceLengthMin) || !Number.isFinite(cadence.meanSentenceLengthMax)) {
    return "unavailable";
  }
  if (doc.mean < cadence.meanSentenceLengthMin) return "below_observed_range";
  if (doc.mean > cadence.meanSentenceLengthMax) return "above_observed_range";
  return "within_observed_range";
}

function rangeMessage(position, doc, cadence) {
  if (position === "below_observed_range") {
    return `Mean sentence length (${doc.mean.toFixed(1)} words) is below the raw observed family range of ${cadence.meanSentenceLengthMin.toFixed(1)}–${cadence.meanSentenceLengthMax.toFixed(1)} words.`;
  }
  if (position === "above_observed_range") {
    return `Mean sentence length (${doc.mean.toFixed(1)} words) is above the raw observed family range of ${cadence.meanSentenceLengthMin.toFixed(1)}–${cadence.meanSentenceLengthMax.toFixed(1)} words.`;
  }
  if (position === "within_observed_range") {
    return `Mean sentence length (${doc.mean.toFixed(1)} words) lies within the raw observed family range of ${cadence.meanSentenceLengthMin.toFixed(1)}–${cadence.meanSentenceLengthMax.toFixed(1)} words.`;
  }
  return "Raw observed-range position is unavailable.";
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
      range_position: "unavailable",
      range_message: "Raw observed-range position is unavailable because the resolved family is too small for comparison.",
    };
  }

  const rangePosition = observedRangePosition(doc, cadence);
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
    range_position: rangePosition,
    range_message: rangeMessage(rangePosition, doc, cadence),
    threshold_flagged: flags.length > 0,
    flags,
    note:
      "Raw observed-range position and deviation flags are deliberately separate. A document can sit slightly outside the measured family range without crossing the conservative deviation threshold. This is a writing-quality/style-fit observation, not evidence of who or what wrote the text.",
  };
}
