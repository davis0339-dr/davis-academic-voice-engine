import { manuscriptWordCount } from "./lengthContract.js";
import { measureLanguageFingerprint } from "./languageFingerprint.js";

export const AUTHORIAL_ANCHOR_MIN_WORDS = 120;
export const AUTHORIAL_ANCHOR_MAX_WORDS = 700;

export function normaliseAuthorialAnchor(value) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

export function assessAuthorialAnchor(value) {
  const text = normaliseAuthorialAnchor(value);
  const wordCount = manuscriptWordCount(text);
  const supplied = Boolean(text);
  const sufficient = supplied && wordCount >= AUTHORIAL_ANCHOR_MIN_WORDS && wordCount <= AUTHORIAL_ANCHOR_MAX_WORDS;
  return {
    supplied,
    sufficient,
    word_count: wordCount,
    minimum_words: AUTHORIAL_ANCHOR_MIN_WORDS,
    maximum_words: AUTHORIAL_ANCHOR_MAX_WORDS,
    reason: !supplied
      ? "not_supplied"
      : wordCount < AUTHORIAL_ANCHOR_MIN_WORDS
        ? "sample_too_short"
        : wordCount > AUTHORIAL_ANCHOR_MAX_WORDS
          ? "sample_too_long"
          : null,
  };
}

function compactFingerprint(text) {
  const profile = measureLanguageFingerprint(text);
  return {
    word_count: profile.word_count,
    sentence_count: profile.sentence_count,
    mean_sentence_words: profile.sentence_mean,
    sentence_length_sd: profile.sentence_sd,
    sentence_length_cv: profile.sentence_mean ? Number((profile.sentence_sd / profile.sentence_mean).toFixed(3)) : 0,
    short_sentence_share: Number((profile.pct_short_le12 / 100).toFixed(3)),
    long_sentence_share: Number((profile.pct_long_ge30 / 100).toFixed(3)),
    sentence_initial_diversity: profile.sentence_initial_diversity,
    transitions_per_100_sentences: profile.transition_per_100_sent,
    subordinators_per_100_sentences: profile.subordinator_per_100_sent,
    lexical_mattr50: profile.mattr50,
  };
}

export function authorialAnchorPromptBlock(value) {
  const text = normaliseAuthorialAnchor(value);
  const assessment = assessAuthorialAnchor(text);
  if (!assessment.sufficient) return "";
  return [
    "",
    "--- RESEARCHER-AUTHORED CALIBRATION SAMPLE ---",
    "The sample below was supplied as writing genuinely authored by the researcher. It is calibration evidence for expression only; it is not evidence for the manuscript's subject matter.",
    "NON-TRANSFER RULE: never copy, paraphrase or import a fact, claim, example, citation, quotation, proper noun or topic-specific phrase from this sample into the revision.",
    "CALIBRATE WHAT THE RESEARCHER ACTUALLY CONTROLS: reasoning order, how much explanation is made explicit, clause loading, sentence-boundary choices, recurring terminology, qualification habits, and whether a passage closes explicitly or carries a point forward.",
    "MINIMAL-AUTHORIAL-CORRECTION RULE: preserve the tested candidate's valid research content, but do not replace the researcher's observable reasoning habits with newly invented framing, balanced contrasts, tidy three-part packaging, or a polished concluding sentence. Correct clear grammar without optimising every acceptable sentence.",
    "Do not imitate mistakes, dated conventions, accidental repetition or extraction artefacts. Correctness and semantic fidelity remain mandatory. The aim is recognisable authorial control, not artificial roughness and not an external-detector score.",
    `Measured calibration profile: ${JSON.stringify(compactFingerprint(text))}`,
    "BEGIN RESEARCHER SAMPLE",
    text,
    "END RESEARCHER SAMPLE",
    "--- END RESEARCHER-AUTHORED CALIBRATION SAMPLE ---",
  ].join("\n");
}
