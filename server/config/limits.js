export const SINGLE_EDITOR_WORD_LIMIT = 1500;
// A valid Expand result may exceed the source-entry ceiling. Bounded feedback-
// guided refinement must be able to edit that exact tested candidate without
// forcing it into Long Document or silently trimming it first.
export const SINGLE_REFINEMENT_WORD_LIMIT = 1920;
export const LONG_DOCUMENT_WORD_LIMIT = 12000;
export const UPLOAD_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

// Count whitespace-delimited lexical tokens rather than punctuation fragments.
// The previous /[A-Za-z0-9']+/ counter over-counted academic prose because
// U.S., S&P, U.S.-listed, bank-loan, 2015–2024 and n.d.-a were split into
// multiple pieces. This method intentionally stays simple and transparent:
// a token counts once when it contains at least one Unicode letter or number.
// Microsoft Word, GPTZero and other products may still differ slightly because
// each has proprietary tokenisation rules, so UI copy should call this an
// approximate manuscript word count rather than claiming exact parity.
export function countWords(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  return value
    .split(/\s+/u)
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
    .length;
}

export function enforceWordLimit(text, limit, label) {
  const words = countWords(text);
  if (words > limit) {
    const err = new Error(`${label} accepts up to ${limit.toLocaleString()} approximate manuscript words in the current build. This input contains approximately ${words.toLocaleString()} words by Davis counting rules.`);
    err.code = "WORD_LIMIT_EXCEEDED";
    err.wordCount = words;
    err.wordLimit = limit;
    throw err;
  }
  return words;
}
