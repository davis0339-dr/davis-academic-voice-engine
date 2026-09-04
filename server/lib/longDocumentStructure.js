// Server-authoritative long-document completeness audit. Formal artefacts are
// checked separately from substantive prose so a harmless word such as
// "programme" cannot be mistaken for front matter, and a rewritten paragraph
// is not automatically called a missing heading.

const DASHES = /[\u2010-\u2015\u2212]/g;
const FORMAL_HEADING = /^(?:#{1,6}\s*)?(?:(?:section|chapter)\s+\d+(?:\.\d+)*(?::\s*)?|\d+(?:\.\d+)*\s+)?(?:objectives? of (?:the )?study|research objectives?|research questions?(?: and hypotheses)?|research hypotheses?|purpose statement|problem statement|nature of the study|study alignment|definitions|conceptual model|operationali[sz]ation of variables|data analysis plan|proposed schedule|references|appendix(?:\s+[a-z0-9]+)?|table\s+\d+|figure\s+\d+)\s*$/i;
const HYPOTHESIS_LINE = /^(?:h0|h1)\d*[a-z]?[.):\s-]+\S+/i;
const QUESTION_LINE = /^(?:rq\s*\d+[a-z]?|research question\s*\d+[a-z]?)[.):\s-]+\S+/i;
const DEGREE_LINE = /^(?:a |an |the )?(?:dissertation|thesis|prospectus|proposal)\b.{0,140}\b(?:doctor of|master of|bachelor of|ph\.?d\.?|dba|m\.?sc\.?|mba|programme|program)\b/i;
const INSTITUTION_LINE = /^(?:submitted to|presented to|in partial fulfilment|in partial fulfillment|department of|faculty of|school of|college of|university of)\b/i;

export function normaliseStructuralText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(DASHES, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function lines(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function extractFormalArtifacts(source) {
  const artifacts = [];
  const seen = new Set();
  for (const line of lines(source)) {
    const words = line.split(/\s+/).length;
    const formal = FORMAL_HEADING.test(line)
      || HYPOTHESIS_LINE.test(line)
      || QUESTION_LINE.test(line)
      || (words <= 24 && (DEGREE_LINE.test(line) || INSTITUTION_LINE.test(line)))
      || (words >= 3 && words <= 12 && /^[A-Z0-9][A-Z0-9 &,:()'\-/]{11,}$/.test(line));
    if (!formal) continue;
    const key = normaliseStructuralText(line);
    if (!seen.has(key)) {
      seen.add(key);
      artifacts.push(line);
    }
  }
  return artifacts.slice(0, 200);
}

function contentTokens(text) {
  return normaliseStructuralText(text)
    .replace(/[^a-z0-9%$.-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 || /\d/.test(token));
}

function paragraphs(text) {
  return String(text || "")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.split(/\s+/).length >= 18);
}

function bestTokenRecall(sourceParagraph, candidateParagraphs) {
  const sourceTokens = new Set(contentTokens(sourceParagraph));
  if (!sourceTokens.size) return 1;
  let best = 0;
  for (const candidate of candidateParagraphs) {
    const target = new Set(contentTokens(candidate));
    let shared = 0;
    for (const token of sourceTokens) if (target.has(token)) shared += 1;
    best = Math.max(best, shared / sourceTokens.size);
  }
  return best;
}

export function auditLongDocumentStructure(source, candidate) {
  const artifacts = extractFormalArtifacts(source);
  const candidateNormalised = normaliseStructuralText(candidate);
  const missingArtifacts = artifacts.filter((item) => !candidateNormalised.includes(normaliseStructuralText(item)));
  const candidateParagraphs = paragraphs(candidate);
  const possiblePassageLosses = paragraphs(source)
    .map((paragraph) => ({ paragraph, best_token_recall: bestTokenRecall(paragraph, candidateParagraphs) }))
    .filter((item) => item.best_token_recall < 0.18)
    .sort((a, b) => a.best_token_recall - b.best_token_recall)
    .slice(0, 30)
    .map((item) => ({
      excerpt: item.paragraph.slice(0, 320),
      best_token_recall: Number(item.best_token_recall.toFixed(3)),
    }));

  return {
    version: "long-document-structure-v1",
    passed: missingArtifacts.length === 0,
    artifact_count: artifacts.length,
    missing_artifacts: missingArtifacts,
    possible_substantive_passage_losses: possiblePassageLosses,
    note: "Missing formal artefacts are a hard completeness failure. Possible substantive passage losses are conservative review signals because genuine reconstruction can reduce lexical overlap.",
  };
}
