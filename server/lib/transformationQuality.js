import { splitSentences } from "./sentences.js";

function normalise(text) {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []);
}

function ngrams(tokens, n) {
  const out = new Set();
  for (let i = 0; i <= tokens.length - n; i++) {
    out.add(tokens.slice(i, i + n).join(" "));
  }
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

export function assessTransformationQuality(sourceText, revisedText, naturalisation = "faithful") {
  const sourceTokens = normalise(sourceText);
  const revisedTokens = normalise(revisedText);
  const source5 = ngrams(sourceTokens, 5);
  const revised5 = ngrams(revisedTokens, 5);
  const fiveGramOverlap = overlapRatio(source5, revised5);

  const revisedSentenceSet = new Set(splitSentences(revisedText).map(normaliseSentence).filter(Boolean));
  const sourceSentences = splitSentences(sourceText).map(normaliseSentence).filter(Boolean);
  const unchangedSentenceCount = sourceSentences.filter((s) => revisedSentenceSet.has(s)).length;
  const unchangedSentenceRatio = sourceSentences.length ? unchangedSentenceCount / sourceSentences.length : 0;

  const lengthRatio = sourceTokens.length ? revisedTokens.length / sourceTokens.length : 1;
  const level = (naturalisation || "faithful").toLowerCase();
  // Below ~60 words these ratios become too unstable to use as a hard gate.
  // Above it, aggressive mode should not be allowed to return near-verbatim
  // prose while claiming a substantive rewrite.
  const longEnoughForGate = sourceTokens.length >= 60;

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
    reasons,
    note: "This is a rewrite-depth quality audit, not an AI-authorship or detector score.",
  };
}
