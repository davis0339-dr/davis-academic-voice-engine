// Corpus runtime for evidence-backed style-family matching. Reference statistics
// are descriptive measurements from the supplied academic corpus, not authorship
// classifiers and not compulsory generation targets.

import { CORPUS_DOCUMENTS } from "../data/corpusDocuments.js";

export const STRENGTH_THRESHOLDS = Object.freeze({
  insufficient: 0,
  emergingAt: 3,
  supportedAt: 8,
});

const FALLBACK_ORDER = ["section", "research_mode", "discipline", "degree", "region", "document_type"];
const MATCHABLE_DIMENSIONS = ["document_type", "region", "degree", "discipline", "research_mode"];

function docMatchesDimension(doc, dimension, value) {
  if (!value) return true;
  switch (dimension) {
    case "document_type": return doc.documentType === value;
    case "region": return doc.region === value;
    case "degree": return doc.degree === value;
    case "discipline": return Array.isArray(doc.discipline) && doc.discipline.includes(value);
    case "research_mode": return doc.researchMode === value;
    default: return true;
  }
}

function matchDocuments(filters) {
  return CORPUS_DOCUMENTS.filter((d) => d.included).filter((doc) =>
    MATCHABLE_DIMENSIONS.every((dim) => docMatchesDimension(doc, dim, filters[dim]))
  );
}

export function computeStrength(count) {
  if (count >= STRENGTH_THRESHOLDS.supportedAt) return "supported";
  if (count >= STRENGTH_THRESHOLDS.emergingAt) return "emerging";
  return "insufficient";
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function distribution(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return { n: 0, min: null, q1: null, median: null, q3: null, max: null };
  return {
    n: clean.length,
    min: round(Math.min(...clean)),
    q1: round(quantile(clean, 0.25)),
    median: round(quantile(clean, 0.50)),
    q3: round(quantile(clean, 0.75)),
    max: round(Math.max(...clean)),
  };
}

function summarizeMatches(matches) {
  const provenanceMix = {};
  const qualityMix = {};
  const means = [];
  const pctLong = [];
  const sds = [];
  const cvs = [];

  for (const doc of matches) {
    provenanceMix[doc.provenanceTier] = (provenanceMix[doc.provenanceTier] || 0) + 1;
    qualityMix[doc.quality] = (qualityMix[doc.quality] || 0) + 1;
    if (!doc.cadence) continue;
    const mean = Number(doc.cadence.mean);
    const sd = Number(doc.cadence.sd);
    const long = Number(doc.cadence.pctLong);
    if (Number.isFinite(mean)) means.push(mean);
    if (Number.isFinite(sd)) sds.push(sd);
    if (Number.isFinite(long)) pctLong.push(long);
    if (Number.isFinite(mean) && mean > 0 && Number.isFinite(sd)) cvs.push(sd / mean);
  }

  const meanRef = distribution(means);
  const longRef = distribution(pctLong);
  const sdRef = distribution(sds);
  const cvRef = distribution(cvs);

  return {
    provenanceMix,
    qualityMix,
    cadence: {
      measuredSources: means.length,
      meanSentenceLengthMin: meanRef.min,
      meanSentenceLengthMax: meanRef.max,
      pctLongMin: longRef.min,
      pctLongMax: longRef.max,
      sdMin: sdRef.min,
      sdMax: sdRef.max,
      reference: {
        mean_sentence_words: meanRef,
        sentence_length_sd: sdRef,
        sentence_length_cv: cvRef,
        long_sentence_share_percent: longRef,
      },
      interpretation: "Median and IQR are descriptive reference statistics from matched corpus documents. They are not quality cut-offs or rewrite targets.",
    },
  };
}

function describeFilters(filters) {
  const parts = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(", ") : "(no filters -- broadest evidence-backed default)";
}

export function compileFamily(requestedFilters) {
  const requested = Object.fromEntries(Object.entries(requestedFilters || {}).filter(([, v]) => v));
  const droppedSteps = [];
  const working = { ...requested };

  if (working.section) {
    droppedSteps.push({ dimension: "section", value: working.section, reason: "corpus does not track section-level evidence per document" });
    delete working.section;
  }

  let matches = matchDocuments(working);
  let strength = computeStrength(matches.length);
  const droppable = FALLBACK_ORDER.filter((d) => d !== "section");
  let cursor = 0;

  while (strength === "insufficient" && cursor < droppable.length) {
    const dim = droppable[cursor++];
    if (!working[dim]) continue;
    droppedSteps.push({ dimension: dim, value: working[dim], reason: "insufficient independent sources at the narrower cell" });
    delete working[dim];
    matches = matchDocuments(working);
    strength = computeStrength(matches.length);
  }

  const summary = summarizeMatches(matches);
  const fallbackApplied = droppedSteps.length > 0;

  return {
    requested,
    effective: working,
    effectiveLabel: describeFilters(working),
    matchCount: matches.length,
    evidence_strength: strength,
    fallback_applied: fallbackApplied,
    dropped: droppedSteps,
    provenance_mix: summary.provenanceMix,
    quality_mix: summary.qualityMix,
    cadence: summary.cadence,
    message: fallbackApplied
      ? `Requested profile: ${describeFilters(requested)}. Evidence too sparse at that granularity (or corpus does not track it) -- backed off: ${droppedSteps.map((s) => `dropped ${s.dimension}="${s.value}"`).join("; ")}. Using ${describeFilters(working)} (${matches.length} independent sources, ${strength}).`
      : `Requested profile matches an evidence-backed cell directly: ${describeFilters(working)} (${matches.length} independent sources, ${strength}).`,
  };
}

export function listCoverageTable() {
  const included = CORPUS_DOCUMENTS.filter((d) => d.included);
  const dims = { document_type: "documentType", region: "region", degree: "degree", research_mode: "researchMode" };
  const table = {};

  for (const [label, field] of Object.entries(dims)) {
    const counts = {};
    for (const doc of included) counts[doc[field]] = (counts[doc[field]] || 0) + 1;
    table[label] = Object.entries(counts).map(([value, count]) => ({ value, count, strength: computeStrength(count) })).sort((a, b) => b.count - a.count);
  }

  const disciplineCounts = {};
  for (const doc of included) {
    for (const d of doc.discipline || []) disciplineCounts[d] = (disciplineCounts[d] || 0) + 1;
  }
  table.discipline = Object.entries(disciplineCounts).map(([value, count]) => ({ value, count, strength: computeStrength(count) })).sort((a, b) => b.count - a.count);

  return { totalIncluded: included.length, totalReceived: CORPUS_DOCUMENTS.length, table, thresholds: STRENGTH_THRESHOLDS };
}
