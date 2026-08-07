// Pass A (protect and parse): deterministic extraction of spans that must
// survive revision unchanged. Citation handling deliberately supports both
// surname-style references and institutional/corporate authors, which are
// common in theses (e.g. Grand View Research, Financial Reporting Council,
// Ecofin Agency, Market Data Forecast).

const PARENTHETICAL_GROUP = /\(([^()\n]{1,360})\)/g;
const YEAR_TOKEN = /\b(?:18|19|20)\d{2}[a-z]?\b|\bn\.d\.\b/i;
const CITATION_YEAR_AFTER_COMMA = /,\s*(?:18|19|20)\d{2}[a-z]?\b|,\s*n\.d\.\b/i;

// Narrative forms such as Smith (2020), Krieger et al. (2021), Grand View
// Research (2025), and Financial Reporting Council (2024). The expression
// is intentionally bounded to a single phrase and does not cross punctuation.
const NARRATIVE_CITATION =
  /\b([A-Z][A-Za-z'’&.\-]*(?:[ \t]+(?:[A-Z][A-Za-z'’&.\-]*|et|al\.|and|&|of|the|for|in|on)){0,9}[ \t]+\((?:\d{4}[a-z]?|n\.d\.)\))/g;

const NUMBERED_CITATION = /\[\d+(?:,\s*\d+)*(?:-\d+)?\]/g;

const PERCENT_OR_DECIMAL = /-?\d+(?:,\d{3})*(?:\.\d+)?%?/g;

// Include naira and common currency-code forms used in Nigerian research.
const MONETARY =
  /(?:[$£€₦]\s?|(?:USD|NGN|GBP|EUR)\s+)\d+(?:,\d{3})*(?:\.\d+)?(?:\s?(?:million|billion|thousand|m|bn|k))?/gi;

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

function parentheticalCitations(text) {
  const out = [];
  let m;
  const re = new RegExp(PARENTHETICAL_GROUP);
  while ((m = re.exec(text)) !== null) {
    const full = m[0];
    const inside = m[1].trim();
    // Require an author-like alphabetic element and a citation-style year.
    // This captures multi-word corporate authors and forms such as
    // "Financial Reporting Council, as cited in Bloomberg Tax, 2025" while
    // avoiding ordinary explanatory parentheses that merely contain a date.
    const hasAuthorText = /[A-Za-z]{2,}/.test(inside);
    const hasYear = YEAR_TOKEN.test(inside);
    const citationShape = CITATION_YEAR_AFTER_COMMA.test(inside) || /\bas cited in\b/i.test(inside);
    if (hasAuthorText && hasYear && citationShape) out.push(full);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

export function extractProtectedSpans(text) {
  const citations = dedupe([
    ...parentheticalCitations(text),
    ...matchAll(NARRATIVE_CITATION, text),
    ...matchAll(NUMBERED_CITATION, text),
  ]);

  const statNotation = dedupe(matchAll(STAT_NOTATION, text));
  const monetary = dedupe(matchAll(MONETARY, text));

  // Bare numbers are pulled only after citation/statistical/monetary spans
  // have been removed, so years inside citations and digits inside currency
  // values are not double-counted as independent preservation obligations.
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
