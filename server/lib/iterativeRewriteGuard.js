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
  const chained = lineage.chained_from_prior_revision;
  // With lineage, compare against the retained original authorial register. Without
  // lineage, compare against the immediate source so a single Deep pass still cannot
  // improve its score merely by making vocabulary longer, denser or more abstract.
  const baselineText = chained ? lineage.root_source_text : String(sourceText || "");
  const root = measureLanguageFingerprint(baselineText);
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
  const baselineLabel = chained ? "root source" : "input source";

  if (nominalisationDelta > Math.max(7, root.nominalisation_per_1k * 0.18)) {
    score += 1.15;
    reasons.push(`Nominalisation density is ${round(nominalisationDelta, 1)} per 1,000 words above the ${baselineLabel}, indicating abstraction inflation rather than necessary structural revision.`);
  }
  if (longWordDelta > 0.025) {
    score += 1.0;
    reasons.push(`Long-word density has risen by ${round(longWordDelta * 100, 1)} percentage points from the ${baselineLabel}, suggesting unnecessary lexical formalisation.`);
  }
  if (avgWordLengthDelta > 0.22) {
    score += 0.85;
    reasons.push(`Average word length is ${round(avgWordLengthDelta, 2)} characters above the ${baselineLabel}; the revision is becoming lexically denser rather than more natural.`);
  }
  if (sentenceMeanDelta > 4 && sentenceSdRatio < 0.88 && candidate.sentence_count >= 8) {
    score += 1.1;
    reasons.push(`Sentence length increased while sentence-length variation contracted relative to the ${baselineLabel}, a formalisation/regularisation pattern rather than authorial recovery.`);
  }
  if (initialDiversityDelta < -0.09 && candidate.sentence_count >= 8) {
    score += 0.75;
    reasons.push(`Sentence-opening diversity fell materially below the ${baselineLabel}, indicating structural regularisation.`);
  }
  if (transitionDelta > 18 && candidate.transition_per_100_sent > 35) {
    score += 0.55;
    reasons.push(`Explicit transition density increased sharply relative to the ${baselineLabel} instead of allowing local topic continuity to carry the argument.`);
  }

  // If the immediate source is already more formalised than the retained root, the
  // next candidate should normally move back toward the root rather than intensify
  // the drift. This catches rewrite-of-rewrite chains even when each individual pass
  // makes only a small additional change.
  if (chained) {
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
  }

  const blockingThreshold = chained ? 1.75 : 1.80;
  const blocking = score >= blockingThreshold;
  const severity = score >= 3 ? "high" : score >= blockingThreshold ? "medium" : score > 0 ? "low" : "none";

  return {
    available: true,
    mode: chained ? "rewrite_chain" : "single_pass",
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
    note: chained
      ? "This is a rewrite-chain regularisation diagnostic, not an authorship detector. It checks whether repeated model passes are progressively formalising and regularising the prose away from the retained root source."
      : "This is a source-relative regularisation diagnostic, not an authorship detector. It checks whether one revision pass is creating lexical formalisation or structural regularity that was not justified by the input source.",
  };
}

export function iterativeRegularisationPenalty(assessment) {
  if (!assessment?.available) return 0;
  return Math.min(1.25, finite(assessment.score) * 0.28);
}

export function buildIterativeRewriteDirective({ sourceText, rewriteLineage, aggressive = false } = {}) {
  const lineage = normaliseRewriteLineage(rewriteLineage, sourceText);
  if (!lineage.chained_from_prior_revision) {
    if (!aggressive) return "";
    return [
      "",
      "--- DEEP RECONSTRUCTION ANTI-REGULARISATION GUARD ---",
      "Deep reconstruction authorises structural redevelopment where diagnosed. It does NOT authorise automatic lexical elevation, denser vocabulary, extra nominalisation, longer words, or uniformly polished sentence shapes.",
      "Do not turn simple academic wording into abstract noun phrases merely to make the revision look more sophisticated. Prefer clear verbs and ordinary disciplinary language where they carry the meaning accurately.",
      "Structural difference and lexical sophistication are separate dimensions. Change clause architecture, information order or paragraph reasoning when the plan requires it, but keep the writer's lexical register unless a specific wording defect justifies change.",
      "Do not manufacture roughness or mistakes. The aim is defensible academic prose with natural variation, not a detector score and not a maximally polished machine register.",
    ].join("\n");
  }

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
    "--- LEXICAL / STRUCTURAL DE-REGULARISATION CORRECTION ---",
    assessment.mode === "rewrite_chain"
      ? "The previous candidate intensified machine-like regularisation across an existing rewrite chain."
      : "The previous candidate introduced unnecessary lexical formalisation or regularity relative to the input source.",
    ...(assessment.reasons || []).map((reason) => `- ${reason}`),
    "Correct the identified drift without adding fake errors, slang or random variation. Use simpler verbs where an abstract noun phrase was introduced unnecessarily, relax over-balanced sentence architecture, and allow paragraph/sentence shapes to follow the actual reasoning rather than a uniform polished template.",
    assessment.mode === "rewrite_chain"
      ? "Move back toward the root author's lexical register while preserving the current source's facts, citations, variables, methods and any legitimate substantive corrections."
      : "Move back toward the input source's lexical register while retaining any genuinely necessary structural improvement and preserving all facts, citations, variables and methods.",
  ].join("\n");
}
