const ARGUMENT_TYPES = new Set([
  "claim",
  "mechanism",
  "qualification",
  "assumption",
  "counterargument",
  "interpretation",
  "implication",
  "boundary",
  "evidence_need",
  "methodological_choice",
]);

const RELATIONSHIPS = new Set([
  "supports",
  "qualifies",
  "contradicts",
  "contextualises",
  "insufficient",
  "candidate",
]);

const STOPWORDS = new Set(`a an and are as at be been being but by can could did do does for from had has have having he her hers him his how i if in into is it its itself may might more most must no not of on or our ours she should so some such than that the their theirs them then there these they this those through to too under up very was we were what when where which who why will with would you your yours`.split(/\s+/));

function cleanString(value, max = 4000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeType(value) {
  const normal = cleanString(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  return ARGUMENT_TYPES.has(normal) ? normal : "claim";
}

function safeStatus(value) {
  const normal = cleanString(value, 40).toLowerCase();
  return ["unreviewed", "accepted", "modified", "rejected"].includes(normal) ? normal : "unreviewed";
}

export function normalizeArgumentMap(raw = {}) {
  const nodes = asArray(raw.nodes).slice(0, 40).map((node, index) => ({
    id: cleanString(node?.id, 80) || `arg-${index + 1}`,
    type: safeType(node?.type),
    statement: cleanString(node?.statement, 1800),
    origin: ["researcher", "system_suggestion", "shared"].includes(node?.origin) ? node.origin : "researcher",
    researcher_status: safeStatus(node?.researcher_status),
    confidence: ["low", "moderate", "high"].includes(node?.confidence) ? node.confidence : "moderate",
    evidence_need: cleanString(node?.evidence_need, 1200),
    rationale: cleanString(node?.rationale, 1200),
  })).filter((node) => node.statement);

  return {
    version: "1.0",
    researcher_summary: cleanString(raw.researcher_summary, 3000),
    nodes,
    unresolved_questions: asArray(raw.unresolved_questions).slice(0, 8).map((x) => cleanString(x, 1200)).filter(Boolean),
    boundaries: asArray(raw.boundaries).slice(0, 12).map((x) => cleanString(x, 1200)).filter(Boolean),
    researcher_decisions: asArray(raw.researcher_decisions).slice(0, 20).map((x) => cleanString(x, 1200)).filter(Boolean),
  };
}

export function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Model returned an empty response.");
  try {
    return JSON.parse(raw);
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
  throw new Error("Model response did not contain valid JSON.");
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-']+|[-']+$/g, ""))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function uniqueTerms(text) {
  return [...new Set(tokenize(text))];
}

function wordCount(text) {
  return (String(text || "").match(/[A-Za-z0-9']+/g) || []).length;
}

export function chunkEvidenceSource(source, { targetWords = 180, maxWords = 260 } = {}) {
  const sourceId = cleanString(source?.id, 80) || "source";
  const title = cleanString(source?.title || source?.name, 300) || sourceId;
  const citation = cleanString(source?.citation, 500);
  const raw = String(source?.text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  const paragraphs = raw.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const chunks = [];
  let current = [];
  let currentWords = 0;
  let startParagraph = 1;

  function flush(endParagraph) {
    if (!current.length) return;
    const text = current.join("\n\n").trim();
    chunks.push({
      source_id: sourceId,
      source_title: title,
      citation,
      locator: `paragraphs ${startParagraph}-${endParagraph}`,
      text,
      word_count: wordCount(text),
    });
    current = [];
    currentWords = 0;
  }

  paragraphs.forEach((paragraph, index) => {
    const pWords = wordCount(paragraph);
    if (!current.length) startParagraph = index + 1;
    if (current.length && currentWords + pWords > maxWords) flush(index);
    if (!current.length) startParagraph = index + 1;
    current.push(paragraph);
    currentWords += pWords;
    if (currentWords >= targetWords) flush(index + 1);
  });
  flush(paragraphs.length);
  return chunks;
}

function overlapScore(statement, chunkText) {
  const terms = uniqueTerms(statement);
  if (!terms.length) return 0;
  const chunkTerms = new Set(uniqueTerms(chunkText));
  let matched = 0;
  let weighted = 0;
  for (const term of terms) {
    if (!chunkTerms.has(term)) continue;
    matched += 1;
    weighted += term.length >= 8 ? 1.35 : 1;
  }
  const coverage = matched / terms.length;
  const weightCoverage = weighted / Math.max(1, terms.length);
  return Number((coverage * 0.65 + weightCoverage * 0.35).toFixed(4));
}

export function retrieveEvidenceCandidates(argumentMap, sources, { perNode = 3 } = {}) {
  const map = normalizeArgumentMap(argumentMap);
  const sourceList = asArray(sources).slice(0, 8);
  const chunks = sourceList.flatMap((source) => chunkEvidenceSource(source));
  const relevantNodes = map.nodes.filter((node) => node.researcher_status !== "rejected" && node.type !== "boundary");

  return relevantNodes.map((node) => {
    const ranked = chunks
      .map((chunk) => ({ ...chunk, retrieval_score: overlapScore(`${node.statement} ${node.evidence_need}`, chunk.text) }))
      .filter((chunk) => chunk.retrieval_score > 0)
      .sort((a, b) => b.retrieval_score - a.retrieval_score)
      .slice(0, Math.max(1, Math.min(5, perNode)));
    return { argument_id: node.id, argument_type: node.type, argument: node.statement, candidates: ranked };
  });
}

export function normalizeEvidenceLinks(raw = {}) {
  return asArray(raw.links).slice(0, 80).map((link, index) => {
    const relationship = RELATIONSHIPS.has(link?.relationship) ? link.relationship : "candidate";
    return {
      id: cleanString(link?.id, 80) || `evidence-${index + 1}`,
      argument_id: cleanString(link?.argument_id, 80),
      source_id: cleanString(link?.source_id, 80),
      source_title: cleanString(link?.source_title, 300),
      citation: cleanString(link?.citation, 500),
      locator: cleanString(link?.locator, 200),
      relationship,
      explanation: cleanString(link?.explanation, 1500),
      excerpt: cleanString(link?.excerpt, 5000),
      researcher_status: safeStatus(link?.researcher_status),
    };
  }).filter((link) => link.argument_id && link.source_id);
}

export function acceptedArgumentNodes(argumentMap) {
  return normalizeArgumentMap(argumentMap).nodes.filter((node) => node.researcher_status !== "rejected");
}

export function summarizeAgency(argumentMap) {
  const map = normalizeArgumentMap(argumentMap);
  const counts = { researcher: 0, system_suggestion: 0, shared: 0, accepted: 0, modified: 0, rejected: 0, unreviewed: 0 };
  for (const node of map.nodes) {
    counts[node.origin] += 1;
    counts[node.researcher_status] += 1;
  }
  return { node_count: map.nodes.length, ...counts };
}
