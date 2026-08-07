// Phase 2 "corpus runtime" (Section 25 Phase 2 / Section 10.1 point 14):
// real coverage-density calculation and a hierarchical style-family
// compiler over the actual 52-document evidence base, replacing Phase 1's
// two hand-typed profile rows.
//
// The strength thresholds below are a configurable research parameter,
// NOT an empirically calibrated constant -- Section 10.2 explicitly warns
// against pretending otherwise. They exist so the fallback ladder has
// somewhere to stop; change them in one place if the product team later
// calibrates against human review (Section 21.3).

import { CORPUS_DOCUMENTS } from "../data/corpusDocuments.js";

export const STRENGTH_THRESHOLDS = Object.freeze({
  insufficient: 0, // count < emergingAt
  emergingAt: 3,
  supportedAt: 8,
});

// Order in which dimensions are dropped when the requested cell has too few
// independent sources -- narrowest/most identity-revealing first, matching
// the worked example in Section 7.2 (drop section/institution-level detail
// before dropping discipline, degree, region or document type).
const FALLBACK_ORDER = ["section", "research_mode", "discipline", "degree", "region", "document_type"];

// The corpus note records evidence at document level, not section level --
// no document in corpusDocuments.js carries a `section` field. A `section`
// filter is therefore never used to narrow the match set; it's dropped
// immediately (documented, not silently ignored) if present.
const MATCHABLE_DIMENSIONS = ["document_type", "region", "degree", "discipline", "research_mode"];

function docMatchesDimension(doc, dimension, value) {
  if (!value) return true;
  switch (dimension) {
    case "document_type":
      return doc.documentType === value;
    case "region":
      return doc.region === value;
    case "degree":
      return doc.degree === value;
    case "discipline":
      return Array.isArray(doc.discipline) && doc.discipline.includes(value);
    case "research_mode":
      return doc.researchMode === value;
    default:
      return true;
  }
}

function matchDocuments(filters) {
  const included = CORPUS_DOCUMENTS.filter((d) => d.included);
  return included.filter((doc) =>
    MATCHABLE_DIMENSIONS.every((dim) => docMatchesDimension(doc, dim, filters[dim]))
  );
}

export function computeStrength(count) {
  if (count >= STRENGTH_THRESHOLDS.supportedAt) return "supported";
  if (count >= STRENGTH_THRESHOLDS.emergingAt) return "emerging";
  return "insufficient";
}

function summarizeMatches(matches) {
  const provenanceMix = {};
  const qualityMix = {};
  const cadenceMeans = [];
  const cadencePctLong = [];
  const cadenceSds = [];
  for (const doc of matches) {
    provenanceMix[doc.provenanceTier] = (provenanceMix[doc.provenanceTier] || 0) + 1;
    qualityMix[doc.quality] = (qualityMix[doc.quality] || 0) + 1;
    if (doc.cadence) {
      cadenceMeans.push(doc.cadence.mean);
      // pctLong is >=30-word sentences, matching the corpus note's own
      // measurement methodology (Batches 1-7 quantitative tables).
      if (typeof doc.cadence.pctLong === "number") cadencePctLong.push(doc.cadence.pctLong);
      // sd is the corpus note's own per-document sentence-length standard
      // deviation -- the direct measure of how much real human academic
      // prose varies sentence to sentence ("burstiness"). This is the
      // property AI text is flattest on, so it's the one the rewrite
      // engine should actively target when naturalising toward the family.
      if (typeof doc.cadence.sd === "number") cadenceSds.push(doc.cadence.sd);
    }
  }
  const cadence =
    cadenceMeans.length > 0
      ? {
          measuredSources: cadenceMeans.length,
          meanSentenceLengthMin: Math.min(...cadenceMeans),
          meanSentenceLengthMax: Math.max(...cadenceMeans),
          pctLongMin: cadencePctLong.length > 0 ? Math.min(...cadencePctLong) : null,
          pctLongMax: cadencePctLong.length > 0 ? Math.max(...cadencePctLong) : null,
          sdMin: cadenceSds.length > 0 ? Math.min(...cadenceSds) : null,
          sdMax: cadenceSds.length > 0 ? Math.max(...cadenceSds) : null,
        }
      : { measuredSources: 0, meanSentenceLengthMin: null, meanSentenceLengthMax: null, pctLongMin: null, pctLongMax: null, sdMin: null, sdMax: null };
  return { provenanceMix, qualityMix, cadence };
}

function describeFilters(filters) {
  const parts = Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? parts.join(", ") : "(no filters -- broadest evidence-backed default)";
}

// Section 7.2's hierarchical fallback, implemented as a real ladder over
// real counts instead of a fixed two-tier lookup table.
export function compileFamily(requestedFilters) {
  const requested = Object.fromEntries(Object.entries(requestedFilters || {}).filter(([, v]) => v));
  const droppedSteps = [];

  // `section` is never matchable against this corpus (see note above); if
  // present, record it as dropped immediately so the caller sees why.
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
    const dim = droppable[cursor];
    cursor += 1;
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
      ? `Requested profile: ${describeFilters(requested)}. Evidence too sparse at that granularity (or corpus doesn't track it) -- backed off: ${droppedSteps
          .map((s) => `dropped ${s.dimension}="${s.value}"`)
          .join("; ")}. Using ${describeFilters(working)} (${matches.length} independent sources, ${strength}).`
      : `Requested profile matches an evidence-backed cell directly: ${describeFilters(working)} (${matches.length} independent sources, ${strength}).`,
  };
}

export function listCoverageTable() {
  const included = CORPUS_DOCUMENTS.filter((d) => d.included);
  const dims = { document_type: "documentType", region: "region", degree: "degree", research_mode: "researchMode" };
  const table = {};
  for (const [label, field] of Object.entries(dims)) {
    const counts = {};
    for (const doc of included) {
      const val = doc[field];
      counts[val] = (counts[val] || 0) + 1;
    }
    table[label] = Object.entries(counts)
      .map(([value, count]) => ({ value, count, strength: computeStrength(count) }))
      .sort((a, b) => b.count - a.count);
  }
  // discipline is multi-valued per document
  const disciplineCounts = {};
  for (const doc of included) {
    for (const d of doc.discipline || []) {
      disciplineCounts[d] = (disciplineCounts[d] || 0) + 1;
    }
  }
  table.discipline = Object.entries(disciplineCounts)
    .map(([value, count]) => ({ value, count, strength: computeStrength(count) }))
    .sort((a, b) => b.count - a.count);

  return {
    totalIncluded: included.length,
    totalReceived: CORPUS_DOCUMENTS.length,
    table,
    thresholds: STRENGTH_THRESHOLDS,
  };
}
