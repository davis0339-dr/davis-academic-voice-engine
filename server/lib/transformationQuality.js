import { splitSentences } from "./sentences.js";
import { findRhetoricalScaffolding } from "./rhetoricalDiagnostics.js";

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

function maxConsecutiveTrue(flags) {
  let max = 0;
  let run = 0;
  for (const flag of flags) {
    if (flag) {
      run += 1;
      max = Math.max(max, run);
    } else {
      run = 0;
    }
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

function removeProtectedMaterial(text, protectedSpans) {
  let out = String(text || "");
  for (const span of flattenProtectedSpans(protectedSpans)) {
    out = out.split(span).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

const CONTENT_STOPWORDS = new Set(
  "a an the and or but if then than so to of in on at by for from with as is are was were be been being it its this that these those who whom whose which where when while into within across over under through about between among both each any some such no not do does did have has had can could may might must shall should will would their there here also itself themselves himself herself own".split(" ")
);

function contentTokens(text, protectedSpans) {
  return normalise(removeProtectedMaterial(text, protectedSpans)).filter((token) => !CONTENT_STOPWORDS.has(token));
}

function lcsLength(a, b) {
  if (!a.length || !b.length) return 0;
  let previous = new Array(b.length + 1).fill(0);
  for (const left of a) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      current[j] = left === b[j - 1]
        ? previous[j - 1] + 1
        : Math.max(current[j - 1], previous[j]);
    }
    previous = current;
  }
  return previous[b.length];
}

function lexicalContainment(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.min(left.size, right.size);
}

function assessNearSourceSentences(sourceText, revisedText, protectedSpans) {
  const source = splitSentences(sourceText)
    .map((text) => ({ text, tokens: contentTokens(text, protectedSpans) }))
    .filter((item) => item.tokens.length >= 5);
  const revised = splitSentences(revisedText)
    .map((text) => ({ text, tokens: contentTokens(text, protectedSpans) }))
    .filter((item) => item.tokens.length >= 5);

  if (!revised.length || !source.length) {
    return { ratio: 0, count: 0, eligible: revised.length, worst: [], maxConsecutive: 0 };
  }

  const matched = [];
  const matchedFlags = [];
  for (const candidate of revised) {
    let best = null;
    for (const original of source) {
      const minLength = Math.min(candidate.tokens.length, original.tokens.length);
      if (minLength < 5) continue;
      const orderedContainment = lcsLength(candidate.tokens, original.tokens) / minLength;
      const lexical = lexicalContainment(candidate.tokens, original.tokens);
      const score = orderedContainment * 0.55 + lexical * 0.45;
      if (!best || score > best.score) {
        best = {
          score,
          orderedContainment,
          lexicalContainment: lexical,
          revised: candidate.text,
          source: original.text,
        };
      }
    }

    const isNearSource = Boolean(best && best.orderedContainment >= 0.72 && best.lexicalContainment >= 0.78);
    matchedFlags.push(isNearSource);
    if (isNearSource) matched.push(best);
  }

  matched.sort((a, b) => b.score - a.score);
  return {
    ratio: matched.length / revised.length,
    count: matched.length,
    eligible: revised.length,
    worst: matched.slice(0, 3),
    maxConsecutive: maxConsecutiveTrue(matchedFlags),
  };
}

function rhetoricalIssueSummary(text) {
  const issues = findRhetoricalScaffolding(splitSentences(text));
  return {
    issues,
    gapLabelScaffolding: issues.find((i) => i.issue === "gap_label_scaffolding") || null,
    proxyLabelScaffolding: issues.find((i) => i.issue === "proxy_label_scaffolding") || null,
    demonstrativeBridgeOveruse: issues.find((i) => i.issue === "demonstrative_bridge_overuse") || null,
    choppySentenceRun: issues.find((i) => i.issue === "choppy_sentence_run") || null,
  };
}

const BRIDGE_ONLY_RE = /^(?:narrowing\s+(?:the\s+)?(?:lens|focus)|turning\s+(?:the\s+)?(?:attention|focus)|moving\s+(?:the\s+)?(?:analysis|focus)|shifting\s+(?:the\s+)?(?:analysis|focus)|against\s+this\s+background|in\s+this\s+context|from\s+this\s+perspective|with\s+this\s+context)\b/i;

function orphanBridgeParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((paragraph, paragraphIndex) => ({ paragraph: paragraph.trim(), paragraphIndex }))
    .filter(({ paragraph }) => paragraph)
    .filter(({ paragraph }) => {
      const sentences = splitSentences(paragraph);
      if (sentences.length !== 1) return false;
      const wc = normalise(paragraph).length;
      if (wc < 8 || wc > 35) return false;
      if (/\d/.test(paragraph) || /\((?:[^()]*?(?:19|20)\d{2}[^()]*)\)/.test(paragraph)) return false;
      return BRIDGE_ONLY_RE.test(paragraph);
    });
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
  const nearSource = assessNearSourceSentences(sourceText, revisedText, protectedSpans);

  const revisedLengths = sentenceWordCounts(revisedText);
  const shortSentenceCount = revisedLengths.filter((n) => n <= 9).length;
  const shortSentenceRatio = revisedLengths.length ? shortSentenceCount / revisedLengths.length : 0;
  const meanSentenceLength = revisedLengths.length ? revisedLengths.reduce((a, b) => a + b, 0) / revisedLengths.length : 0;
  const consecutiveShortMax = maxConsecutiveShort(revisedLengths);

  const directAddressIntroduced = Math.max(0, countMatches(revisedText, DIRECT_ADDRESS) - countMatches(sourceText, DIRECT_ADDRESS));
  const formalityRisksIntroduced = Math.max(0, countMatches(revisedText, FORMALITY_RISK) - countMatches(sourceText, FORMALITY_RISK));
  const sourceRhetorical = rhetoricalIssueSummary(sourceText);
  const revisedRhetorical = rhetoricalIssueSummary(revisedText);
  const sourceOrphanBridges = orphanBridgeParagraphs(sourceText);
  const revisedOrphanBridges = orphanBridgeParagraphs(revisedText);
  const introducedOrphanBridges = Math.max(0, revisedOrphanBridges.length - sourceOrphanBridges.length);

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
    if (fiveGramOverlap > 0.56) {
      passed = false;
      reasons.push(`Protected-span-adjusted 5-word phrase overlap is ${(fiveGramOverlap * 100).toFixed(1)}%, above the aggressive-mode ceiling of 56%.`);
    }
    if (unchangedSentenceRatio > 0.22) {
      passed = false;
      reasons.push(`${(unchangedSentenceRatio * 100).toFixed(1)}% of source sentences remain verbatim, above the aggressive-mode ceiling of 22%.`);
    }
    if (nearSource.ratio > 0.38) {
      passed = false;
      reasons.push(`${(nearSource.ratio * 100).toFixed(1)}% of substantive revised sentences retain near-source content-word order/structure, above the aggressive-mode ceiling of 38%.`);
    }
    if (nearSource.maxConsecutive >= 4) {
      passed = false;
      reasons.push(`The revision contains a local run of ${nearSource.maxConsecutive} consecutive near-source sentences. Aggressive mode must distribute structural reconstruction across the passage rather than leaving one stretch substantially source-shaped.`);
    }

    if (sourceRhetorical.gapLabelScaffolding && revisedRhetorical.gapLabelScaffolding) {
      passed = false;
      reasons.push("The source's Conceptual/Theoretical/Methodological/Empirical/Contextual gap-label scaffold remains in the revision. Preserve the distinct gaps but integrate them into connected argumentation.");
    }
    if (sourceRhetorical.proxyLabelScaffolding && revisedRhetorical.proxyLabelScaffolding) {
      passed = false;
      reasons.push("The source's performance-proxy checklist remains visible in the revision. Preserve revenue growth, market share, audit quality and operational efficiency, but connect their evidence and consequences rather than presenting consecutive category-led sentences.");
    }
    if (sourceRhetorical.choppySentenceRun && revisedRhetorical.choppySentenceRun) {
      passed = false;
      reasons.push("A diagnosed consecutive micro-sentence run remains unresolved in the revision; merge or redistribute those propositions into argument-led academic cadence.");
    }
    if (introducedOrphanBridges > 0) {
      passed = false;
      reasons.push(`The revision introduced ${introducedOrphanBridges} standalone bridge-only paragraph(s). Transitional framing should normally remain attached to the evidence or reasoning it introduces rather than becoming a staged one-sentence paragraph.`);
    }

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
    near_source_sentence_ratio: Number(nearSource.ratio.toFixed(3)),
    near_source_sentence_count: nearSource.count,
    near_source_sentence_eligible: nearSource.eligible,
    max_consecutive_near_source_sentences: nearSource.maxConsecutive,
    near_source_examples: nearSource.worst.map((item) => ({
      score: Number(item.score.toFixed(3)),
      ordered_containment: Number(item.orderedContainment.toFixed(3)),
      lexical_containment: Number(item.lexicalContainment.toFixed(3)),
      revised: item.revised,
      source: item.source,
    })),
    revised_sentence_count: revisedLengths.length,
    mean_sentence_length: Number(meanSentenceLength.toFixed(2)),
    short_sentence_ratio: Number(shortSentenceRatio.toFixed(3)),
    max_consecutive_short_sentences: consecutiveShortMax,
    direct_address_introduced: directAddressIntroduced,
    formality_risks_introduced: formalityRisksIntroduced,
    introduced_orphan_bridge_paragraphs: introducedOrphanBridges,
    orphan_bridge_examples: revisedOrphanBridges.slice(0, 3).map((row) => row.paragraph),
    rhetorical_resolution: {
      source_gap_label_scaffolding: Boolean(sourceRhetorical.gapLabelScaffolding),
      revised_gap_label_scaffolding: Boolean(revisedRhetorical.gapLabelScaffolding),
      source_proxy_label_scaffolding: Boolean(sourceRhetorical.proxyLabelScaffolding),
      revised_proxy_label_scaffolding: Boolean(revisedRhetorical.proxyLabelScaffolding),
      source_demonstrative_bridge_overuse: Boolean(sourceRhetorical.demonstrativeBridgeOveruse),
      revised_demonstrative_bridge_overuse: Boolean(revisedRhetorical.demonstrativeBridgeOveruse),
      source_choppy_sentence_run: Boolean(sourceRhetorical.choppySentenceRun),
      revised_choppy_sentence_run: Boolean(revisedRhetorical.choppySentenceRun),
    },
    reasons,
    note: "This is a protected-span-adjusted rewrite-depth, local-transformation-coverage, rhetorical-resolution, paragraph-function and academic-register quality audit, not an AI-authorship or detector score.",
  };
}
