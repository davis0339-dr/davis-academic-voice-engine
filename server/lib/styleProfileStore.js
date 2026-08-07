// Section 7 (evidence-backed multidimensional style engine). Phase 2:
// this is now a thin adapter over server/lib/corpusEngine.js, which does
// the real per-cell counting and hierarchical fallback over the 52-document
// evidence base (server/data/corpusDocuments.js) -- see Section 7.2's
// mandate that a narrow style claim must never be invented from
// convenience, and Section 10.2's warning against pretending an
// uncalibrated threshold is validated.
//
// Downstream code (server/lib/pipeline.js) only depends on the shape
// { requested, effective, fallback_applied, evidence_strength, message },
// which is preserved from the Phase 1 interface so this swap doesn't
// ripple through the rest of the pipeline.

import { compileFamily, listCoverageTable as coverageTable } from "./corpusEngine.js";

const SELECTABLE_DIMENSIONS = {
  document_type: ["thesis", "journal_article", "conference_paper", "other"],
  region: ["UK", "North America", "Europe (non-UK)", "Sub-Saharan Africa", "Asia", "Australasia", "Other/unspecified"],
  degree: ["PhD", "DBA", "MPhil", "MSc/MCom/MA", "Other"],
  discipline: ["Accounting", "Finance", "Economics", "Management", "Psychology", "Information Technology", "Sport Science", "Other"],
  research_mode: ["quantitative_archival", "survey", "qualitative_interview_case_study", "mixed_methods", "archival_history", "experimental", "conceptual", "software_design", "other"],
  section: ["abstract", "introduction", "literature_review", "theory", "methodology", "results", "discussion", "limitations", "conclusion", "preface_reflexive"],
};

function cadenceDescription(cadence) {
  if (!cadence || cadence.measuredSources === 0) {
    return "No sentence-length measurements available for this exact family; corpus-wide finding still applies: there is no single human sentence-length template (Section 9.1) -- do not enforce a fixed threshold.";
  }
  return `Across ${cadence.measuredSources} independently measured sources in this family, mean sentence length ranges from ${cadence.meanSentenceLengthMin.toFixed(1)} to ${cadence.meanSentenceLengthMax.toFixed(1)} words. Treat this as a descriptive range, not a target -- both ends are legitimate academic prose.`;
}

const STATIC_FEATURES = {
  cohesion: "Explicit transition frequency is author-dependent, not a family-level rule. Detect mechanical stacking of the same connective; do not enforce or ban transitions generally.",
  researcher_presence: "First-person singular, first-person plural, and impersonal/study-centred voice are all attested across this corpus, including within single multi-chapter dissertations. Do not mechanically normalise pronoun choice.",
  epistemic_stance: "Credible sources in this corpus hedge through modal verbs, interpretive verbs, and explicit comparison with prior findings -- and state disagreement with prior literature directly rather than smoothing it away.",
  citation_integration: "Numeric results are frequently interpreted in ordinary prose immediately after being reported; both narrative and parenthetical citation forms occur. Not every sentence needs a citation.",
  lexical_register: "Technical/discipline terminology is repeated for precision across this corpus rather than varied for its own sake. Resist gratuitous synonym substitution of domain terms.",
  grammar_tolerance: "High polish and ordinary grammatical/collocational unevenness both occur in credible sources in this corpus. Never inject errors to simulate humanity; never treat flawless grammar as suspicious.",
};

export function listSelectableDimensions() {
  return SELECTABLE_DIMENSIONS;
}

export function listCoverageTable() {
  return coverageTable();
}

export function resolveProfile(requestedFilters) {
  const compiled = compileFamily(requestedFilters);

  const label = Object.keys(compiled.effective).length === 0 ? "Auto / Evidence-backed default" : compiled.effectiveLabel;

  return {
    requested: compiled.requested,
    effective: {
      label,
      filters: compiled.effective,
      evidence: {
        independent_source_count: compiled.matchCount,
        provenance_mix: compiled.provenance_mix,
        quality_mix: compiled.quality_mix,
        strength: compiled.evidence_strength,
      },
      features: {
        cadence: cadenceDescription(compiled.cadence),
        ...STATIC_FEATURES,
      },
    },
    fallback_applied: compiled.fallback_applied,
    evidence_strength: compiled.evidence_strength,
    message: compiled.message,
    dropped: compiled.dropped,
  };
}

// Kept for any caller that still wants the old flat listing (e.g. a future
// admin view); Phase 2's real answer to "what profiles exist" is the
// coverage table, not a fixed list -- any filter combination is valid to
// request, the engine just tells you honestly how well-evidenced it is.
export function listProfiles() {
  const table = coverageTable();
  return table;
}
