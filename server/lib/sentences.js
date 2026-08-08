// Sentence splitter shared by diagnostics and the planner.
// Common academic abbreviations and genuine numbered list/section markers are
// protected before boundary detection so enumerated arguments do not get
// shredded into fragments such as a stand-alone "2." while ordinary numeric
// sentence endings (for example "firm 1. The evidence...") retain their stop.

const PROTECT_ABBREVIATIONS = [
  "et al.",
  "e.g.",
  "i.e.",
  "cf.",
  "vs.",
  "etc.",
  "Dr.",
  "Prof.",
  "Mr.",
  "Mrs.",
  "Ms.",
  "St.",
  "no.",
  "No.",
  "p.",
  "pp.",
  "Fig.",
  "fig.",
  "n.d.",
];

const LIST_DOT_TOKEN = "\u0000LISTDOT\u0000";
const STRUCTURE_BREAK_TOKEN = "\u0000STRUCTBREAK\u0000";

function protectNumberedMarkers(text) {
  // A numeric marker is protected only when the surrounding syntax makes it a
  // plausible enumerator: at the start of the text/line, after a colon or
  // semicolon introducing a list, or after terminal punctuation separating
  // neighbouring list items. A bare number after an ordinary noun is not.
  return text.replace(
    /(^|\n\s*|[:;.!?]\s+)(\d{1,3})\.\s+(?=\S)/g,
    (_match, prefix, number) => `${prefix}${number}${LIST_DOT_TOKEN} `
  );
}

function markListHeaderBreaks(text) {
  // Preserve historical cadence measurement semantics: ordinary paragraph
  // breaks are NOT converted into sentence boundaries. Only a short colon-led
  // header immediately followed by an enumerated/bulleted list gets a semantic
  // break so "Treatment paths:" does not fuse with item 1. The newline after
  // the token intentionally preserves start-of-line context for the subsequent
  // numbered-marker protection pass.
  return text.replace(
    /(^|\n)([^\n]{1,120}:)\n{2,}(?=\s*(?:[-*•]|\d{1,3}[.)]|[A-Za-z][.)])\s+\S)/g,
    (_match, prefix, header) => `${prefix}${header}${STRUCTURE_BREAK_TOKEN}\n`
  );
}

export function splitSentences(text) {
  let working = String(text || "").replace(/\r\n?/g, "\n");
  // Detect the narrow structural list-header boundary while the original list
  // marker is still visible; then protect the enumerator using the preserved
  // line-start context. This fixes list segmentation without redefining normal
  // paragraph breaks as sentence boundaries or changing corpus cadence metrics.
  working = markListHeaderBreaks(working);
  working = protectNumberedMarkers(working);

  const placeholders = [];
  PROTECT_ABBREVIATIONS.forEach((abbr, i) => {
    const token = `\u0000ABBR${i}\u0000`;
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    working = working.replace(new RegExp(escaped, "g"), token);
    placeholders.push([token, abbr]);
  });

  const rawSentences = working
    .split(STRUCTURE_BREAK_TOKEN)
    .flatMap((block) => block
      .trim()
      .split(/(?<=[.!?])\s+(?=[A-Z0-9\"“])/)
      .map((s) => s.trim())
      .filter(Boolean))
    .filter(Boolean);

  return rawSentences.map((s) => {
    let restored = s.split(LIST_DOT_TOKEN).join(".");
    for (const [token, abbr] of placeholders) {
      restored = restored.split(token).join(abbr);
    }
    return restored;
  });
}

export function wordCount(text) {
  return (String(text || "").match(/[A-Za-z0-9']+/g) || []).length;
}
