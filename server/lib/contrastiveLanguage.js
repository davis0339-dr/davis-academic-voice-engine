// Contrastive academic-language diagnostics.
//
// This module compares a passage with the measured HUMAN academic-language
// family and with a conservative catalog of recurrent machine-associated
// rhetorical tendencies. It is a revision aid, not an AI detector and not an
// authorship classifier. Signals are only used to identify writing behaviours
// that may deserve reconstruction while preserving facts, citations, section
// logic, technical terms and epistemic stance.

import { measureLanguageFingerprint } from "./languageFingerprint.js";
import { compileMeasuredLanguageFamily } from "./languageFamilyEngine.js";
import { analyseHumanDiscourse } from "./humanDiscourse.js";
import { AI_TREND_CATALOG_VERSION, trendById } from "../data/aiTrendCatalog.js";

const PARTICIPIAL_TAIL_RE = /,\s+(?:(?:thereby|thus)\s+)?(?:underscoring|highlighting|reflecting|demonstrating|indicating|suggesting|reinforcing|emphasising|emphasizing|illustrating|showing)\b/gi;
const THROAT_CLEARING_RE = /\b(?:it is important to note that|it is worth noting that|it should be emphasised that|it should be emphasized that|it is pertinent to note that|it is crucial to note that)\b/gi;
const BALANCED_PAIR_RE = /\bnot only\b[^.!?]{0,120}\bbut also\b/gi;

function regexCount(text, regex) {
  const re = new RegExp(regex.source, regex.flags);
  return (String(text || "").match(re) || []).length;
}

function addSignal(signals, id, severity, evidence, humanReference = null) {
  const trend = trendById(id);
  if (!trend) return;
  signals.push({
    id,
    severity,
    label: trend.label,
    interpretation: trend.description,
    action: trend.repair,
    evidence,
    human_reference: humanReference,
  });
}

function summaryFor(family, metric) {
  return family?.metrics?.[metric] || null;
}

function highRelative(value, summary, multiplier = 1.25) {
  return summary && Number.isFinite(value) && Number.isFinite(summary.q75) && value > summary.q75 * multiplier;
}

function lowRelative(value, summary, multiplier = 0.75) {
  return summary && Number.isFinite(value) && Number.isFinite(summary.q25) && value < summary.q25 * multiplier;
}

export function assessContrastiveLanguage(text, options = {}) {
  const source = String(text || "");
  const fingerprint = options.fingerprint || measureLanguageFingerprint(source);
  const discourse = options.humanDiscourse || analyseHumanDiscourse(source);
  const family = options.humanFamily || compileMeasuredLanguageFamily(options.styleFilters || {});
  const signals = [];

  const sentenceSd = summaryFor(family, "sentence_sd");
  if (fingerprint.sentence_count >= 8 && lowRelative(fingerprint.sentence_sd, sentenceSd, 0.72)) {
    addSignal(signals, "mechanically_even_cadence", "high", {
      sentence_sd: fingerprint.sentence_sd,
      sentence_count: fingerprint.sentence_count,
    }, sentenceSd);
  }

  const repeatedFourgram = summaryFor(family, "repeated_content_4gram_per_1k");
  if (highRelative(fingerprint.repeated_content_4gram_per_1k, repeatedFourgram, 1.3)) {
    addSignal(signals, "repeated_clause_architecture", "high", {
      repeated_content_4gram_per_1k: fingerprint.repeated_content_4gram_per_1k,
    }, repeatedFourgram);
  }

  const topTransition = summaryFor(family, "top_transition_share");
  if (fingerprint.transition_per_100_sent > 0 && highRelative(fingerprint.top_transition_share, topTransition, 1.25)) {
    addSignal(signals, "over_concentrated_transition_vocabulary", "medium", {
      top_transition_share: fingerprint.top_transition_share,
      transition_per_100_sent: fingerprint.transition_per_100_sent,
    }, topTransition);
  }

  const discourseSignals = new Map((discourse?.signals || []).map((signal) => [signal.issue, signal]));
  if (discourseSignals.has("over_signposted_cohesion")) {
    addSignal(signals, "over_signposted_progression", "medium", {
      explicit_link_ratio: discourse.metrics?.explicit_link_ratio,
      local_dependency_ratio: discourse.metrics?.local_dependency_ratio,
    });
  }

  if (discourseSignals.has("generic_evidence_interpretation_bridge")) {
    addSignal(signals, "generic_evidence_bridge", "medium", {
      generic_evidence_bridge_count: discourse.metrics?.generic_evidence_bridge_count,
    });
  }

  if (discourseSignals.has("evidence_stacking")) {
    addSignal(signals, "serial_evidence_catalogue", "medium", {
      max_consecutive_evidence_sentences: discourse.metrics?.max_consecutive_evidence_sentences,
      evidence_followed_by_interpretation_ratio: discourse.metrics?.evidence_followed_by_interpretation_ratio,
    });
  }

  if (discourseSignals.has("repeated_paragraph_logic")) {
    addSignal(signals, "repeated_paragraph_recipe", "high", {
      repeated_paragraph_signature_max: discourse.metrics?.repeated_paragraph_signature_max,
      paragraph_move_signature_diversity: discourse.metrics?.paragraph_move_signature_diversity,
    });
  }

  const participialTails = regexCount(source, PARTICIPIAL_TAIL_RE);
  if (participialTails >= 3) {
    addSignal(signals, "participial_tail_repetition", "medium", { count: participialTails });
  }

  const throatClearing = regexCount(source, THROAT_CLEARING_RE);
  if (throatClearing >= 2) {
    addSignal(signals, "formulaic_metadiscourse", "medium", { count: throatClearing });
  }

  const balancedPairs = regexCount(source, BALANCED_PAIR_RE);

  const weights = { high: 1, medium: 0.55, low: 0.25 };
  const rawPressure = signals.reduce((sum, signal) => sum + (weights[signal.severity] || 0.25), 0);
  const contrastivePressure = Number(Math.min(1, rawPressure / 5).toFixed(3));

  return {
    measurement_version: "contrastive-language-v1",
    trend_catalog_version: AI_TREND_CATALOG_VERSION,
    authorship_inference: false,
    purpose: "revision_quality_only",
    human_reference: {
      measurement_version: family?.measurement_version || null,
      measured_document_count: family?.measured_document_count || 0,
      evidence_strength: family?.evidence_strength || "pilot-insufficient",
      effective_label: family?.effective_label || null,
    },
    observed_surface_counts: {
      participial_tail_count: participialTails,
      throat_clearing_count: throatClearing,
      not_only_but_also_count: balancedPairs,
    },
    signals,
    contrastive_pressure: contrastivePressure,
    recommendations: signals.map((signal) => signal.action),
    guardrails: [
      "Do not infer AI authorship from these signals.",
      "Do not change facts, citations, numeric values, study stage, technical terms or claim direction to reduce a stylistic signal.",
      "Do not manufacture randomness, grammar mistakes or awkwardness to imitate a human writer.",
      "Do not invert every machine-associated tendency mechanically; revise only where the diagnosed pattern actually harms the prose.",
      "Prefer the measured human academic family and the source's rhetorical purpose over detector-oriented optimisation.",
    ],
  };
}
