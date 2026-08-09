import { measureLanguageFingerprint } from "./languageFingerprint.js";

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
}

function normaliseText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function normaliseRewriteLineage(lineage, sourceText) {
  const generation = Math.max(0, Math.min(8, Number(lineage?.sourceGeneration) || 0));
  const rootSourceText = typeof lineage?.rootSourceText === "string" ? lineage.rootSourceText.trim() : "";
  const chained = Boolean(
    generation > 0 &&
    rootSourceText &&
    normaliseText(rootSourceText) !== normaliseText(sourceText)
  );

  return {
    source_generation: chained ? generation : 0,
    chained_from_prior_revision: chained,
    root_source_text: chained ? rootSourceText : "",
  };
}

export function assessIterativeRegularisation({ sourceText, candidateText, rewriteLineage } = {}) {
  const lineage = normaliseRewriteLineage(rewriteLineage, sourceText);
  if (!lineage.chained_from_prior_revision) {
    return {
      available: false,
      blocking: false,
      score: 0,
      severity: "not_applicable",
      reasons: [],
      source_generation: 0,
    };
  }

  const root = measureLanguageFingerprint(lineage.root_source_text);
  const current = measureLanguageFingerprint(sourceText || "");
  const candidate = measureLanguageFingerprint(candidateText || "");
  const reasons = [];
  let score = 0;

  const nominalisationDelta = candidate.nominalisation_per_1k - root.nominalisation_per_1k;
  const longWordDelta = candidate.long_word_ratio - root.long_word_ratio;
  const avgWordLengthDelta = candidate.avg_word_length - root.avg_word_length;
  const sentenceMeanDelta = candidate.sentence_mean - root.sentence_mean;
  const sentenceSdRatio = root.sentence_sd > 0 ? candidate.sentence_sd / root.sentence_sd : 1;
  const initialDiversityDelta = candidate.sentence_initial_diversity - root.sentence_initial_diversity;
  const transitionDelta = candidate.transition_per_100_sent - root.transition_per_100_sent;

  if (nominalisationDelta > Math.max(7, root.nominalisation_per_1k * 0.18)) {
    score += 1.15;
    reasons.push(`Nominalisation density is ${round(nominalisationDelta, 1)} per 1,000 words above the root-source level, indicating abstraction inflation across the rewrite chain.`);
  }
  if (longWordDelta > 0.025) {
    score += 0.9;
    reasons.push(`Long-word density has risen by ${round(longWordDelta * 100, 1)} percentage points from the root source, suggesting unnecessary lexical formalisation.`);
  }
  if (avgWordLengthDelta > 0.22) {
    score += 0.65;
    reasons.push(`Average word length is ${round(avgWordLengthDelta, 2)} characters above the root source; repeated rewriting is making the prose lexically denser rather than more natural.`);
  }
  if (sentenceMeanDelta > 4 && sentenceSdRatio < 0.88 && candidate.sentence_count >= 8) {
    score += 1.1;
    reasons.push("Sentence length increased while sentence-length variation contracted relative to the root source, a formalisation/regularisation pattern rather than authorial recovery.");
  }
  if (initialDiversityDelta < -0.09 && candidate.sentence_count >= 8) {
    score += 0.75;
    reasons.push("Sentence-opening diversity fell materially below the root source, indicating repeated structural regularisation.");
  }
  if (transitionDelta > 18 && candidate.transition_per_100_sent > 35) {
    score += 0.55;
    reasons.push("Explicit transition density increased sharply across the rewrite chain instead of allowing local topic continuity to carry the argument.");
  }

  // If the immediate source is already more formalised than the root, the next
  // candidate should normally move back toward the root rather than intensify the
  // drift. This catches rewrite-of-rewrite chains even when each individual pass
  // makes only a small additional change.
  const currentNominalDrift = current.nominalisation_per_1k - root.nominalisation_per_1k;
  const candidateNominalDrift = candidate.nominalisation_per_1k - root.nominalisation_per_1k;
  const currentLongWordDrift = current.long_word_ratio - root.long_word_ratio;
  const candidateLongWordDrift = candidate.long_word_ratio - root.long_word_ratio;
  if (currentNominalDrift > 5 && candidateNominalDrift > currentNominalDrift + 2.5) {
    score += 0.65;
    reasons.push("The new pass increases an existing nominalisation drift instead of reducing it.");
  }
  if (currentLongWordDrift > 0.018 && candidateLongWordDrift > currentLongWordDrift + 0.008) {
    score += 0.55;
    reasons.push("The new pass increases an existing long-word/formalisation drift instead of reducing it.");
  }

  const blocking = score >= 1.75;
  const severity = score >= 3 ? "high" : score >= 1.75 ? "medium" : score > 0 ? "low" : "none";

  return {
    available: true,
    blocking,
    score: round(score),
    severity,
    source_generation: lineage.source_generation,
    reasons,
    root_fingerprint: root,
    immediate_source_fingerprint: current,
    candidate_fingerprint: candidate,
    deltas_from_root: {
      nominalisation_per_1k: round(nominalisationDelta, 2),
      long_word_ratio: round(longWordDelta, 4),
      avg_word_length: round(avgWordLengthDelta, 3),
      sentence_mean: round(sentenceMeanDelta, 2),
      sentence_sd_ratio: round(sentenceSdRatio, 3),
      sentence_initial_diversity: round(initialDiversityDelta, 4),
      transition_per_100_sent: round(transitionDelta, 2),
    },
    note: "This is a rewrite-chain regularisation diagnostic, not an authorship detector. It checks whether repeated model passes are progressively formalising and regularising the prose away from the root source.",
  };
}

export function iterativeRegularisationPenalty(assessment) {
  if (!assessment?.available) return 0;
  return Math.min(1.25, finite(assessment.score) * 0.28);
}

export function buildIterativeRewriteDirective({ sourceText, rewriteLineage } = {}) {
  const lineage = normaliseRewriteLineage(rewriteLineage, sourceText);
  if (!lineage.chained_from_prior_revision) return "";

  return [
    "",
    "--- ITERATIVE REWRITE / AUTHORIAL RECOVERY GUARD ---",
    `This input is already generation ${lineage.source_generation} of a revision chain. Do NOT treat another pass as permission to make the prose more polished, abstract, compressed or uniformly academic.`,
    "The failure mode to avoid is cumulative machine regularisation: ordinary wording becomes nominalised, concrete verbs become abstract noun phrases, sentence shapes converge, transitions become over-explicit, and every paragraph acquires the same polished density.",
    "This pass should recover authorial texture while still executing the diagnosed structural plan. Preserve useful unevenness, ordinary academic wording, local repetition of technical terms, asymmetric emphasis and sentence-level dependence when they serve the argument.",
    "Do not replace clear words with elevated synonyms merely to create distance. Do not compress several concrete ideas into a dense noun stack. Do not turn every paragraph into a self-contained mini-abstract with a polished concluding sentence.",
    "Where the current source is more formalised or compressed than the root source, prefer semantically faithful wording closer to the root writer's lexical register. You may reuse a good root-source phrase when it is the most natural expression; rewrite distance is not a goal.",
    "The ROOT SOURCE below is an authorial-register anchor and factual cross-check. It is not a second passage to rewrite and it does not override later factual corrections in the current source.",
    "ROOT SOURCE (authorial-register anchor):",
    lineage.root_source_text,
  ].join("\n");
}

export function iterativeCorrectionBlock(assessment) {
  if (!assessment?.available || !assessment?.blocking) return "";
  return [
    "",
    "--- REWRITE-CHAIN DE-REGULARISATION CORRECTION ---",
    "The previous candidate intensified machine-like regularisation across an existing rewrite chain.",
    ...(assessment.reasons || []).map((reason) => `- ${reason}`),
    "Correct the identified drift without adding fake errors, slang or random variation. Use simpler verbs where an abstract noun phrase was introduced unnecessarily, relax over-balanced sentence architecture, and allow paragraph/sentence shapes to follow the actual reasoning rather than a uniform polished template.",
    "Move back toward the root author's lexical register while preserving the current source's facts, citations, variables, methods and any legitimate substantive corrections.",
  ].join("\n");
}
