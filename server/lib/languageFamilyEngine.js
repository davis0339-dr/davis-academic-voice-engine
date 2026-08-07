import { CORPUS_LANGUAGE_PROFILES } from "../data/corpusLanguageProfiles.js";
import { LANGUAGE_FINGERPRINT_METRICS } from "./languageFingerprint.js";

const MATCHABLE_DIMENSIONS = ["document_type", "region", "degree", "discipline", "research_mode"];
const FALLBACK_ORDER = ["research_mode", "discipline", "degree", "region", "document_type"];

function matchesDimension(profile, dimension, value) {
  if (!value) return true;
  if (dimension === "discipline") return Array.isArray(profile.discipline) && profile.discipline.includes(value);
  return profile[dimension] === value;
}

function matchProfiles(filters) {
  return CORPUS_LANGUAGE_PROFILES.filter((profile) =>
    MATCHABLE_DIMENSIONS.every((dimension) => matchesDimension(profile, dimension, filters?.[dimension]))
  );
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function summariseMetric(profiles, metric) {
  const values = profiles.map((p) => p.features?.[metric]).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    n: values.length,
    min: Number(Math.min(...values).toFixed(4)),
    q25: Number(quantile(values, 0.25).toFixed(4)),
    median: Number(quantile(values, 0.5).toFixed(4)),
    q75: Number(quantile(values, 0.75).toFixed(4)),
    max: Number(Math.max(...values).toFixed(4)),
    mean: Number(mean.toFixed(4)),
  };
}

function describeFilters(filters) {
  const parts = Object.entries(filters || {}).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`);
  return parts.length ? parts.join(", ") : "broad pilot corpus";
}

export function compileMeasuredLanguageFamily(filters = {}) {
  const requested = Object.fromEntries(Object.entries(filters).filter(([key, value]) => MATCHABLE_DIMENSIONS.includes(key) && value));
  const effective = { ...requested };
  const dropped = [];

  let profiles = matchProfiles(effective);
  let cursor = 0;
  while (profiles.length < 3 && cursor < FALLBACK_ORDER.length) {
    const dimension = FALLBACK_ORDER[cursor++];
    if (!effective[dimension]) continue;
    dropped.push({ dimension, value: effective[dimension], reason: "fewer than 3 measured pilot documents" });
    delete effective[dimension];
    profiles = matchProfiles(effective);
  }

  if (profiles.length < 3) {
    profiles = [...CORPUS_LANGUAGE_PROFILES];
    for (const [dimension, value] of Object.entries(effective)) {
      dropped.push({ dimension, value, reason: "pilot coverage too sparse; using broad measured language corpus" });
    }
    Object.keys(effective).forEach((key) => delete effective[key]);
  }

  const metrics = {};
  for (const metric of LANGUAGE_FINGERPRINT_METRICS) {
    const summary = summariseMetric(profiles, metric);
    if (summary) metrics[metric] = summary;
  }

  const evidenceStrength = profiles.length >= 8 ? "pilot-supported" : profiles.length >= 3 ? "pilot-emerging" : "pilot-insufficient";
  return {
    measurement_version: "language-family-pilot-v1",
    requested,
    effective,
    effective_label: describeFilters(effective),
    measured_document_count: profiles.length,
    evidence_strength: evidenceStrength,
    fallback_applied: dropped.length > 0,
    dropped,
    source_ids: profiles.map((p) => p.id),
    metrics,
    caution: "These are descriptive distributions from a ten-document clean-text pilot subset of the larger corpus. They guide editing choices but are not universal thresholds or authorship scores.",
  };
}

function compareLow(value, summary, multiplier = 0.8) {
  return summary && Number.isFinite(value) && value < summary.q25 * multiplier;
}

function compareHigh(value, summary, multiplier = 1.25) {
  return summary && Number.isFinite(value) && value > summary.q75 * multiplier;
}

function deviationEntry(metric, value, summary, direction, severity, interpretation, action) {
  return {
    metric,
    value,
    family_q25: summary.q25,
    family_median: summary.median,
    family_q75: summary.q75,
    direction,
    severity,
    interpretation,
    action,
  };
}

export function assessLanguageDeviation(fingerprint, family) {
  if (!fingerprint || !family?.metrics) {
    return { available: false, signals: [], recommendations: [], family_alignment_score: null };
  }

  const m = family.metrics;
  const signals = [];

  if (compareLow(fingerprint.sentence_sd, m.sentence_sd, 0.72) && fingerprint.sentence_count >= 8) {
    signals.push(deviationEntry("sentence_sd", fingerprint.sentence_sd, m.sentence_sd, "low", "high", "Sentence lengths vary much less than the measured academic family, producing a mechanically even rhythm.", "Vary sentence architecture and length across neighbouring sentences; retain some long analytical sentences while allowing occasional concise statements."));
  }

  if (compareLow(fingerprint.sentence_initial_diversity, m.sentence_initial_diversity, 0.82) && fingerprint.sentence_count >= 8) {
    signals.push(deviationEntry("sentence_initial_diversity", fingerprint.sentence_initial_diversity, m.sentence_initial_diversity, "low", "high", "Too many sentences begin from similar lexical/grammatical positions.", "Rebuild selected sentences around different grammatical subjects, fronted conditions, evidence, time/place frames, or subordinate clauses where logically appropriate."));
  }

  if (compareHigh(fingerprint.top_transition_share, m.top_transition_share, 1.25) && fingerprint.transition_per_100_sent >= (m.transition_per_100_sent?.median || 0)) {
    signals.push(deviationEntry("top_transition_share", fingerprint.top_transition_share, m.top_transition_share, "high", "medium", "A small number of explicit connectives carry too much of the passage's cohesion.", "Reduce repeated connective-led openings and let topic continuity, evidence relations and clause structure carry more of the progression."));
  }

  if (compareHigh(fingerprint.repeated_content_4gram_per_1k, m.repeated_content_4gram_per_1k, 1.35)) {
    signals.push(deviationEntry("repeated_content_4gram_per_1k", fingerprint.repeated_content_4gram_per_1k, m.repeated_content_4gram_per_1k, "high", "high", "Non-trivial multiword content sequences repeat more heavily than in the measured family.", "Reconstruct repeated non-technical phrase frames and clause sequences while preserving required technical terminology and citations."));
  }

  if (compareHigh(fingerprint.study_centered_per_1k, m.study_centered_per_1k, 1.55) && fingerprint.study_centered_per_1k > 3) {
    signals.push(deviationEntry("study_centered_per_1k", fingerprint.study_centered_per_1k, m.study_centered_per_1k, "high", "medium", "Study-centred subjects recur unusually often in this passage.", "Where meaning permits, vary the grammatical focus toward the evidence, construct, context or analytical relationship rather than repeatedly opening with 'this study/the study'."));
  }

  if (compareHigh(fingerprint.nominalisation_per_1k, m.nominalisation_per_1k, 1.25)) {
    signals.push(deviationEntry("nominalisation_per_1k", fingerprint.nominalisation_per_1k, m.nominalisation_per_1k, "high", "low", "The prose is unusually noun-heavy relative to the measured family.", "Convert some non-technical nominalisations into verbs where this improves clarity; keep discipline terms stable."));
  }

  const paragraphCV = fingerprint.paragraph_mean_words ? fingerprint.paragraph_sd_words / fingerprint.paragraph_mean_words : null;
  const familyParagraphMedian = m.paragraph_mean_words?.median || null;
  if (fingerprint.paragraph_count >= 4 && paragraphCV !== null && paragraphCV < 0.16 && familyParagraphMedian && fingerprint.paragraph_mean_words > 45) {
    signals.push({
      metric: "paragraph_shape_variation",
      value: Number(paragraphCV.toFixed(3)),
      direction: "low",
      severity: "medium",
      interpretation: "Paragraphs are unusually similar in size, which can make section development feel templated.",
      action: "Let paragraph length follow argumentative function rather than equalising paragraph size; merge or divide only where the logic supports it.",
    });
  }

  const severityWeight = { high: 1, medium: 0.6, low: 0.3 };
  const penalty = signals.reduce((sum, s) => sum + (severityWeight[s.severity] || 0.3), 0);
  const alignment = Math.max(0, 1 - penalty / 5);

  return {
    available: true,
    measurement_version: family.measurement_version,
    family_document_count: family.measured_document_count,
    family_evidence_strength: family.evidence_strength,
    signals,
    recommendations: signals.map((s) => s.action),
    preserve_not_targeted: [
      "Do not normalise first-person versus impersonal voice solely to match a family median.",
      "Do not insert or remove hedging merely to match a frequency range; epistemic caution must follow the claim and evidence.",
      "Do not alter citation density or narrative/parenthetical citation form solely for stylistic alignment.",
      "Do not force active/passive balance to a numeric target; use voice according to emphasis and disciplinary convention.",
    ],
    family_alignment_score: Number(alignment.toFixed(3)),
  };
}
