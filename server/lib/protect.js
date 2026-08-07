// Pass A (protect and parse): deterministic, regex-based extraction of
// spans that must survive revision unchanged. This is intentionally rule
// based rather than model based -- it has to be trustworthy enough to gate
// the preservation audit in Pass E, and it must be testable without an API
// key. It is not a full citation/NLP parser; it targets the span types the
// build handoff calls out explicitly in Section 4 ("Pass A").

const PARENTHETICAL_CITATION =
  /\(([A-Z][A-Za-z'-]+(?:\s+(?:&|and)\s+[A-Z][A-Za-z'-]+|\s+et al\.)?,\s*(?:\d{4}[a-z]?|n\.d\.)(?:;\s*[A-Z][A-Za-z'-]+(?:\s+(?:&|and)\s+[A-Z][A-Za-z'-]+|\s+et al\.)?,\s*(?:\d{4}[a-z]?|n\.d\.))*)\)/g;

const NARRATIVE_CITATION =
  /\b([A-Z][A-Za-z'-]+(?:\s+(?:&|and)\s+[A-Z][A-Za-z'-]+|\s+et al\.)?\s\((?:\d{4}[a-z]?|n\.d\.)\))/g;

const NUMBERED_CITATION = /\[\d+(?:,\s*\d+)*(?:-\d+)?\]/g;

const PERCENT_OR_DECIMAL = /-?\d+(?:,\d{3})*(?:\.\d+)?%?/g;

const MONETARY = /[$£€]\s?\d+(?:,\d{3})*(?:\.\d+)?(?:\s?(?:million|billion|thousand|m|bn|k))?/gi;

const STAT_NOTATION =
  /(?:[βαµ]|(?:adj\.?\s*)?\bR²|\br²|\bF|\bt|\bp|\bN|Cronbach'?s\s*α)\s*[=<>≤≥]\s*-?\d+(?:\.\d+)?/gi;

const DOUBLE_QUOTES = /"([^"]{3,})"|“([^”]{3,})”/g;

const ACRONYM = /\b[A-Z]{2,6}(?:-[A-Z]{2,6})?\b/g;

function dedupe(arr) {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function matchAll(regex, text) {
  const out = [];
  let m;
  const re = new RegExp(regex);
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

export function extractProtectedSpans(text) {
  const citations = dedupe([
    ...matchAll(PARENTHETICAL_CITATION, text),
    ...matchAll(NARRATIVE_CITATION, text),
    ...matchAll(NUMBERED_CITATION, text),
  ]);

  const statNotation = dedupe(matchAll(STAT_NOTATION, text));
  const monetary = dedupe(matchAll(MONETARY, text));

  // Bare numbers: pull them after citations/stats/monetary are already
  // claimed, so a year inside "(Smith, 2020)" isn't double-reported as a
  // free-floating number the reviser is separately blamed for moving.
  let numberScratch = text;
  for (const c of [...citations, ...statNotation, ...monetary]) {
    numberScratch = numberScratch.split(c).join(" ");
  }
  const numbers = dedupe(
    matchAll(PERCENT_OR_DECIMAL, numberScratch).filter((n) => /\d/.test(n) && n.length > 0)
  );

  const quotes = dedupe(
    matchAll(DOUBLE_QUOTES, text).map((q) => q.replace(/^["“]|["”]$/g, ""))
  );

  const acronyms = dedupe(matchAll(ACRONYM, text)).filter(
    (a) => !["I", "A"].includes(a)
  );

  return {
    citations,
    numbers,
    monetary,
    statNotation,
    quotes,
    acronyms,
  };
}
