// Pass E (preservation audit): deterministic checks that run after generation,
// independent of the model's own self-report.

import { extractProtectedSpans } from "./protect.js";

function missingFrom(list, haystack) {
  return list.filter((item) => !haystack.includes(item));
}

function extraNumericLike(sourceSpans, revisedSpans) {
  const sourceNumbers = new Set([
    ...sourceSpans.numbers,
    ...(sourceSpans.ranges || []),
    ...sourceSpans.monetary,
    ...sourceSpans.statNotation,
  ]);
  const revisedNumbers = [
    ...revisedSpans.numbers,
    ...(revisedSpans.ranges || []),
    ...revisedSpans.monetary,
    ...revisedSpans.statNotation,
  ];
  return revisedNumbers.filter((n) => !sourceNumbers.has(n));
}

function extraCitationLike(sourceSpans, revisedSpans) {
  const sourceCitations = new Set(sourceSpans.citations);
  return revisedSpans.citations.filter((c) => !sourceCitations.has(c));
}

const STUDY_SUBJECT = String.raw`(?:this|the present|the proposed)\s+(?:[A-Za-z][A-Za-z-]*\s+){0,8}study`;
const PLANNED_STUDY = new RegExp(`\\b${STUDY_SUBJECT}\\s+(?:will|aims to|seeks to|is designed to|is intended to|proposes to)\\b`, "gi");
const PURPOSE_PLANNED = /\bthe purpose of this\b[^.!?\n]{0,180}\bstudy\s+is\s+to\s+(?:examine|investigate|assess|evaluate|analyse|analyze|determine|test|explore|estimate|explain)\b/gi;
const PROSPECTUS_PLANNED = /\bthis prospectus\s+(?:proposes|will|aims|seeks|is designed|is intended)\b/gi;
const PRESENT_REPORTING_STUDY = new RegExp(`\\b${STUDY_SUBJECT}\\s+(?:examines|investigates|assesses|evaluates|analyses|analyzes|determines|tests|adopts|uses|employs|collects|administers|measures|focuses|explores|estimates|applies|specifies)\\b`, "gi");
const COMPLETED_STUDY = new RegExp(`\\b(?:${STUDY_SUBJECT}\\s+(?:conducted|collected|analysed|analyzed|found|reported|showed|revealed|used|employed)|interviews?\\s+(?:were|was)\\s+conducted|data\\s+(?:were|was)\\s+collected|analysis\\s+(?:was|were)\\s+conducted|participants?\\s+(?:were|was)\\s+interviewed)\\b`, "gi");
const FIRST_PERSON = /\b(?:I|me|my|mine|myself|we|us|our|ours|ourselves)\b/g;
const SECTION_LABEL = /\bSection\s+\d+(?:\.\d+)*\b/gi;
const CHAPTER_LABEL = /\bChapter\s+\d+(?:\.\d+)*\b/gi;

const NUMBER_WORDS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
]);

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

function listCountWarnings(text) {
  const warnings = [];
  const re = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b([^:.\n]{0,120}):\s*([^.!?\n]{10,500})/gi;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const stated = NUMBER_WORDS.get(m[1].toLowerCase());
    const list = m[3]
      .replace(/\s+,\s+/g, ", ")
      .split(/,\s*(?:and\s+)?/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (list.length >= 2 && stated !== list.length) {
      warnings.push({ stated, observed: list.length, excerpt: m[0].slice(0, 240) });
    }
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return warnings;
}

export function auditPreservation(sourceText, revisedText, sourceSpans) {
  const spans = sourceSpans || extractProtectedSpans(sourceText);
  const revisedSpans = extractProtectedSpans(revisedText);
  const warnings = [];

  const missingNumbers = missingFrom(spans.numbers, revisedText);
  const missingRanges = missingFrom(spans.ranges || [], revisedText);
  const missingMonetary = missingFrom(spans.monetary, revisedText);
  const missingStats = missingFrom(spans.statNotation, revisedText);
  const numbersOk = missingNumbers.length === 0 && missingRanges.length === 0 && missingMonetary.length === 0 && missingStats.length === 0;
  if (!numbersOk) {
    warnings.push({
      type: "missing_numeric_span",
      detail: `Numeric/statistical spans present in source but not found verbatim in revision: ${[...missingNumbers, ...missingRanges, ...missingMonetary, ...missingStats].join(", ")}`,
    });
  }
  if (missingRanges.length > 0) {
    warnings.push({
      type: "range_corruption",
      detail: `Numeric range(s) were altered or broken apart: ${missingRanges.join(", ")}. Preserve ranges atomically because changing the separator can change the represented population or period.`,
    });
  }

  const missingCitations = missingFrom(spans.citations, revisedText);
  const citationsOk = missingCitations.length === 0;
  if (!citationsOk) {
    warnings.push({ type: "missing_citation", detail: `Citations present in source but not found verbatim in revision: ${missingCitations.join(", ")}` });
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

  const newCitations = extraCitationLike(spans, revisedSpans);
  const newNumbers = extraNumericLike(spans, revisedSpans);
  const revisedListCountWarnings = listCountWarnings(revisedText);
  const sourceListCountWarnings = listCountWarnings(sourceText);
  const introducedListCountWarnings = revisedListCountWarnings.filter(
    (warning) => !sourceListCountWarnings.some((sourceWarning) => sourceWarning.excerpt === warning.excerpt)
  );

  if (newCitations.length > 0) {
    warnings.push({ type: "new_citation_introduced", detail: `Citation-like text appears in the revision that was not in the source: ${newCitations.join(", ")}. This must not happen -- flag for manual review.` });
  }
  if (newNumbers.length > 0) {
    warnings.push({ type: "new_numeric_value_introduced", detail: `Numeric/statistical value appears in the revision that was not in the source: ${newNumbers.join(", ")}. Verify this was not fabricated.` });
  }
  for (const mismatch of introducedListCountWarnings) {
    warnings.push({
      type: "list_count_mismatch",
      detail: `The revision states a list count of ${mismatch.stated} but the following list contains ${mismatch.observed} apparent items: ${mismatch.excerpt}. Verify the count and the underlying constructs.`,
    });
  }

  const studyStage = assessStudyStage(sourceText, revisedText);
  if (!studyStage.ok) {
    warnings.push({
      type: "study_stage_shift",
      detail: studyStage.introduced_completed_study
        ? "The source is proposal-stage, but the revision introduced completed-study wording (for example, interviews/data being described as already conducted or collected). Preserve planned/future orientation."
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

  const newFactualClaimsDetected =
    newCitations.length > 0 ||
    newNumbers.length > 0 ||
    missingRanges.length > 0 ||
    introducedListCountWarnings.length > 0 ||
    !studyStage.ok ||
    !researcherVoice.ok ||
    !documentStructure.ok;

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
    new_factual_claims_detected: newFactualClaimsDetected,
    warnings,
  };
}
