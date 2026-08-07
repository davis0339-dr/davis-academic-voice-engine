import { extractProtectedSpans } from "./protect.js";

const MARKDOWN_HEADING = /^(#{1,6})\s+(.+)$/;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\s+([A-Z][^.!?]{2,80})$/;
const ALLCAPS_HEADING = /^[A-Z][A-Z0-9 ,'&\-:]{2,79}$/;
const SMALL_TITLE_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "vs", "with"]);

function isShortTitleCaseHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60 || /[.!?;,]$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 1 || words.length > 6) return false;

  return words.every((word, index) => {
    const bare = word.replace(/^[('"“]+|[)'"”:]$/g, "");
    if (!bare) return false;
    if (index > 0 && SMALL_TITLE_WORDS.has(bare.toLowerCase())) return true;
    return /^[A-Z][A-Za-z0-9&/'-]*$/.test(bare) || /^[A-Z]{2,6}$/.test(bare);
  });
}

const ACRONYM_EXPANSION_A = /\b([A-Z][a-zA-Z'-]*(?:[ \t]+[A-Z][a-zA-Z'-]*){0,5})[ \t]+\(([A-Z]{2,6})\)/g;
const ACRONYM_EXPANSION_B = /\b([A-Z]{2,6})[ \t]+\(([A-Z][a-zA-Z'-]*(?:[ \t]+[A-Z][a-zA-Z'-]*){0,5})\)/g;

function headingLevel(line) {
  const md = line.match(MARKDOWN_HEADING);
  if (md) return { level: md[1].length, text: md[2].trim(), style: "markdown" };

  const numbered = line.match(NUMBERED_HEADING);
  if (numbered) {
    const depth = numbered[1].split(".").length;
    return { level: depth, text: `${numbered[1]} ${numbered[2]}`.trim(), style: "numbered" };
  }

  if (ALLCAPS_HEADING.test(line.trim()) && line.trim().split(/\s+/).length <= 8) {
    return { level: 1, text: line.trim(), style: "allcaps" };
  }

  if (isShortTitleCaseHeading(line)) {
    return { level: 3, text: line.trim(), style: "titlecase" };
  }

  return null;
}

function detectHeadings(fullText) {
  const lines = fullText.split("\n");
  const headings = [];
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      const detected = headingLevel(trimmed);
      if (detected) headings.push({ offset, lineText: line, ...detected });
    }
    offset += line.length + 1;
  }
  return headings;
}

function buildGlossary(fullText) {
  const glossary = {};
  for (const re of [ACRONYM_EXPANSION_A, ACRONYM_EXPANSION_B]) {
    let m;
    const r = new RegExp(re);
    while ((m = r.exec(fullText)) !== null) {
      const isAcronymFirst = re === ACRONYM_EXPANSION_B;
      const acronym = isAcronymFirst ? m[1] : m[2];
      const expansion = isAcronymFirst ? m[2] : m[1];
      if (!glossary[acronym]) glossary[acronym] = expansion.trim();
      if (m.index === r.lastIndex) r.lastIndex++;
    }
  }
  return glossary;
}

function guessTitle(fullText, headings) {
  const firstHeadingOffset = headings.length > 0 ? headings[0].offset : fullText.length;
  const preamble = fullText.slice(0, firstHeadingOffset).trim();
  if (!preamble) return null;
  const firstLine = preamble.split("\n")[0].trim();
  if (firstLine.length > 0 && firstLine.length <= 200) return firstLine;
  return null;
}

export function buildDocumentMap(fullText) {
  const headings = detectHeadings(fullText);
  const glossary = buildGlossary(fullText);
  const protectedSpans = extractProtectedSpans(fullText);
  const title = guessTitle(fullText, headings);

  return {
    title,
    headings,
    glossary,
    protectedSpans,
    wordCount: (fullText.match(/[A-Za-z0-9']+/g) || []).length,
  };
}
