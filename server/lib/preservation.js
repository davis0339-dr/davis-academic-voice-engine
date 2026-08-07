// Pass E (preservation audit): programmatic, deterministic checks that run
// after generation, independent of the model's own self-report. This is
// what stops "the model says it preserved everything" from being the only
// evidence -- see Section 6/Section 21.4 of the build handoff.
//
// These checks are necessarily conservative and substring-based. A false
// warning (flagging a paraphrase of a number as "missing") is preferable
// to silently trusting the model, but it does mean legitimate rewording of
// a citation's surrounding grammar can trip a warning -- documented as a
// known limitation in the README.

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
  const newFactualClaimsDetected = newCitations.length > 0 || newNumbers.length > 0;
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

  return {
    numbers_ok: numbersOk,
    citations_ok: citationsOk,
    technical_terms_ok: technicalTermsOk,
    quotes_ok: quotesOk,
    new_factual_claims_detected: newFactualClaimsDetected,
    warnings,
  };
}
