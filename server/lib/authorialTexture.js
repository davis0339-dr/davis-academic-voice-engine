// Evidence-based assessment of existing authorial/discourse texture.
// This is NOT an authorship detector and does not infer whether a human or AI wrote the text.
// Clarity, grammar, citation density, technical sophistication and generic coherence
// are deliberately NOT direct positive inputs to authorial texture.

import { splitSentences } from "./sentences.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length);
}

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function severityWeight(signal) {
  if (signal?.severity === "high") return 3;
  if (signal?.severity === "medium") return 1.5;
  return 0.75;
}

function diagnosticPatternBurden(diagnostics, sentenceCount) {
  const architecture = diagnostics?.discourse_architecture?.signals || [];
  const discourse = diagnostics?.qualitative_human_discourse?.signals || [];
  const contrastive = diagnostics?.contrastive_language?.signals || [];
  const scaffolding = diagnostics?.rhetorical_scaffolding || [];
  const cohesion = diagnostics?.cohesion || [];
  const paragraphPatterns = diagnostics?.paragraph_patterns || [];
  const structuralMonotony = diagnostics?.structural_monotony || [];

  const weighted = [
    ...architecture.map((s) => severityWeight(s) * 1.35),
    ...discourse.map((s) => severityWeight(s)),
    ...contrastive.map((s) => severityWeight(s) * 0.8),
  ].reduce((a, b) => a + b, 0)
    + scaffolding.length * 0.5
    + cohesion.length * 0.35
    + paragraphPatterns.length * 0.5
    + structuralMonotony.length * 0.45;

  const denominator = Math.max(5, sentenceCount / 4);
  const burdenRatio = weighted / denominator;
  const normalized = clamp01(burdenRatio / 2.4);

  return {
    weighted_score: Number(weighted.toFixed(3)),
    burden_ratio: Number(burdenRatio.toFixed(3)),
    normalized: Number(normalized.toFixed(3)),
    architecture_signal_count: architecture.length,
    discourse_signal_count: discourse.length,
    contrastive_signal_count: contrastive.length,
    scaffolding_count: scaffolding.length,
    paragraph_pattern_count: paragraphPatterns.length,
    structural_monotony_count: structuralMonotony.length,
  };
}

function machineLanguagePressure(diagnostics) {
  const forensic = diagnostics?.machine_language_forensics;
  if (!forensic?.available) {
    return { score: 0, raw_score: 0, hit_sentence_ratio: 0, target_paragraph_count: 0, available: false };
  }
  const raw = clamp01(Number(forensic.score || 0));
  const hitRatio = clamp01(Number(forensic.metrics?.hit_sentence_ratio || 0));
  const targetParagraphCount = (forensic.target_paragraph_indices || []).length;
  const recurrenceFloor = targetParagraphCount >= 2
    ? hitRatio >= 0.35 ? 0.48 : hitRatio >= 0.22 ? 0.36 : hitRatio >= 0.15 ? 0.24 : 0
    : 0;
  return {
    score: Number(Math.max(raw, recurrenceFloor).toFixed(3)),
    raw_score: Number(raw.toFixed(3)),
    hit_sentence_ratio: Number(hitRatio.toFixed(3)),
    target_paragraph_count: targetParagraphCount,
    recurrence_floor_applied: recurrenceFloor > raw,
    available: true,
  };
}

function regularityLabel(score) {
  return score >= 0.66 ? "high" : score >= 0.35 ? "moderate" : "low";
}

function sentenceLengthMetrics(sentences) {
  const lengths = sentences.map((sentence) => words(sentence).length).filter((n) => n > 0);
  if (lengths.length < 2) {
    return { mean: lengths[0] || 0, cv: 0, diversity: 0.45, regularity: 0.55 };
  }
  const m = mean(lengths);
  const cv = m ? stddev(lengths) / m : 0;

  let diversity = 0.45;
  if (cv >= 0.28 && cv <= 0.72) diversity = 0.95;
  else if (cv >= 0.20 && cv <= 0.90) diversity = 0.78;
  else if (cv >= 0.12) diversity = 0.60;
  else diversity = 0.30;

  let regularity = 0.35;
  if (cv < 0.10) regularity = 0.90;
  else if (cv < 0.16) regularity = 0.75;
  else if (cv < 0.22) regularity = 0.58;
  else if (cv > 1.0) regularity = 0.45;

  return {
    mean: Number(m.toFixed(3)),
    cv: Number(cv.toFixed(3)),
    diversity: Number(diversity.toFixed(3)),
    regularity: Number(regularity.toFixed(3)),
  };
}

function openingRegularity(sentences) {
  if (sentences.length < 4) return { score: 0.35, repeated_ratio: 0, repeated_openings: [] };
  const openings = sentences.map((sentence) => words(sentence).slice(0, 3).join(" ")).filter(Boolean);
  const counts = new Map();
  for (const opening of openings) counts.set(opening, (counts.get(opening) || 0) + 1);
  const repeated = [...counts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]);
  const repeatedOccurrences = repeated.reduce((sum, [, count]) => sum + count, 0);
  const repeatedRatio = openings.length ? repeatedOccurrences / openings.length : 0;
  const score = clamp01(
    repeatedRatio >= 0.5 ? 0.95 :
    repeatedRatio >= 0.32 ? 0.78 :
    repeatedRatio >= 0.18 ? 0.58 :
    repeatedRatio >= 0.08 ? 0.40 : 0.20
  );
  return {
    score: Number(score.toFixed(3)),
    repeated_ratio: Number(repeatedRatio.toFixed(3)),
    repeated_openings: repeated.slice(0, 5).map(([opening, count]) => ({ opening, count })),
  };
}

const EXPLICIT_CONNECTIVE_RE = /^\s*(?:furthermore|moreover|additionally|in addition|however|nevertheless|therefore|thus|consequently|similarly|likewise|first(?:ly)?|second(?:ly)?|third(?:ly)?|finally|overall|taken together|in contrast|by contrast)\b/i;

function transitionRegularity(sentences) {
  if (!sentences.length) return { score: 0, density: 0, repeated_frames: [] };
  const frames = [];
  let connectiveCount = 0;
  for (const sentence of sentences) {
    const match = sentence.match(EXPLICIT_CONNECTIVE_RE);
    if (match) {
      connectiveCount += 1;
      frames.push(match[0].trim().toLowerCase());
    }
  }
  const counts = new Map();
  for (const frame of frames) counts.set(frame, (counts.get(frame) || 0) + 1);
  const repeatedFrames = [...counts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]);
  const density = connectiveCount / sentences.length;
  const repeatedWeight = repeatedFrames.reduce((sum, [, count]) => sum + (count - 1), 0) / Math.max(1, sentences.length);
  const score = clamp01(density * 1.5 + repeatedWeight * 2.2);
  return {
    score: Number(score.toFixed(3)),
    density: Number(density.toFixed(3)),
    repeated_frames: repeatedFrames.slice(0, 6).map(([frame, count]) => ({ frame, count })),
  };
}

const REPORTING_FRAME_RE = /\b(?:stud(?:y|ies)|research|evidence|findings?|results?)\s+(?:shows?|showed|suggests?|suggested|indicates?|indicated|demonstrates?|demonstrated|finds?|found|reveals?|revealed)\b/i;

function reportingFrameRegularity(sentences) {
  if (!sentences.length) return { score: 0, density: 0 };
  const count = sentences.filter((sentence) => REPORTING_FRAME_RE.test(sentence)).length;
  const density = count / sentences.length;
  return { score: Number(clamp01(density * 2.2).toFixed(3)), density: Number(density.toFixed(3)) };
}

function paragraphMetrics(diagnostics) {
  const blocks = (diagnostics?.text_structure?.blocks || []).filter(
    (block) => block.type === "paragraph" && Number(block.wordCount) >= 8
  );
  if (blocks.length < 3) return { diversity: 0.5, regularity: 0.45, cv: 0, paragraph_count: blocks.length };
  const lengths = blocks.map((block) => Number(block.wordCount) || 0);
  const m = mean(lengths);
  const cv = m ? stddev(lengths) / m : 0;
  let diversity = 0.5;
  if (cv >= 0.24 && cv <= 0.95) diversity = 0.90;
  else if (cv >= 0.16) diversity = 0.72;
  else if (cv >= 0.10) diversity = 0.55;
  else diversity = 0.35;
  const regularity = clamp01(cv < 0.08 ? 0.90 : cv < 0.14 ? 0.72 : cv < 0.20 ? 0.52 : 0.28);
  return {
    diversity: Number(diversity.toFixed(3)),
    regularity: Number(regularity.toFixed(3)),
    cv: Number(cv.toFixed(3)),
    paragraph_count: blocks.length,
  };
}

function epistemicVariation(sentences) {
  if (sentences.length < 3) return 0.45;
  const categories = [
    /\b(?:may|might|could|appears?|seems?|suggests?|likely|possibly|potentially)\b/i,
    /\b(?:however|although|though|whereas|while|despite|nevertheless|yet)\b/i,
    /\b(?:depends? on|conditional|contingent|only when|unless|under .* conditions?)\b/i,
    /\b(?:limitation|limited|cannot establish|does not establish|should not be assumed|uncertain|mixed evidence)\b/i,
    /\b(?:therefore|thus|implies?|means that|consequently|accordingly)\b/i,
  ];
  const present = categories.filter((re) => sentences.some((sentence) => re.test(sentence))).length;
  return Number(clamp01(0.25 + present * 0.14).toFixed(3));
}

function rhetoricalRoleDiversity(sentences) {
  if (sentences.length < 4) return 0.45;
  const roleMatchers = {
    qualification: /\b(?:however|although|though|while|whereas|despite|yet|unless|only when)\b/i,
    implication: /\b(?:therefore|thus|consequently|implies?|means that|matters because|in turn)\b/i,
    contrast: /\b(?:by contrast|in contrast|different|mixed|rather than|but)\b/i,
    context: /\b(?:period|setting|context|institutional|historical|post-\d{4}|between \d{4} and \d{4})\b/i,
    mechanism: /\b(?:because|through|by which|mechanism|channel|leads? to|reduces?|increases?)\b/i,
    limitation: /\b(?:limited|limitation|gap|remains unclear|underexplored|cannot|does not)\b/i,
  };
  const rolesPresent = Object.values(roleMatchers).filter((re) => sentences.some((sentence) => re.test(sentence))).length;
  return Number(clamp01(0.25 + rolesPresent * 0.10).toFixed(3));
}

function lexicalLocality(sentences) {
  const tokens = words(sentences.join(" "));
  if (tokens.length < 40) return 0.5;
  const frequencies = new Map();
  for (const token of tokens) {
    if (token.length < 4) continue;
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  const eligible = [...frequencies.values()];
  if (!eligible.length) return 0.5;
  const repeated = eligible.filter((count) => count >= 3).length / eligible.length;
  if (repeated >= 0.08 && repeated <= 0.28) return 0.78;
  if (repeated <= 0.40) return 0.62;
  return 0.42;
}

function cadenceEvidence(cadenceDeviation) {
  if (!cadenceDeviation?.available) return 0.5;
  if (cadenceDeviation.threshold_flagged) return 0.25;
  if (cadenceDeviation.range_position === "within_observed_range") return 0.75;
  return 0.55;
}

function familyEvidence(languageDeviation) {
  const alignment = Number(languageDeviation?.family_alignment_score);
  if (!Number.isFinite(alignment)) return 0.5;
  return clamp01(0.25 + alignment * 0.55);
}

function machinePatternRegularity({ sentences, diagnostics, cadenceDeviation }) {
  const length = sentenceLengthMetrics(sentences);
  const openings = openingRegularity(sentences);
  const transitions = transitionRegularity(sentences);
  const reporting = reportingFrameRegularity(sentences);
  const paragraphs = paragraphMetrics(diagnostics);
  const diagnosticBurden = diagnosticPatternBurden(diagnostics, sentences.length);
  const cadencePenalty = cadenceDeviation?.threshold_flagged ? 0.8 : 0.25;
  const baseScore = clamp01(
    diagnosticBurden.normalized * 0.30 +
    openings.score * 0.18 +
    transitions.score * 0.16 +
    reporting.score * 0.12 +
    length.regularity * 0.10 +
    paragraphs.regularity * 0.08 +
    cadencePenalty * 0.06
  );
  const machineLanguage = machineLanguagePressure(diagnostics);
  const discourseForensics = diagnostics?.discourse_regularity_forensics;
  const discourseScore = discourseForensics?.available ? clamp01(Number(discourseForensics.score || 0)) : 0;
  let score = Math.max(baseScore, machineLanguage.score, discourseScore);
  if (machineLanguage.score >= 0.34 && discourseScore >= 0.34) score = Math.max(score, 0.68);
  score = clamp01(score);
  const signals = [];
  if (diagnosticBurden.normalized >= 0.55) signals.push("document_level_pattern_burden");
  if (openings.score >= 0.58) signals.push("repeated_sentence_opening_architecture");
  if (transitions.score >= 0.55) signals.push("explicit_transition_regularisation");
  if (reporting.score >= 0.55) signals.push("repeated_reporting_frame");
  if (length.regularity >= 0.72) signals.push("sentence_length_regularisation");
  if (paragraphs.regularity >= 0.72) signals.push("paragraph_shape_regularisation");
  if (cadenceDeviation?.threshold_flagged) signals.push("cadence_deviation_flag");
  if (machineLanguage.score >= 0.34) signals.push("modern_machine_language_pressure");
  if (discourseScore >= 0.34) signals.push("cross_paragraph_regularity_pressure");
  if (machineLanguage.score >= 0.34 && discourseScore >= 0.34) signals.push("corroborated_machine_pattern_pressure");
  const evidenceDimensions = [baseScore >= 0.34, machineLanguage.score >= 0.34, discourseScore >= 0.34].filter(Boolean).length;
  const confidence = sentences.length >= 30 && evidenceDimensions >= 2
    ? "high"
    : sentences.length >= 12 && evidenceDimensions >= 1
      ? "moderate"
      : "limited";
  return {
    score: Number(score.toFixed(3)),
    label: regularityLabel(score),
    confidence,
    evidence_dimension_count: evidenceDimensions,
    signals,
    components: {
      diagnostic_pattern_burden: diagnosticBurden.normalized,
      opening_regularisation: openings.score,
      transition_regularisation: transitions.score,
      reporting_frame_regularisation: reporting.score,
      sentence_length_regularisation: length.regularity,
      paragraph_shape_regularisation: paragraphs.regularity,
      cadence_regularisation_signal: cadencePenalty,
      modern_machine_language_pressure: machineLanguage.score,
      cross_paragraph_forensic_regularisation: Number(discourseScore.toFixed(3)),
    },
    evidence: {
      diagnostic_pattern_burden: diagnosticBurden,
      openings,
      transitions,
      reporting,
      sentence_lengths: length,
      paragraphs,
      modern_machine_language: machineLanguage,
      discourse_regularity_forensics: discourseForensics || null,
    },
    note: "Machine-pattern pressure is a calibrated style-risk index, not the probability that AI wrote the text. Labels require recurrence and, for High, corroboration across independent diagnostic layers.",
  };
}

function surfaceQuality({ text, diagnostics }) {
  const source = String(text || "").trim();
  const sentences = splitSentences(source);
  if (!source || !sentences.length) return { score: 0, label: "insufficient_text", evidence: {} };
  const fragmentLike = sentences.filter((sentence) => words(sentence).length < 4).length;
  const placeholderCount = (source.match(/\[(?:citation needed|TBD|TODO|XXX)\]/gi) || []).length;
  const genericIssueCount = diagnostics?.generic_phrasing?.length || 0;
  const cohesionIssueCount = diagnostics?.cohesion?.length || 0;
  const penalty = clamp01(
    fragmentLike / Math.max(1, sentences.length) * 0.35 +
    placeholderCount / Math.max(1, sentences.length) * 0.45 +
    genericIssueCount / Math.max(3, sentences.length) * 0.12 +
    cohesionIssueCount / Math.max(3, sentences.length) * 0.08
  );
  const score = clamp01(0.92 - penalty);
  return {
    score: Number(score.toFixed(3)),
    label: score >= 0.80 ? "high" : score >= 0.60 ? "moderate" : "low",
    evidence: {
      sentence_count: sentences.length,
      fragment_like_count: fragmentLike,
      placeholder_count: placeholderCount,
      generic_issue_count: genericIssueCount,
      cohesion_issue_count: cohesionIssueCount,
    },
    note: "Surface quality measures basic academic usability. It is not evidence of authorial texture and does not independently increase expressive preservation.",
  };
}

function semanticPreservation(text) {
  const source = String(text || "");
  const citationHits = (source.match(/\([^()\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^()\n]*\)/g) || []).length;
  const numericHits = (source.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  const technicalHits = (source.match(/\b(?:regression|coefficient|hypothesis|construct|variable|panel|logit|logistic|OLS|GLS|ANOVA|SEM|IFRS|IAS|CEO|ROA|ROE)\b/gi) || []).length;
  const protectedDensity = citationHits + numericHits * 0.25 + technicalHits * 0.25;
  return {
    priority: protectedDensity >= 3 ? "very_high" : "high",
    evidence: { citation_count: citationHits, numeric_token_count: numericHits, technical_term_hits: technicalHits },
    basis: "proposition_evidence_argument_integrity",
  };
}

function authorialTexture({ sentences, diagnostics, cadenceDeviation, languageDeviation }) {
  const lengths = sentenceLengthMetrics(sentences);
  const paragraphs = paragraphMetrics(diagnostics);
  const regularity = machinePatternRegularity({ sentences, diagnostics, cadenceDeviation });
  const components = {
    sentence_architecture_diversity: lengths.diversity,
    paragraph_shape_diversity: paragraphs.diversity,
    epistemic_variation: epistemicVariation(sentences),
    rhetorical_role_diversity: rhetoricalRoleDiversity(sentences),
    lexical_distribution_individuality: lexicalLocality(sentences),
    corpus_cadence_support: cadenceEvidence(cadenceDeviation),
    corpus_family_support: familyEvidence(languageDeviation),
  };
  const positive = clamp01(
    components.sentence_architecture_diversity * 0.22 +
    components.paragraph_shape_diversity * 0.12 +
    components.epistemic_variation * 0.18 +
    components.rhetorical_role_diversity * 0.20 +
    components.lexical_distribution_individuality * 0.10 +
    components.corpus_cadence_support * 0.10 +
    components.corpus_family_support * 0.08
  );
  const score = clamp01(positive - regularity.score * 0.42);
  return {
    score: Number(score.toFixed(3)),
    label: score >= 0.68 ? "strong" : score >= 0.48 ? "mixed" : "weak",
    components,
    positive_evidence_score: Number(positive.toFixed(3)),
    regularity_penalty: Number((regularity.score * 0.42).toFixed(3)),
    machine_pattern_regularity: regularity,
  };
}

function expressivePreservation(textureScore, regularityScore) {
  if (textureScore >= 0.68 && regularityScore <= 0.34) return "high";
  if (textureScore >= 0.50 && regularityScore <= 0.60) return "medium";
  return "low";
}

function labelForLegacy(textureLabel) {
  if (textureLabel === "strong") return "strong_existing_texture";
  if (textureLabel === "mixed") return "mixed_existing_texture";
  return "weak_or_synthetic_texture";
}

export function assessAuthorialTexture({ text, diagnostics, cadenceDeviation, languageDeviation } = {}) {
  const source = String(text || "");
  const sentences = splitSentences(source);
  const surface = surfaceQuality({ text: source, diagnostics });
  const texture = authorialTexture({ sentences, diagnostics, cadenceDeviation, languageDeviation });
  const semantic = semanticPreservation(source);
  const expressivePriority = expressivePreservation(texture.score, texture.machine_pattern_regularity.score);
  return {
    version: "authorial-texture-v2.0",
    score: texture.score,
    label: labelForLegacy(texture.label),
    preservation_priority: expressivePriority,
    recommended_breadth: expressivePriority === "high" ? "targeted" : expressivePriority === "medium" ? "selective" : "broad_if_diagnosed",
    surface_quality: surface,
    authorial_texture: {
      score: texture.score,
      label: texture.label,
      components: texture.components,
      positive_evidence_score: texture.positive_evidence_score,
      regularity_penalty: texture.regularity_penalty,
    },
    machine_pattern_regularity: texture.machine_pattern_regularity,
    semantic_preservation: semantic,
    expressive_preservation: {
      priority: expressivePriority,
      basis: "authorial_texture_strength_minus_machine_pattern_regularisation",
    },
    components: texture.components,
    synthetic_burden: texture.machine_pattern_regularity.evidence.diagnostic_pattern_burden,
    evidence: {
      sentence_count: sentences.length,
      cadence_range_position: cadenceDeviation?.range_position || "unavailable",
      cadence_threshold_flagged: Boolean(cadenceDeviation?.threshold_flagged),
      measured_family_alignment: Number.isFinite(Number(languageDeviation?.family_alignment_score)) ? Number(languageDeviation.family_alignment_score) : null,
      measured_family_available: Boolean(languageDeviation?.available),
    },
    note: "Authorial texture is assessed from observable rhetorical/discourse variation and is penalised by machine-pattern regularity. Clarity, grammar, citation density, technical sophistication and generic coherence are assessed separately and do not independently create a strong-texture preservation veto. This does not establish human or AI authorship.",
  };
}
