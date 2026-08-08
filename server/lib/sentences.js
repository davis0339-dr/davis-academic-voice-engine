// Sentence splitter shared by diagnostics and the planner.
// Common academic abbreviations and numbered list/section markers are protected
// before boundary detection so citation-heavy prose and enumerated arguments do
// not get shredded into meaningless fragments such as a stand-alone "2.".

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

function protectNumberedMarkers(text) {
  // Protect 1. / 2. / 10. when the number is functioning as an enumerator or
  // section marker. Four-digit years are intentionally excluded.
  return text.replace(/(^|[\s\n])(\d{1,3})\.\s+(?=\S)/g, (_match, prefix, number) => {
    return `${prefix}${number}${LIST_DOT_TOKEN} `;
  });
}

export function splitSentences(text) {
  let working = protectNumberedMarkers(String(text || "").replace(/\r\n?/g, "\n"));
  const placeholders = [];
  PROTECT_ABBREVIATIONS.forEach((abbr, i) => {
    const token = `\u0000ABBR${i}\u0000`;
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    working = working.replace(new RegExp(escaped, "g"), token);
    placeholders.push([token, abbr]);
  });

  // Blank-line paragraph/heading boundaries are semantic boundaries even when
  // the preceding unit has no terminal full stop (common with pasted headings).
  const rawSentences = working
    .split(/\n{2,}/)
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
