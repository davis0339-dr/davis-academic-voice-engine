// Pass E (preservation audit): deterministic checks that run after generation,
// independent of the model's own self-report.

import { extractProtectedSpans } from "./protect.js";

function missingFrom(list, haystack) {
  return list.filter((item) => !haystack.includes(item));
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

function extraCitationLike(sourceSpans, revisedSpans) {
  const sourceCitations = new Set(sourceSpans.citations);
  return revisedSpans.citations.filter((c) => !sourceCitations.has(c));
}

const PLANNED_STUDY = /\b(?:this|the present|the proposed) study\s+(?:will|aims to|seeks to|is designed to|is intended to|proposes to)\b/gi;
const PRESENT_REPORTING_STUDY = /\b(?:this|the present|the proposed) study\s+(?:examines|investigates|assesses|evaluates|analyses|analyzes|determines|tests|adopts|uses|employs|collects|administers|measures|focuses|explores|estimates|applies)\b/gi;
const COMPLETED_STUDY = /\b(?:(?:this|the present|the proposed) study\s+(?:conducted|collected|analysed|analyzed|found|reported|showed|revealed|used|employed)|interviews?\s+(?:were|was)\s+conducted|data\s+(?:were|was)\s+collected|analysis\s+(?:was|were)\s+conducted|participants?\s+(?:were|was)\s+interviewed)\b/gi;

const NUMBER_WORDS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
]);

function countMatches(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function assessStudyStage(sourceText, revisedText) {
  const sourcePlanned = countMatches(sourceText, PLANNED_STUDY);
  const revisedPlanned = countMatches(revisedText, PLANNED_STUDY);
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
      warnings.push({
        stated,
        observed: list.length,
        excerpt: m[0].slice(0, 240),
      });
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
  const missingMonetary = missingFrom(spans.monetary, revisedText);
  const missingStats = missingFrom(spans.statNotation, revisedText);
  const numbersOk = missingNumbers.length === 0 && missingMonetary.length === 0 && missingStats.length === 0;
  if (!numbersOk) {
    warnings.push({
      type: "missing_numeric_span",
      detail: `Numeric/statistical spans present in source but not found verbatim in revision: ${[
        ...missingNumbers,
        ...missingMonetary,
        ...missingStats,
      ].join(", ")}`,
    });
  }

  const missingCitations = missingFrom(spans.citations, revisedText);
  const citationsOk = missingCitations.length === 0;
  if (!citationsOk) {
    warnings.push({
      type: "missing_citation",
      detail: `Citations present in source but not found verbatim in revision: ${missingCitations.join(", ")}`,
    });
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
    warnings.push({
      type: "altered_quotation",
      detail: `Quoted material present in source but not found verbatim in revision: ${missingQuotes.map((q) => `"${q}"`).join(", ")}`,
    });
  }

  const newCitations = extraCitationLike(spans, revisedSpans);
  const newNumbers = extraNumericLike(spans, revisedSpans);
  const revisedListCountWarnings = listCountWarnings(revisedText);
  const sourceListCountWarnings = listCountWarnings(sourceText);
  const introducedListCountWarnings = revisedListCountWarnings.filter(
    (warning) => !sourceListCountWarnings.some((sourceWarning) => sourceWarning.excerpt === warning.excerpt)
  );

  const newFactualClaimsDetected = newCitations.length > 0 || newNumbers.length > 0 || introducedListCountWarnings.length > 0;
  if (newCitations.length > 0) {
    warnings.push({
      type: "new_citation_introduced",
      detail: `Citation-like text appears in the revision that was not in the source: ${newCitations.join(", ")}. This must not happen -- flag for manual review.`,
    });
  }
  if (newNumbers.length > 0) {
    warnings.push({
      type: "new_numeric_value_introduced",
      detail: `Numeric/statistical value appears in the revision that was not in the source: ${newNumbers.join(", ")}. Verify this was not fabricated.`,
    });
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

  return {
    numbers_ok: numbersOk,
    citations_ok: citationsOk,
    technical_terms_ok: technicalTermsOk,
    quotes_ok: quotesOk,
    study_stage_ok: studyStage.ok,
    study_stage: studyStage,
    list_counts_ok: introducedListCountWarnings.length === 0,
    new_factual_claims_detected: newFactualClaimsDetected,
    warnings,
  };
}
