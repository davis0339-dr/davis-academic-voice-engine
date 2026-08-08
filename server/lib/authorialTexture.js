// Deterministic assessment of whether a source already exhibits writing texture
// that should constrain rewrite breadth. This is NOT an authorship detector.
// It estimates preservation priority from measured family fit, organic variation,
// scholarly trace and the absence/presence of synthetic discourse burden.

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

function severityWeight(signal) {
  if (signal?.severity === "high") return 3;
  if (signal?.severity === "medium") return 1.5;
  return 0.75;
}

function syntheticBurden(diagnostics, sentenceCount) {
  const architecture = diagnostics?.discourse_architecture?.signals || [];
  const discourse = diagnostics?.qualitative_human_discourse?.signals || [];
  const contrastive = diagnostics?.contrastive_language?.signals || [];
  const scaffolding = diagnostics?.rhetorical_scaffolding || [];
  const cohesion = diagnostics?.cohesion || [];

  const weighted = [
    ...architecture.map((s) => severityWeight(s) * 1.35),
    ...discourse.map((s) => severityWeight(s)),
    ...contrastive.map((s) => severityWeight(s) * 0.8),
  ].reduce((a, b) => a + b, 0) + scaffolding.length * 0.45 + cohesion.length * 0.35;

  // Scale burden by document size so one local issue in a long, otherwise organic
  // document does not automatically erase preservation priority.
  const denominator = Math.max(5, sentenceCount / 4);
  const burdenRatio = weighted / denominator;
  const lowSyntheticScore = clamp01(1 - burdenRatio / 2.4);
  const architectureHighCount = architecture.filter((s) => s?.severity === "high").length;
  const discourseHighCount = discourse.filter((s) => s?.severity === "high").length;
  const contrastiveHighCount = contrastive.filter((s) => s?.severity === "high").length;

  return {
    weighted_score: Number(weighted.toFixed(3)),
    burden_ratio: Number(burdenRatio.toFixed(3)),
    low_synthetic_score: Number(lowSyntheticScore.toFixed(3)),
    high_signal_count: architectureHighCount + discourseHighCount + contrastiveHighCount,
    architecture_high_count: architectureHighCount,
    discourse_high_count: discourseHighCount,
    contrastive_high_count: contrastiveHighCount,
    architecture_signal_count: architecture.length,
    discourse_signal_count: discourse.length,
    contrastive_signal_count: contrastive.length,
  };
}

function cadenceFit(cadenceDeviation) {
  if (!cadenceDeviation?.available) return 0.5;
  if (cadenceDeviation.threshold_flagged) return 0.2;
  if (cadenceDeviation.range_position === "within_observed_range") return 1;
  return 0.7;
}

function paragraphOrganicity(diagnostics) {
  const blocks = (diagnostics?.text_structure?.blocks || []).filter(
    (block) => block.type === "paragraph" && Number(block.wordCount) >= 8
  );
  if (blocks.length < 3) return 0.55;
  const lengths = blocks.map((block) => Number(block.wordCount) || 0);
  const m = mean(lengths);
  const cv = m ? stddev(lengths) / m : 0;

  let score = 0.7;
  if (cv >= 0.22 && cv <= 0.95) score = 1;
  else if (cv >= 0.14) score = 0.82;
  else if (cv >= 0.08) score = 0.55;
  else score = 0.3;
  return Number(score.toFixed(3));
}

function scholarlyTrace(text, sentenceCount) {
  const source = String(text || "");
  const citationHits = (source.match(/\([^()\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^()\n]*\)/g) || []).length;
  const attributionHits = (source.match(/\b(?:argues?|argued|observes?|observed|notes?|noted|finds?|found|according to|drawing on|with reference to)\b/gi) || []).length;
  const density = sentenceCount ? (citationHits + attributionHits * 0.5) / sentenceCount : 0;
  if (citationHits >= 3 && density >= 0.08) return 1;
  if (citationHits >= 1) return 0.78;
  if (attributionHits >= 2) return 0.68;
  return 0.5;
}

function measuredFamilyFit(languageDeviation) {
  const alignment = Number(languageDeviation?.family_alignment_score);
  if (Number.isFinite(alignment)) return clamp01(alignment);
  return 0.5;
}

function labelFor(score) {
  if (score >= 0.66) return "strong_existing_texture";
  if (score >= 0.50) return "mixed_existing_texture";
  return "weak_or_synthetic_texture";
}

function preservationPriority(score, burden, cadenceDeviation) {
  // High preservation is deliberately multi-signal. A human-like academic text
  // can contain isolated features that a contrastive detector labels strongly;
  // one such flag must not veto the entire document. Strong architecture burden,
  // conservative cadence deviation, or a poor composite texture score can veto it.
  const architectureVeto = burden.architecture_high_count >= 2 || burden.architecture_signal_count >= 4;
  const burdenAcceptable = burden.low_synthetic_score >= 0.34;

  if (
    score >= 0.60 &&
    !architectureVeto &&
    burdenAcceptable &&
    !cadenceDeviation?.threshold_flagged
  ) return "high";
  if (score >= 0.44 && burden.architecture_high_count <= 2) return "medium";
  return "low";
}

export function assessAuthorialTexture({ text, diagnostics, cadenceDeviation, languageDeviation } = {}) {
  const sentenceCount = splitSentences(text || "").length;
  const burden = syntheticBurden(diagnostics, sentenceCount);
  const components = {
    low_synthetic_burden: burden.low_synthetic_score,
    cadence_fit: cadenceFit(cadenceDeviation),
    measured_family_fit: measuredFamilyFit(languageDeviation),
    paragraph_organicity: paragraphOrganicity(diagnostics),
    scholarly_trace: scholarlyTrace(text, sentenceCount),
  };

  const score = clamp01(
    components.low_synthetic_burden * 0.30 +
    components.cadence_fit * 0.20 +
    components.measured_family_fit * 0.20 +
    components.paragraph_organicity * 0.15 +
    components.scholarly_trace * 0.15
  );
  const priority = preservationPriority(score, burden, cadenceDeviation);

  return {
    version: "authorial-texture-v1.2",
    score: Number(score.toFixed(3)),
    label: labelFor(score),
    preservation_priority: priority,
    recommended_breadth: priority === "high" ? "targeted" : priority === "medium" ? "selective" : "broad_if_diagnosed",
    components,
    synthetic_burden: burden,
    evidence: {
      sentence_count: sentenceCount,
      cadence_range_position: cadenceDeviation?.range_position || "unavailable",
      cadence_threshold_flagged: Boolean(cadenceDeviation?.threshold_flagged),
      measured_family_alignment: Number.isFinite(Number(languageDeviation?.family_alignment_score))
        ? Number(languageDeviation.family_alignment_score)
        : null,
      measured_family_available: Boolean(languageDeviation?.available),
    },
    note: "This score estimates how strongly the source's existing academic texture should be preserved. It does not establish whether a human or an AI authored the text; isolated detector-like features do not override the document-level evidence by themselves.",
  };
}
