import { splitSentences, wordCount } from "./sentences.js";
import { parseTextStructure } from "./textStructure.js";
import { compileFamily } from "./corpusEngine.js";

const TRANSITION_RE = /\b(?:however|therefore|thus|moreover|furthermore|additionally|consequently|nevertheless|nonetheless|similarly|likewise|in contrast|by contrast|in addition|as a result|for example|for instance|overall|ultimately)\b/gi;
const HEDGE_RE = /\b(?:may|might|could|can|appears?|suggests?|indicates?|likely|possibly|perhaps|generally|approximately|about|seems?|tends?)\b/gi;
const ABSTRACT_NOUN_RE = /\b[A-Za-z]{5,}(?:tion|sion|ment|ance|ence|ity|isation|ization|ship|ness)\b/gi;
const CLAUSE_RE = /\b(?:because|although|though|whereas|while|if|when|which|that|who|whose|where|since|unless|despite|however|but|and|or)\b/gi;
const CITATION_RE = /(?:\([^)\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^)\n]*\)|\b[A-Z][A-Za-z'’-]+(?:\s+et al\.)?\s*\((?:18|19|20)\d{2}[a-z]?\))/g;
const FIRST_PERSON_RE = /\b(?:I|we|my|our|ours|us)\b/gi;
const PASSIVE_RE = /\b(?:is|are|was|were|be|been|being)\s+(?:[a-z]+ed|[a-z]+en)\b/gi;
const TECHNICAL_RE = /(?:\b[A-Z]{2,}\b|\b(?:regression|coefficient|hypothesis|construct|variable|panel|logit|logistic|OLS|GLS|ANOVA|SEM|IFRS|IAS|CEO|audit|governance|debt|credit|sample|estimator)\b)/gi;
const SENTENCE_OPEN_STOP = new Set(["the", "a", "an", "this", "that", "these", "those"]);

function words(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function ratio(n, d) {
  return d ? n / d : 0;
}

function countMatches(text, re) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return (String(text || "").match(new RegExp(re.source, flags)) || []).length;
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function sd(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length);
}

function correlationLag1(values) {
  if (values.length < 4) return 0;
  const a = values.slice(0, -1);
  const b = values.slice(1);
  const ma = mean(a);
  const mb = mean(b);
  const numerator = a.reduce((sum, value, i) => sum + (value - ma) * (b[i] - mb), 0);
  const da = Math.sqrt(a.reduce((sum, value) => sum + (value - ma) ** 2, 0));
  const db = Math.sqrt(b.reduce((sum, value) => sum + (value - mb) ** 2, 0));
  return da && db ? numerator / (da * db) : 0;
}

function sentenceOpening(sentence) {
  const tokens = words(sentence);
  if (!tokens.length) return "";
  let start = 0;
  while (start < tokens.length - 1 && SENTENCE_OPEN_STOP.has(tokens[start])) start += 1;
  return tokens.slice(start, start + 2).join(" ");
}

function punctuationProfile(text, wc) {
  const chars = String(text || "");
  const per100 = (count) => round(ratio(count * 100, wc), 3);
  return {
    comma_per_100_words: per100((chars.match(/,/g) || []).length),
    semicolon_per_100_words: per100((chars.match(/;/g) || []).length),
    colon_per_100_words: per100((chars.match(/:/g) || []).length),
    parenthesis_pair_per_100_words: per100((chars.match(/\(/g) || []).length),
    dash_per_100_words: per100((chars.match(/[—–]/g) || []).length),
    question_per_100_words: per100((chars.match(/\?/g) || []).length),
  };
}

function sampleAdequacy(wordCountValue, sentenceCount) {
  const cautions = [];
  const lexical = wordCountValue >= 50 ? "descriptive" : "insufficient";
  const dispersion = sentenceCount >= 5 ? "descriptive" : "insufficient";
  const cadence = sentenceCount >= 10 ? "interpret_with_caution" : "insufficient";
  const stronger = wordCountValue >= 150 && sentenceCount >= 10;
  if (lexical === "insufficient") cautions.push("Fewer than 50 words: lexical ratios are unstable and should not be interpreted.");
  if (dispersion === "insufficient") cautions.push("Fewer than 5 sentences: sentence-dispersion statistics are descriptive numbers only.");
  if (cadence === "insufficient") cautions.push("Fewer than 10 sentences: cadence-pattern inference is suppressed.");
  return {
    word_count: wordCountValue,
    sentence_count: sentenceCount,
    lexical_profile: lexical,
    sentence_dispersion: dispersion,
    cadence_inference: cadence,
    stronger_interpretation_supported: stronger,
    cautions,
    note: "These are conservative stability guardrails for interpretation, not empirical authorship thresholds.",
  };
}

export function linguisticProfile(text) {
  const sentenceList = splitSentences(text);
  const structure = parseTextStructure(text);
  const paragraphBlocks = (structure.blocks || []).filter((block) => block.type === "paragraph");
  const tokenList = words(text);
  const wc = tokenList.length;
  const sentenceLengths = sentenceList.map((sentence) => wordCount(sentence));
  const paragraphLengths = paragraphBlocks.map((block) => wordCount(block.text));
  const openingCounts = new Map();
  sentenceList.forEach((sentence) => {
    const opening = sentenceOpening(sentence);
    if (opening) openingCounts.set(opening, (openingCounts.get(opening) || 0) + 1);
  });
  const repeatedOpenings = [...openingCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  const unique = new Set(tokenList);
  const sentenceMean = mean(sentenceLengths);
  const sentenceSd = sd(sentenceLengths);
  const paragraphMean = mean(paragraphLengths);
  const paragraphSd = sd(paragraphLengths);

  return {
    word_count: wc,
    sentence_count: sentenceList.length,
    paragraph_count: paragraphBlocks.length,
    sample_adequacy: sampleAdequacy(wc, sentenceList.length),
    mean_sentence_words: round(sentenceMean, 2),
    sentence_length_sd: round(sentenceSd, 2),
    sentence_length_cv: round(ratio(sentenceSd, sentenceMean), 3),
    sentence_length_lag1_correlation: round(correlationLag1(sentenceLengths), 3),
    short_sentence_share: round(ratio(sentenceLengths.filter((n) => n <= 11).length, sentenceLengths.length), 3),
    long_sentence_share: round(ratio(sentenceLengths.filter((n) => n >= 30).length, sentenceLengths.length), 3),
    mean_paragraph_words: round(paragraphMean, 2),
    paragraph_length_cv: round(ratio(paragraphSd, paragraphMean), 3),
    lexical_type_token_ratio: round(ratio(unique.size, wc), 3),
    transition_density_per_100_words: round(ratio(countMatches(text, TRANSITION_RE) * 100, wc), 3),
    hedge_density_per_100_words: round(ratio(countMatches(text, HEDGE_RE) * 100, wc), 3),
    abstract_noun_density_per_100_words: round(ratio(countMatches(text, ABSTRACT_NOUN_RE) * 100, wc), 3),
    clause_marker_density_per_100_words: round(ratio(countMatches(text, CLAUSE_RE) * 100, wc), 3),
    citation_density_per_100_words: round(ratio(countMatches(text, CITATION_RE) * 100, wc), 3),
    first_person_density_per_100_words: round(ratio(countMatches(text, FIRST_PERSON_RE) * 100, wc), 3),
    passive_proxy_density_per_100_words: round(ratio(countMatches(text, PASSIVE_RE) * 100, wc), 3),
    technical_token_density_per_100_words: round(ratio(countMatches(text, TECHNICAL_RE) * 100, wc), 3),
    repeated_sentence_opening_share: round(ratio(repeatedOpenings, sentenceList.length), 3),
    punctuation: punctuationProfile(text, wc),
  };
}

function proseParagraphs(text) {
  const structure = parseTextStructure(text);
  return (structure.blocks || []).filter((block) => block.type === "paragraph").map((block) => block.text.trim()).filter(Boolean);
}

function segmentFromParagraphs(paragraphs, start, end) {
  return paragraphs.slice(start, end).join("\n\n");
}

function percentileSegment(paragraphs, startRatio, endRatio) {
  if (!paragraphs.length) return "";
  const start = Math.floor(paragraphs.length * startRatio);
  const end = Math.max(start + 1, Math.ceil(paragraphs.length * endRatio));
  return segmentFromParagraphs(paragraphs, start, Math.min(paragraphs.length, end));
}

export function positionalProfiles(text) {
  const paragraphs = proseParagraphs(text);
  return {
    opening_two_paragraphs: linguisticProfile(segmentFromParagraphs(paragraphs, 0, Math.min(2, paragraphs.length))),
    first_quarter: linguisticProfile(percentileSegment(paragraphs, 0, 0.25)),
    middle_half: linguisticProfile(percentileSegment(paragraphs, 0.25, 0.75)),
    final_quarter: linguisticProfile(percentileSegment(paragraphs, 0.75, 1)),
    whole_document: linguisticProfile(text),
    segmentation: {
      method: "first_two_substantive_prose_paragraphs",
      prose_paragraph_count: paragraphs.length,
      headings_excluded: true,
      lists_and_quotations_excluded: true,
    },
  };
}

function metricDelta(a, b) {
  const keys = Object.keys(a || {}).filter((key) => typeof a[key] === "number" && typeof b?.[key] === "number");
  return Object.fromEntries(keys.map((key) => [key, round(b[key] - a[key], 4)]));
}

function normalizeObservation(observation = {}) {
  const score = Number(observation.aiScore);
  const humanScore = Number(observation.humanScore);
  const paraphrasedScore = Number(observation.paraphrasedScore);
  return {
    detector: String(observation.detector || "unknown").slice(0, 80),
    version: observation.version ? String(observation.version).slice(0, 80) : null,
    classification: observation.classification ? String(observation.classification).slice(0, 80) : null,
    ai_score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
    human_score: Number.isFinite(humanScore) ? Math.max(0, Math.min(100, humanScore)) : null,
    paraphrased_score: Number.isFinite(paraphrasedScore) ? Math.max(0, Math.min(100, paraphrasedScore)) : null,
    flagged_sentence_indices: Array.isArray(observation.flaggedSentenceIndices)
      ? observation.flaggedSentenceIndices.map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 1000)
      : [],
    notes: observation.notes ? String(observation.notes).slice(0, 1000) : null,
  };
}

function observationConsensus(observations) {
  const normalized = observations.map(normalizeObservation);
  const aiScores = normalized.map((o) => o.ai_score).filter(Number.isFinite);
  const labels = normalized.map((o) => String(o.classification || "").toLowerCase()).filter(Boolean);
  const aiVotes = labels.filter((label) => /\bai\b|generated|paraphras/.test(label) && !/human/.test(label)).length;
  const humanVotes = labels.filter((label) => /human/.test(label) && !/ai/.test(label)).length;
  return {
    detector_count: normalized.length,
    mean_ai_score: aiScores.length ? round(mean(aiScores), 2) : null,
    ai_or_paraphrase_votes: aiVotes,
    human_votes: humanVotes,
    disagreement: aiVotes > 0 && humanVotes > 0,
    observations: normalized,
  };
}

function aggregateSentenceSubset(sentences, indices) {
  const selected = indices.map((i) => sentences[i]).filter(Boolean);
  return selected.length ? linguisticProfile(selected.join(" ")) : null;
}

function openingSentenceIndices(text) {
  const structure = parseTextStructure(text);
  const paragraphs = (structure.blocks || []).filter((block) => block.type === "paragraph").slice(0, 2);
  return [...new Set(paragraphs.flatMap((block) => block.sentenceIndices || []))];
}

function flaggedSentenceAnalysis(text, consensus) {
  const sentences = splitSentences(text);
  const allFlagged = [...new Set(consensus.observations.flatMap((o) => o.flagged_sentence_indices || []))]
    .filter((i) => i >= 0 && i < sentences.length).sort((a, b) => a - b);
  if (!allFlagged.length) return { available: false, reason: "No sentence-level detector highlights were recorded for this candidate.", flagged_sentence_indices: [] };
  const flaggedSet = new Set(allFlagged);
  const unflagged = sentences.map((_, i) => i).filter((i) => !flaggedSet.has(i));
  const opening = openingSentenceIndices(text);
  const openingSet = new Set(opening);
  const openingFlagged = allFlagged.filter((i) => openingSet.has(i));
  const restIndices = sentences.map((_, i) => i).filter((i) => !openingSet.has(i));
  const restFlagged = allFlagged.filter((i) => !openingSet.has(i));
  return {
    available: true,
    sentence_count: sentences.length,
    flagged_sentence_indices: allFlagged,
    flagged_share: round(ratio(allFlagged.length, sentences.length), 3),
    flagged_profile: aggregateSentenceSubset(sentences, allFlagged),
    unflagged_profile: aggregateSentenceSubset(sentences, unflagged),
    opening_two_paragraphs: { sentence_count: opening.length, flagged_count: openingFlagged.length, flagged_share: round(ratio(openingFlagged.length, opening.length), 3) },
    remainder: { sentence_count: restIndices.length, flagged_count: restFlagged.length, flagged_share: round(ratio(restFlagged.length, restIndices.length), 3) },
  };
}

function positionAgainstReference(value, ref, scale = 1) {
  const v = Number(value) * scale;
  if (!Number.isFinite(v) || !ref || ref.n < 3 || !Number.isFinite(ref.q1) || !Number.isFinite(ref.q3)) return "not_interpreted";
  if (v < ref.min) return "below_observed_range";
  if (v < ref.q1) return "below_reference_iqr";
  if (v <= ref.q3) return "within_reference_iqr";
  if (v <= ref.max) return "above_reference_iqr";
  return "above_observed_range";
}

function buildCorpusInterpretation(candidate, family) {
  const reference = family?.cadence?.reference || {};
  const supported = ["supported", "emerging"].includes(family?.evidence_strength);
  const metrics = [
    ["mean_sentence_words", candidate.mean_sentence_words, reference.mean_sentence_words, 1],
    ["sentence_length_sd", candidate.sentence_length_sd, reference.sentence_length_sd, 1],
    ["sentence_length_cv", candidate.sentence_length_cv, reference.sentence_length_cv, 1],
    ["long_sentence_share", candidate.long_sentence_share, reference.long_sentence_share_percent, 100],
  ];
  return {
    available: supported && Number(family?.cadence?.measuredSources || 0) >= 3,
    evidence_strength: family?.evidence_strength || "insufficient",
    matched_documents: family?.matchCount || 0,
    effective_family: family?.effectiveLabel || null,
    fallback_applied: Boolean(family?.fallback_applied),
    message: family?.message || null,
    metrics: Object.fromEntries(metrics.map(([key, value, ref, scale]) => [key, {
      value,
      reference: ref || null,
      position: supported ? positionAgainstReference(value, ref, scale) : "not_interpreted",
    }])),
    note: "Only cadence measures available in the matched corpus receive corpus-relative interpretation. Other linguistic metrics remain descriptive and must not be labelled high/low from raw thresholds alone.",
  };
}

function researchHypotheses(sourceProfiles, candidateProfiles, consensus, flaggedAnalysis, corpusInterpretation) {
  const source = sourceProfiles.whole_document;
  const candidate = candidateProfiles.whole_document;
  const opening = candidateProfiles.opening_two_paragraphs;
  const notes = [];
  const cvRef = corpusInterpretation?.metrics?.sentence_length_cv;

  if (candidate.sample_adequacy?.cadence_inference !== "insufficient" && cvRef && ["below_reference_iqr", "below_observed_range"].includes(cvRef.position)) {
    const ref = cvRef.reference;
    notes.push(`Sentence-length CV is ${candidate.sentence_length_cv.toFixed(2)}, below the matched corpus IQR (${Number(ref.q1).toFixed(2)}–${Number(ref.q3).toFixed(2)}). Treat this as a corpus-relative cadence observation, not an authorship finding or a target for artificial variation.`);
  }
  if (candidate.sample_adequacy?.cadence_inference !== "insufficient" && candidate.repeated_sentence_opening_share > source.repeated_sentence_opening_share + 0.10) {
    notes.push("The revision materially increased repeated sentence openings relative to the source; inspect the affected passages before deciding whether any local restructuring is warranted.");
  }
  if (candidate.transition_density_per_100_words > source.transition_density_per_100_words + 0.5 && candidate.word_count >= 150) {
    notes.push("Explicit transition density increased materially relative to the source. Inspect whether the added signposting improves logic or merely makes cohesion more mechanical.");
  }
  if (candidate.abstract_noun_density_per_100_words > source.abstract_noun_density_per_100_words + 0.5 && candidate.word_count >= 150) {
    notes.push("Revision increased abstract-noun density relative to the source; review whether direct verbs and concrete grammatical subjects would better preserve the writer's register.");
  }
  if (opening.sample_adequacy?.sentence_dispersion === "insufficient") {
    notes.push("Opening-passage cadence interpretation is suppressed because the first two substantive prose paragraphs contain too few sentences for stable dispersion analysis.");
  } else if (opening.word_count >= 80 && candidate.sentence_count >= 10 && opening.sentence_length_cv < candidate.sentence_length_cv * 0.75) {
    notes.push("The first two substantive prose paragraphs are more rhythmically regular than the document overall. Treat this as a within-document observation and compare it with repeated runs before making any editing decision.");
  }
  if (flaggedAnalysis?.available) {
    const openingRate = flaggedAnalysis.opening_two_paragraphs.flagged_share;
    const restRate = flaggedAnalysis.remainder.flagged_share;
    if (flaggedAnalysis.opening_two_paragraphs.sentence_count >= 2 && openingRate >= restRate + 0.2) {
      notes.push(`Observed detector highlights are denser in the opening two paragraphs (${Math.round(openingRate * 100)}%) than in the remainder (${Math.round(restRate * 100)}%). Record this across more documents before treating opening position as a stable feature.`);
    }
  }
  if (consensus.disagreement) notes.push("Recorded detectors disagree. Preserve the disagreement as evidence; do not collapse it into one authorship verdict.");
  if (!notes.length) notes.push("No measured feature warrants a strong interpretation in this sample. Retain the profile descriptively and accumulate more adequately sized, corpus-referenced observations before changing revision policy.");
  return notes;
}

export function buildDetectorResearchReport({ sourceText = "", candidateText = "", observations = [], styleFilters = {} } = {}) {
  const sourceProfiles = positionalProfiles(sourceText || candidateText);
  const candidateProfiles = positionalProfiles(candidateText || sourceText);
  const consensus = observationConsensus(Array.isArray(observations) ? observations : []);
  const candidate = candidateText || sourceText;
  const flaggedAnalysis = flaggedSentenceAnalysis(candidate, consensus);
  const family = compileFamily(styleFilters || {});
  const corpusInterpretation = buildCorpusInterpretation(candidateProfiles.whole_document, family);
  return {
    version: "detector-research-v3",
    purpose: "Measure linguistic, positional and sentence-highlight features associated with external detector outcomes while preserving detector disagreement, sample adequacy and academic-content constraints. This is an observational research layer, not proof of authorship.",
    source_profiles: sourceProfiles,
    candidate_profiles: candidateProfiles,
    whole_document_delta: metricDelta(sourceProfiles.whole_document, candidateProfiles.whole_document),
    opening_delta: metricDelta(sourceProfiles.opening_two_paragraphs, candidateProfiles.opening_two_paragraphs),
    corpus_reference: corpusInterpretation,
    detector_consensus: consensus,
    flagged_sentence_analysis: flaggedAnalysis,
    research_hypotheses: researchHypotheses(sourceProfiles, candidateProfiles, consensus, flaggedAnalysis, corpusInterpretation),
  };
}
