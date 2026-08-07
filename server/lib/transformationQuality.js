import { splitSentences } from "./sentences.js";

function normalise(text) {
  return text.toLowerCase().match(/[a-z0-9']+/g) || [];
}

function ngrams(tokens, n) {
  const out = new Set();
  for (let i = 0; i <= tokens.length - n; i++) out.add(tokens.slice(i, i + n).join(" "));
  return out;
}

function overlapRatio(sourceSet, revisedSet) {
  if (sourceSet.size === 0) return 0;
  let matched = 0;
  for (const item of sourceSet) if (revisedSet.has(item)) matched += 1;
  return matched / sourceSet.size;
}

function normaliseSentence(sentence) {
  return normalise(sentence).join(" ");
}

function sentenceWordCounts(text) {
  return splitSentences(text).map((s) => normalise(s).length).filter((n) => n > 0);
}

function maxConsecutiveShort(lengths, ceiling = 9) {
  let max = 0;
  let run = 0;
  for (const n of lengths) {
    if (n <= ceiling) {
      run += 1;
      max = Math.max(max, run);
    } else run = 0;
  }
  return max;
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

const DIRECT_ADDRESS = /\b(?:you|your|yours|yourself|yourselves)\b/gi;
const FORMALITY_RISK = /\b(?:don't|doesn't|didn't|can't|won't|isn't|aren't|wasn't|weren't|it's|that's|there's|you're|we're|they're|ticking\s+(?:the\s+)?boxes|locked\s+up|tiny\s+fraction|same\s+thing|goes?\s+hand\s+in\s+hand|when\s+you\s+look|old\s+yardstick)\b/gi;

export function assessTransformationQuality(sourceText, revisedText, naturalisation = "faithful", options = {}) {
  const sourceTokens = normalise(sourceText);
  const revisedTokens = normalise(revisedText);
  const source5 = ngrams(sourceTokens, 5);
  const revised5 = ngrams(revisedTokens, 5);
  const fiveGramOverlap = overlapRatio(source5, revised5);

  const revisedSentenceSet = new Set(splitSentences(revisedText).map(normaliseSentence).filter(Boolean));
  const sourceSentences = splitSentences(sourceText).map(normaliseSentence).filter(Boolean);
  const unchangedSentenceCount = sourceSentences.filter((s) => revisedSentenceSet.has(s)).length;
  const unchangedSentenceRatio = sourceSentences.length ? unchangedSentenceCount / sourceSentences.length : 0;

  const revisedLengths = sentenceWordCounts(revisedText);
  const shortSentenceCount = revisedLengths.filter((n) => n <= 9).length;
  const shortSentenceRatio = revisedLengths.length ? shortSentenceCount / revisedLengths.length : 0;
  const meanSentenceLength = revisedLengths.length ? revisedLengths.reduce((a, b) => a + b, 0) / revisedLengths.length : 0;
  const consecutiveShortMax = maxConsecutiveShort(revisedLengths);

  const directAddressIntroduced = Math.max(0, countMatches(revisedText, DIRECT_ADDRESS) - countMatches(sourceText, DIRECT_ADDRESS));
  const formalityRisksIntroduced = Math.max(0, countMatches(revisedText, FORMALITY_RISK) - countMatches(sourceText, FORMALITY_RISK));

  const lengthRatio = sourceTokens.length ? revisedTokens.length / sourceTokens.length : 1;
  const level = (naturalisation || "faithful").toLowerCase();
  const longEnoughForGate = sourceTokens.length >= 60;
  const humanCadence = options.humanCadence || null;

  let passed = true;
  const reasons = [];

  if (level === "aggressive" && longEnoughForGate) {
    if (fiveGramOverlap > 0.62) {
      passed = false;
      reasons.push(`5-word phrase overlap is ${(fiveGramOverlap * 100).toFixed(1)}%, above the aggressive-mode ceiling of 62%.`);
    }
    if (unchangedSentenceRatio > 0.30) {
      passed = false;
      reasons.push(`${(unchangedSentenceRatio * 100).toFixed(1)}% of source sentences remain verbatim, above the aggressive-mode ceiling of 30%.`);
    }
    if (shortSentenceRatio > 0.24) {
      passed = false;
      reasons.push(`${(shortSentenceRatio * 100).toFixed(1)}% of revised sentences are 9 words or fewer; the prose has become too choppy.`);
    }
    if (consecutiveShortMax >= 4) {
      passed = false;
      reasons.push(`The revision contains a run of ${consecutiveShortMax} very short sentences, indicating over-segmentation rather than natural academic cadence.`);
    }
    if (directAddressIntroduced > 0) {
      passed = false;
      reasons.push(`The revision introduced ${directAddressIntroduced} second-person reference(s) not present in the source.`);
    }
    if (formalityRisksIntroduced > 0) {
      passed = false;
      reasons.push(`The revision introduced ${formalityRisksIntroduced} conversational expression(s) not present in the source.`);
    }
    if (humanCadence?.measuredSources >= 3 && Number.isFinite(humanCadence.meanSentenceLengthMin)) {
      const cadenceFloor = Math.max(14, humanCadence.meanSentenceLengthMin * 0.78);
      if (meanSentenceLength < cadenceFloor) {
        passed = false;
        reasons.push(`Mean sentence length is ${meanSentenceLength.toFixed(1)} words, below the academic-family quality floor of ${cadenceFloor.toFixed(1)}.`);
      }
    }
  }

  return {
    level,
    passed,
    source_words: sourceTokens.length,
    revised_words: revisedTokens.length,
    length_ratio: Number(lengthRatio.toFixed(3)),
    five_gram_overlap: Number(fiveGramOverlap.toFixed(3)),
    unchanged_sentence_ratio: Number(unchangedSentenceRatio.toFixed(3)),
    unchanged_sentence_count: unchangedSentenceCount,
    source_sentence_count: sourceSentences.length,
    revised_sentence_count: revisedLengths.length,
    mean_sentence_length: Number(meanSentenceLength.toFixed(2)),
    short_sentence_ratio: Number(shortSentenceRatio.toFixed(3)),
    max_consecutive_short_sentences: consecutiveShortMax,
    direct_address_introduced: directAddressIntroduced,
    formality_risks_introduced: formalityRisksIntroduced,
    reasons,
    note: "This is a rewrite-depth and academic-register quality audit, not an AI-authorship or detector score.",
  };
}
