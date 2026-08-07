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

function flattenProtectedSpans(spans) {
  if (!spans || typeof spans !== "object") return [];
  return [
    ...(spans.citations || []),
    ...(spans.numbers || []),
    ...(spans.monetary || []),
    ...(spans.statNotation || []),
    ...(spans.quotes || []),
    ...(spans.acronyms || []),
  ]
    .filter((v) => typeof v === "string" && v.trim())
    .sort((a, b) => b.length - a.length);
}

// Rewrite-depth overlap should measure the prose the engine was free to
// rewrite, not citations/numbers/quotes/acronyms that the preservation
// contract explicitly requires it to keep verbatim. Removing those spans
// before n-gram comparison prevents citation-heavy academic passages from
// being unfairly rejected simply for obeying preservation rules.
function removeProtectedMaterial(text, protectedSpans) {
  let out = String(text || "");
  for (const span of flattenProtectedSpans(protectedSpans)) {
    out = out.split(span).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

const DIRECT_ADDRESS = /\b(?:you|your|yours|yourself|yourselves)\b/gi;
const FORMALITY_RISK = /\b(?:don't|doesn't|didn't|can't|won't|isn't|aren't|wasn't|weren't|it's|that's|there's|you're|we're|they're|ticking\s+(?:the\s+)?boxes|locked\s+up|tiny\s+fraction|same\s+thing|goes?\s+hand\s+in\s+hand|when\s+you\s+look|old\s+yardstick)\b/gi;

export function assessTransformationQuality(sourceText, revisedText, naturalisation = "faithful", options = {}) {
  const sourceTokens = normalise(sourceText);
  const revisedTokens = normalise(revisedText);

  const rawSource5 = ngrams(sourceTokens, 5);
  const rawRevised5 = ngrams(revisedTokens, 5);
  const rawFiveGramOverlap = overlapRatio(rawSource5, rawRevised5);

  const protectedSpans = options.protectedSpans || null;
  const overlapSourceText = removeProtectedMaterial(sourceText, protectedSpans);
  const overlapRevisedText = removeProtectedMaterial(revisedText, protectedSpans);
  const overlapSourceTokens = normalise(overlapSourceText);
  const overlapRevisedTokens = normalise(overlapRevisedText);
  const source5 = ngrams(overlapSourceTokens, 5);
  const revised5 = ngrams(overlapRevisedTokens, 5);
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
  const cadenceFloor =
    humanCadence?.measuredSources >= 3 && Number.isFinite(humanCadence.meanSentenceLengthMin)
      ? Math.max(14, humanCadence.meanSentenceLengthMin * 0.78)
      : 14;

  let passed = true;
  const reasons = [];

  if (level === "aggressive" && longEnoughForGate) {
    if (fiveGramOverlap > 0.62) {
      passed = false;
      reasons.push(`Protected-span-adjusted 5-word phrase overlap is ${(fiveGramOverlap * 100).toFixed(1)}%, above the aggressive-mode ceiling of 62%.`);
    }
    if (unchangedSentenceRatio > 0.30) {
      passed = false;
      reasons.push(`${(unchangedSentenceRatio * 100).toFixed(1)}% of source sentences remain verbatim, above the aggressive-mode ceiling of 30%.`);
    }

    // A fixed 24% short-sentence cutoff proved too brittle on real thesis
    // prose (24.2% was rejected despite otherwise reasonable variation).
    // Reject genuinely dominant short-sentence texture, or a moderately high
    // share only when the overall mean has also fallen below the academic
    // cadence floor. Long runs remain a hard over-segmentation signal.
    const shortDominant = shortSentenceRatio > 0.32;
    const shortAndThin = shortSentenceRatio > 0.27 && meanSentenceLength < cadenceFloor;
    if (shortDominant || shortAndThin) {
      passed = false;
      reasons.push(`${(shortSentenceRatio * 100).toFixed(1)}% of revised sentences are 9 words or fewer and the passage cadence is too fragmented.`);
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
    if (meanSentenceLength < cadenceFloor) {
      passed = false;
      reasons.push(`Mean sentence length is ${meanSentenceLength.toFixed(1)} words, below the academic-family quality floor of ${cadenceFloor.toFixed(1)}.`);
    }
  }

  const protectedTokenShare = sourceTokens.length
    ? Math.max(0, 1 - overlapSourceTokens.length / sourceTokens.length)
    : 0;

  return {
    level,
    passed,
    source_words: sourceTokens.length,
    revised_words: revisedTokens.length,
    length_ratio: Number(lengthRatio.toFixed(3)),
    five_gram_overlap: Number(fiveGramOverlap.toFixed(3)),
    raw_five_gram_overlap: Number(rawFiveGramOverlap.toFixed(3)),
    protected_token_share: Number(protectedTokenShare.toFixed(3)),
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
    note: "This is a protected-span-adjusted rewrite-depth and academic-register quality audit, not an AI-authorship or detector score.",
  };
}
