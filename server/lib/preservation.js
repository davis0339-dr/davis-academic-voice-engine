// Pass E (preservation audit): deterministic checks that run after generation,
// independent of the model's own self-report.

import { extractProtectedSpans } from "./protect.js";
import { analyseRhetoricalSemanticPreservation } from "./rhetoricalPreservation.js";

function missingFrom(list, haystack) {
  return list.filter((item) => !haystack.includes(item));
}

function dedupe(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function extraNumericLike(sourceSpans, revisedSpans) {
  const sourceNumbers = new Set([
    ...sourceSpans.numbers,
    ...sourceSpans.monetary,
    ...sourceSpans.statNotation,
  ]);
  const revisedNumbers = [
    ...revisedSpans.numbers,
    ...revisedSpans.monetary,
    ...revisedSpans.statNotation,
  ];
  return revisedNumbers.filter((n) => !sourceNumbers.has(n));
}

const CITATION_YEAR_TOKEN = /(?:18|19|20)\d{2}[a-z]?|n\.d\.(?:-[a-z])?/gi;
const PAREN_GROUP = /\(([^()\n]{1,360})\)/g;
const LEADING_CITATION_CONNECTIVE = /^(?:because|although|though|while|whereas|since|however|therefore|thus|moreover|furthermore|additionally|consequently|nevertheless|nonetheless|similarly|likewise|conversely|notably|importantly|indeed)\s+/i;
const NARRATIVE_REFERENCE = /\b(?!(?:Because|Although|Though|While|Whereas|Since|However|Therefore|Thus|Moreover|Furthermore|Additionally|Consequently|Nevertheless|Nonetheless|Similarly|Likewise|Conversely|Notably|Importantly|Indeed)\b)([A-Z][A-Za-z'’.-]*(?:\s+(?:[A-Z][A-Za-z'’.-]*|and|&|of|the|for|in|on|et|al\.|\[[A-Z0-9&.\-]{2,12}\])){0,12})\s*\(((?:(?:18|19|20)\d{2}[a-z]?|n\.d\.(?:-[a-z])?)(?:\s*,\s*(?:(?:18|19|20)\d{2}[a-z]?|n\.d\.(?:-[a-z])?))*)\)/g;

function canonicalAuthor(author) {
  return String(author || "")
    .replace(/([A-Za-z])['’]s\b/g, "$1")
    .replace(/\[[A-Z0-9&.\-]{2,12}\]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\bet\s+al\.?/gi, " et al ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEADING_CITATION_CONNECTIVE, "")
    .trim()
    .toLowerCase();
}

function keysFromAuthorYears(author, years) {
  const canonical = canonicalAuthor(author);
  if (!canonical) return [];
  return dedupe((years || []).map((year) => `${canonical}|${year.toLowerCase()}`));
}

// Build citation identity from the raw passage, not from one visual citation
// form. Parenthetical (Author, 2020) and narrative Author (2020) are the same
// source and must not be reported as a dropped/new citation merely because the
// grammar changed around it. Leading discourse connectives such as “Because”
// are not part of the author identity.
function citationReferenceIndex(text) {
  const byKey = new Map();
  const source = String(text || "");

  let m;
  const parenthetical = new RegExp(PAREN_GROUP);
  while ((m = parenthetical.exec(source)) !== null) {
    const inside = m[1].trim();
    if (!/[A-Za-z]{2,}/.test(inside) || !CITATION_YEAR_TOKEN.test(inside)) {
      CITATION_YEAR_TOKEN.lastIndex = 0;
      continue;
    }
    CITATION_YEAR_TOKEN.lastIndex = 0;
    for (const segment of inside.split(/\s*;\s*/)) {
      const years = segment.match(CITATION_YEAR_TOKEN) || [];
      CITATION_YEAR_TOKEN.lastIndex = 0;
      if (!years.length) continue;
      const firstYear = new RegExp(CITATION_YEAR_TOKEN.source, "i").exec(segment);
      if (!firstYear) continue;
      const author = segment.slice(0, firstYear.index).replace(/[,(\s]+$/g, "").trim();
      for (const key of keysFromAuthorYears(author, years)) {
        if (!byKey.has(key)) byKey.set(key, m[0]);
      }
    }
    if (m.index === parenthetical.lastIndex) parenthetical.lastIndex++;
  }

  const narrative = new RegExp(NARRATIVE_REFERENCE);
  while ((m = narrative.exec(source)) !== null) {
    const author = m[1];
    const years = m[2].match(CITATION_YEAR_TOKEN) || [];
    CITATION_YEAR_TOKEN.lastIndex = 0;
    for (const key of keysFromAuthorYears(author, years)) {
      if (!byKey.has(key)) byKey.set(key, m[0]);
    }
    if (m.index === narrative.lastIndex) narrative.lastIndex++;
  }

  return byKey;
}

function compareCitationMeaning(sourceText, revisedText) {
  const sourceIndex = citationReferenceIndex(sourceText);
  const revisedIndex = citationReferenceIndex(revisedText);
  const missingKeys = [...sourceIndex.keys()].filter((key) => !revisedIndex.has(key));
  const newKeys = [...revisedIndex.keys()].filter((key) => !sourceIndex.has(key));
  return {
    missingKeys,
    newKeys,
    missingSpans: dedupe(missingKeys.map((key) => sourceIndex.get(key))),
    newSpans: dedupe(newKeys.map((key) => revisedIndex.get(key))),
  };
}

function parseRange(range) {
  const endpoints = String(range || "").match(/\d{1,4}/g) || [];
  return endpoints.length >= 2 ? [endpoints[0], endpoints[1]] : null;
}

function rangeMeaningPresent(range, revisedText) {
  const parsed = parseRange(range);
  if (!parsed) return String(revisedText || "").includes(range);
  const [start, end] = parsed;
  const patterns = [
    new RegExp(`\\b${start}\\s*[-–—]\\s*${end}\\b`),
    new RegExp(`\\bbetween\\s+${start}\\s+and\\s+${end}\\b`, "i"),
    new RegExp(`\\bfrom\\s+${start}\\s+(?:to|through)\\s+${end}\\b`, "i"),
    new RegExp(`\\b${start}\\s+(?:to|through)\\s+${end}\\b`, "i"),
  ];
  return patterns.some((pattern) => pattern.test(revisedText));
}

// Literal regexes are intentional here. Dynamic RegExp construction previously
// introduced an escaping regression that caused proposal-stage checks to go
// silent. Descriptive words between “this/the proposed” and “study” are
// permitted so mixed-methods labels do not defeat the stage detector.
const PLANNED_STUDY = /\b(?:this|the present|the proposed)\s+(?:[A-Za-z][A-Za-z-]*\s+){0,8}study\s+(?:will|aims to|seeks to|is designed to|is intended to|proposes to)\b/gi;
const PURPOSE_PLANNED = /\bthe purpose of this\b[^.!?\n]{0,180}\bstudy\s+is\s+to\s+(?:examine|investigate|assess|evaluate|analyse|analyze|determine|test|explore|estimate|explain)\b/gi;
const PROSPECTUS_PLANNED = /\bthis prospectus\s+(?:proposes|will|aims|seeks|is designed|is intended)\b/gi;
const PRESENT_REPORTING_STUDY = /\b(?:this|the present|the proposed)\s+(?:[A-Za-z][A-Za-z-]*\s+){0,8}study\s+(?:examines|investigates|assesses|evaluates|analyses|analyzes|determines|tests|adopts|uses|employs|collects|administers|measures|focuses|explores|estimates|applies|specifies)\b/gi;
const COMPLETED_STUDY = /\b(?:(?:this|the present|the proposed)\s+(?:[A-Za-z][A-Za-z-]*\s+){0,8}study\s+(?:conducted|collected|analysed|analyzed|found|reported|showed|revealed|used|employed)|interviews?\s+(?:were|was)\s+conducted|data\s+(?:were|was)\s+collected|analysis\s+(?:was|were)\s+conducted|participants?\s+(?:were|was)\s+interviewed)\b/gi;
const FIRST_PERSON = /\b(?:I|me|my|mine|myself|we|us|our|ours|ourselves)\b/g;
const SECTION_LABEL = /\bSection\s+\d+(?:\.\d+)*\b/gi;
const CHAPTER_LABEL = /\bChapter\s+\d+(?:\.\d+)*\b/gi;

const NUMBER_WORDS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
]);
const ENUMERABLE_NOUN = "(?:variables?|mechanisms?|characteristics?|dimensions?|components?|frameworks?|channels?|phases?|strands?|stages?|ways?|sources?|approaches?|forms?|groups?|categories?|factors?|indicators?|proxies|objectives?|questions?|hypotheses|conditions?|reasons?|effects?|features?|elements?|parts?)";

function countMatches(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function normalisedMatches(text, regex) {
  return new Set((String(text || "").match(regex) || []).map((x) => x.toLowerCase()));
}

function assessStudyStage(sourceText, revisedText) {
  const sourcePlanned =
    countMatches(sourceText, PLANNED_STUDY) +
    countMatches(sourceText, PURPOSE_PLANNED) +
    countMatches(sourceText, PROSPECTUS_PLANNED);
  const revisedPlanned =
    countMatches(revisedText, PLANNED_STUDY) +
    countMatches(revisedText, PURPOSE_PLANNED) +
    countMatches(revisedText, PROSPECTUS_PLANNED);
  const revisedPresentReporting = countMatches(revisedText, PRESENT_REPORTING_STUDY);
  const sourceCompletedReporting = countMatches(sourceText, COMPLETED_STUDY);
  const revisedCompletedReporting = countMatches(revisedText, COMPLETED_STUDY);

  const changedFromPlannedToPresent = sourcePlanned > 0 && revisedPlanned === 0 && revisedPresentReporting > 0;
  const introducedCompletedStudy = sourcePlanned > 0 && revisedCompletedReporting > sourceCompletedReporting;
  return {
    ok: !changedFromPlannedToPresent && !introducedCompletedStudy,
    source_planned_markers: sourcePlanned,
    revised_planned_markers: revisedPlanned,
    revised_present_reporting_markers: revisedPresentReporting,
    source_completed_reporting_markers: sourceCompletedReporting,
    revised_completed_reporting_markers: revisedCompletedReporting,
    introduced_completed_study: introducedCompletedStudy,
  };
}

function assessResearcherVoice(sourceText, revisedText) {
  const sourceFirstPerson = countMatches(sourceText, FIRST_PERSON);
  const revisedFirstPerson = countMatches(revisedText, FIRST_PERSON);
  return {
    ok: !(sourceFirstPerson === 0 && revisedFirstPerson > 0),
    source_first_person_markers: sourceFirstPerson,
    revised_first_person_markers: revisedFirstPerson,
  };
}

function assessDocumentStructure(sourceText, revisedText) {
  const sourceSections = normalisedMatches(sourceText, SECTION_LABEL);
  const sourceChapters = normalisedMatches(sourceText, CHAPTER_LABEL);
  const revisedSections = normalisedMatches(revisedText, SECTION_LABEL);
  const revisedChapters = normalisedMatches(revisedText, CHAPTER_LABEL);

  const newChapterLabels = [...revisedChapters].filter((x) => !sourceChapters.has(x));
  const newSectionLabels = [...revisedSections].filter((x) => !sourceSections.has(x));
  const missingSectionLabels = [...sourceSections].filter((x) => !revisedSections.has(x));
  const missingChapterLabels = [...sourceChapters].filter((x) => !revisedChapters.has(x));
  const sectionToChapterShift = sourceSections.size > 0 && sourceChapters.size === 0 && newChapterLabels.length > 0;
  const chapterToSectionShift = sourceChapters.size > 0 && sourceSections.size === 0 && newSectionLabels.length > 0;
  const structuralLabelLost = missingSectionLabels.length > 0 || missingChapterLabels.length > 0;

  return {
    ok: !sectionToChapterShift && !chapterToSectionShift && !structuralLabelLost,
    source_sections: [...sourceSections],
    source_chapters: [...sourceChapters],
    new_section_labels: newSectionLabels,
    new_chapter_labels: newChapterLabels,
    missing_section_labels: missingSectionLabels,
    missing_chapter_labels: missingChapterLabels,
  };
}

function countEnumeratedItems(rawList) {
  const cleaned = String(rawList || "")
    .replace(/\s+(?:and|or)\s+/gi, ", ")
    .replace(/\s*;\s*/g, ", ");
  return cleaned.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean).length;
}

function listCountWarnings(text) {
  const warnings = [];
  // Require a genuinely enumerative construction. This catches formulations
  // such as “Six board characteristics serve as focal variables: A, B, C...”
  // while avoiding ordinary argumentative prose such as “these two frameworks
  // yield a causal logic: X; Y; Z”, where the colon introduces consequences,
  // not the two frameworks themselves.
  const re = new RegExp(
    `\\b(one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:[A-Za-z-]+\\s+){0,3}${ENUMERABLE_NOUN}\\s+(?:(?:are|include|includes|comprise|comprises|consist|consists)\\s*(?:of\\s*)?|(?:serve|serves|function|functions)\\s+as\\s+(?:[A-Za-z-]+\\s+){0,4}${ENUMERABLE_NOUN}\\s*:|namely\\s*|:\\s*)([^.!?\\n]{10,500})`,
    "gi"
  );
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const stated = NUMBER_WORDS.get(m[1].toLowerCase());
    const observed = countEnumeratedItems(m[2]);
    if (observed >= 2 && stated !== observed) {
      warnings.push({ stated, observed, excerpt: m[0].slice(0, 240) });
    }
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return warnings;
}

export function auditPreservation(sourceText, revisedText, sourceSpans, options = {}) {
  const spans = sourceSpans || extractProtectedSpans(sourceText);
  const revisedSpans = extractProtectedSpans(revisedText);
  const warnings = [];

  const missingNumbers = missingFrom(spans.numbers, revisedText);
  const missingRanges = (spans.ranges || []).filter((range) => !rangeMeaningPresent(range, revisedText));
  const missingMonetary = missingFrom(spans.monetary, revisedText);
  const missingStats = missingFrom(spans.statNotation, revisedText);
  const numbersOk = missingNumbers.length === 0 && missingRanges.length === 0 && missingMonetary.length === 0 && missingStats.length === 0;
  if (!numbersOk) {
    warnings.push({
      type: "missing_numeric_span",
      detail: `Numeric/statistical spans present in source but not preserved in the revision: ${[...missingNumbers, ...missingRanges, ...missingMonetary, ...missingStats].join(", ")}`,
    });
  }
  if (missingRanges.length > 0) {
    warnings.push({
      type: "range_corruption",
      detail: `Numeric range(s) were altered in a way that no longer expresses the same interval: ${missingRanges.join(", ")}. Exact dashes, “between X and Y”, “from X to Y”, and “X through Y” are accepted as equivalent range forms.`,
    });
  }

  const citationComparison = compareCitationMeaning(sourceText, revisedText);
  const citationsOk = citationComparison.missingKeys.length === 0;
  if (!citationsOk) {
    warnings.push({ type: "missing_citation", detail: `Citation reference(s) present in the source are absent from the revision: ${citationComparison.missingSpans.join(", ")}` });
  }

  const missingAcronyms = missingFrom(spans.acronyms, revisedText);
  const technicalTermsOk = missingAcronyms.length === 0;
  if (!technicalTermsOk) {
    warnings.push({
      type: "missing_technical_term",
      detail: `Acronyms/technical terms present in source but not found in revision: ${missingAcronyms.join(", ")}. This may be a legitimate first-use expansion -- review manually.`,
    });
  }

  const missingQuotes = missingFrom(spans.quotes, revisedText);
  const quotesOk = missingQuotes.length === 0;
  if (!quotesOk) {
    warnings.push({ type: "altered_quotation", detail: `Quoted material present in source but not found verbatim in revision: ${missingQuotes.map((q) => `"${q}"`).join(", ")}` });
  }

  const newCitations = citationComparison.newSpans;
  const newNumbers = extraNumericLike(spans, revisedSpans);
  const revisedListCountWarnings = listCountWarnings(revisedText);
  const sourceListCountWarnings = listCountWarnings(sourceText);
  const introducedListCountWarnings = revisedListCountWarnings.filter(
    (warning) => !sourceListCountWarnings.some((sourceWarning) => sourceWarning.excerpt === warning.excerpt)
  );

  if (newCitations.length > 0) {
    warnings.push({ type: "new_citation_introduced", detail: `Author-year citation reference(s) appear in the revision but not in the source: ${newCitations.join(", ")}. Flag for manual review.` });
  }
  if (newNumbers.length > 0) {
    warnings.push({ type: "new_numeric_value_introduced", detail: `Numeric/statistical value appears in the revision that was not in the source: ${newNumbers.join(", ")}. Verify this was not fabricated.` });
  }
  for (const mismatch of introducedListCountWarnings) {
    warnings.push({
      type: "list_count_mismatch",
      detail: `The revision states a list count of ${mismatch.stated} but the following explicit enumeration contains ${mismatch.observed} apparent items: ${mismatch.excerpt}. Verify the count and the underlying constructs.`,
    });
  }

  const studyStage = assessStudyStage(sourceText, revisedText);
  if (!studyStage.ok) {
    warnings.push({
      type: "study_stage_shift",
      detail: studyStage.introduced_completed_study
        ? "The source is proposal-stage, but the revision introduced completed-study wording. Preserve planned/future orientation."
        : "The source presents the study as planned/proposal-stage, but the revision changes that orientation to present-tense reporting. Preserve the research stage unless the author explicitly changes it.",
    });
  }

  const researcherVoice = assessResearcherVoice(sourceText, revisedText);
  if (!researcherVoice.ok) {
    warnings.push({
      type: "researcher_voice_shift",
      detail: "The revision introduced first-person researcher voice (I/we/my/our) where the source did not use it. Preserve the author's established research voice unless explicitly requested otherwise.",
    });
  }

  const documentStructure = assessDocumentStructure(sourceText, revisedText);
  if (!documentStructure.ok) {
    warnings.push({
      type: "document_structure_shift",
      detail: `The revision changed or dropped the document's structural vocabulary. New labels: ${[...documentStructure.new_chapter_labels, ...documentStructure.new_section_labels].join(", ") || "none"}. Missing labels: ${[...documentStructure.missing_section_labels, ...documentStructure.missing_chapter_labels].join(", ") || "none"}. Preserve the source's institutional Section/Chapter structure exactly.`,
    });
  }

  const rhetoricalSemantic = analyseRhetoricalSemanticPreservation(sourceText, revisedText, {
    lengthPreference: options.lengthPreference,
  });
  if (!rhetoricalSemantic.passed) {
    warnings.push({
      type: "rhetorical_semantic_preservation",
      detail: `The revision may have lost propositions or intellectual functions, altered semantic force, or exceeded the selected length architecture. Preserved propositions: ${rhetoricalSemantic.source_propositions_preserved}/${rhetoricalSemantic.source_propositions_total}; length ratio: ${rhetoricalSemantic.overall_length_ratio}.`,
    });
  } else if (!rhetoricalSemantic.length_within_soft_range) {
    warnings.push({
      type: "length_range_review",
      detail: `The source/revision length ratio is ${rhetoricalSemantic.overall_length_ratio}, outside the ${rhetoricalSemantic.length_soft_range[0]}-${rhetoricalSemantic.length_soft_range[1]} soft range. The text passed substantive preservation, but the departure should have an intellectual reason.`,
    });
  }

  const newFactualClaimsDetected =
    newCitations.length > 0 ||
    newNumbers.length > 0 ||
    missingRanges.length > 0 ||
    introducedListCountWarnings.length > 0 ||
    !studyStage.ok ||
    !researcherVoice.ok ||
    !documentStructure.ok ||
    rhetoricalSemantic.unsupported_additions.length > 0;

  return {
    numbers_ok: numbersOk,
    ranges_ok: missingRanges.length === 0,
    citations_ok: citationsOk,
    technical_terms_ok: technicalTermsOk,
    quotes_ok: quotesOk,
    study_stage_ok: studyStage.ok,
    study_stage: studyStage,
    researcher_voice_ok: researcherVoice.ok,
    researcher_voice: researcherVoice,
    document_structure_ok: documentStructure.ok,
    document_structure: documentStructure,
    list_counts_ok: introducedListCountWarnings.length === 0,
    rhetorical_semantic_ok: rhetoricalSemantic.passed,
    rhetorical_semantic_preservation: rhetoricalSemantic,
    new_factual_claims_detected: newFactualClaimsDetected,
    warnings,
  };
}

