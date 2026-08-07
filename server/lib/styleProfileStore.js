// Evidence-backed multidimensional style engine.
// Phase 2 provides coverage/fallback over the 52-document corpus.
// Phase 4 adds a measured language-behaviour layer derived from substantive
// prose samples in a clean-text pilot subset, so style profiles carry real
// distributions rather than cadence plus generic prose advice alone.

import { compileFamily, listCoverageTable as coverageTable } from "./corpusEngine.js";
import { compileMeasuredLanguageFamily } from "./languageFamilyEngine.js";

const SELECTABLE_DIMENSIONS = {
  document_type: ["thesis", "journal_article", "conference_paper", "other"],
  region: ["UK", "North America", "Europe (non-UK)", "Sub-Saharan Africa", "Asia", "Australasia", "Other/unspecified"],
  degree: ["PhD", "DBA", "MPhil", "MSc/MCom/MA", "Other"],
  discipline: ["Accounting", "Finance", "Economics", "Management", "Psychology", "Information Technology", "Sport Science", "Other"],
  research_mode: ["quantitative_archival", "survey", "qualitative_interview_case_study", "mixed_methods", "archival_history", "experimental", "conceptual", "software_design", "other"],
  section: ["abstract", "introduction", "background", "statement_of_problem", "literature_review", "theory", "methodology", "results", "discussion", "limitations", "conclusion", "preface_reflexive"],
};

function cadenceDescription(cadence) {
  if (!cadence || cadence.measuredSources === 0) {
    return "No sentence-length measurements are available for this exact family. Do not impose a universal sentence-length target; use the measured language family and the author's passage-level needs instead.";
  }
  return `Across ${cadence.measuredSources} independently measured sources in this family, mean sentence length ranges from ${cadence.meanSentenceLengthMin.toFixed(1)} to ${cadence.meanSentenceLengthMax.toFixed(1)} words. Treat this as descriptive evidence, not a fixed target.`;
}

const STATIC_FEATURES = {
  cohesion: "Explicit transition frequency is author-dependent. Diagnose mechanical repetition and weak logical progression rather than enforcing or banning transition words generally.",
  researcher_presence: "First-person singular, first-person plural, and impersonal/study-centred voice are all attested. Preserve legitimate document/section voice unless the user asks to change it.",
  epistemic_stance: "Qualification should follow the underlying claim, evidence and inferential limits. Do not manufacture hedging merely to match a frequency profile.",
  citation_integration: "Narrative and parenthetical citation forms both occur. Preserve citation-content relationships and allow author reasoning between cited statements.",
  lexical_register: "Technical terminology is repeated for precision. Vary sentence construction and ordinary phrasing before substituting discipline-specific terms.",
  grammar_tolerance: "The corpus contains both polished and uneven prose. Never inject errors; apply the user's grammar intensity while retaining plausible personal cadence.",
};

export function listSelectableDimensions() {
  return SELECTABLE_DIMENSIONS;
}

export function listCoverageTable() {
  return {
    metadata_corpus: coverageTable(),
    measured_language_pilot: compileMeasuredLanguageFamily({}),
  };
}

export function resolveProfile(requestedFilters) {
  const compiled = compileFamily(requestedFilters);
  const measuredLanguage = compileMeasuredLanguageFamily(compiled.effective);

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
      language_evidence: {
        measured_document_count: measuredLanguage.measured_document_count,
        strength: measuredLanguage.evidence_strength,
        fallback_applied: measuredLanguage.fallback_applied,
        effective_filters: measuredLanguage.effective,
        dropped: measuredLanguage.dropped,
        measurement_version: measuredLanguage.measurement_version,
      },
      features: {
        cadence: cadenceDescription(compiled.cadence),
        measured_language: measuredLanguage,
        ...STATIC_FEATURES,
      },
    },
    measured_language_family: measuredLanguage,
    fallback_applied: compiled.fallback_applied || measuredLanguage.fallback_applied,
    evidence_strength: compiled.evidence_strength,
    message: `${compiled.message} Measured language layer: ${measuredLanguage.measured_document_count} pilot documents (${measuredLanguage.evidence_strength}) using ${measuredLanguage.effective_label}.`,
    dropped: [...compiled.dropped, ...measuredLanguage.dropped.map((d) => ({ ...d, layer: "measured_language" }))],
  };
}

export function listProfiles() {
  return listCoverageTable();
}
