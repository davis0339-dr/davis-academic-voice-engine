export const SINGLE_EDITOR_WORD_LIMIT = 1500;
export const LONG_DOCUMENT_WORD_LIMIT = 12000;
export const UPLOAD_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

export function countWords(text) {
  return (String(text || "").match(/[A-Za-z0-9']+/g) || []).length;
}

export function enforceWordLimit(text, limit, label) {
  const words = countWords(text);
  if (words > limit) {
    const err = new Error(`${label} accepts up to ${limit.toLocaleString()} words in the current build. This input contains ${words.toLocaleString()} words.`);
    err.code = "WORD_LIMIT_EXCEEDED";
    err.wordCount = words;
    err.wordLimit = limit;
    throw err;
  }
  return words;
}
