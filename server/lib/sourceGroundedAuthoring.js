import { createHash } from "node:crypto";

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "can", "do", "for", "from",
  "had", "has", "have", "how", "in", "into", "is", "it", "its", "may", "of", "on", "or", "that", "the",
  "their", "these", "this", "those", "to", "was", "were", "what", "when", "where", "which", "while", "who",
  "will", "with", "within", "would", "study", "research", "paper", "section",
]);

function text(value, max = 60000) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

function tokens(value) {
  return String(value || "").toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g)?.filter((token) => !STOP.has(token)) || [];
}

function headingLike(line) {
  const value = line.trim();
  if (!value || value.length > 150) return false;
  if (/^(section|chapter|part)\s+\d+/i.test(value)) return true;
  if (/^(introduction|background|problem statement|purpose statement|research questions?|theoretical foundation|literature review|methodology|research method|findings|discussion|limitations?|significance|conclusion|summary)/i.test(value)) return true;
  return !/[.!?;:]$/.test(value) && value.split(/\s+/).length <= 12 && /[A-Za-z]/.test(value);
}

const CITATION_PATTERN = /\((?:[^()]*(?:19|20)\d{2}[a-z]?[^()]*)\)|\b[A-Z][A-Za-z'’\-]+(?:\s+(?:et\s+al\.|and|&)\s+[A-Z][A-Za-z'’\-]+)?\s*\((?:19|20)\d{2}[a-z]?\)/g;

function citationAnchors(value) {
  return [...new Set(String(value || "").match(CITATION_PATTERN) || [])];
}

function parentheticalCitation(label) {
  const value = text(label, 500);
  if (!value) return "";
  const unwrapped = value.match(/^\((.*)\)$/)?.[1] || value;
  const narrative = unwrapped.match(/^(.*?)\s*\(([^()]+)\)$/);
  return narrative ? `(${narrative[1].trim()}, ${narrative[2].trim()})` : `(${unwrapped})`;
}

function normalizeBibliographic(source, index = 0) {
  const title = text(source?.bibliographic?.title || source?.title || source?.name, 500) || `Source ${index + 1}`;
  const author = text(source?.bibliographic?.author || source?.author, 500);
  const year = text(source?.bibliographic?.year || source?.year, 20).match(/(?:19|20)\d{2}[a-z]?/i)?.[0] || "";
  const publication = text(source?.bibliographic?.publication || source?.publication, 500);
  const doi = text(source?.bibliographic?.doi || source?.doi, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const url = text(source?.bibliographic?.url || source?.url, 500);
  const suppliedCitation = text(source?.citation, 500);
  const citation = suppliedCitation || (author && year ? `${author} (${year})` : author || (year ? `${title} (${year})` : title));
  const parenthetical_citation = suppliedCitation
    ? parentheticalCitation(suppliedCitation)
    : author && year ? `(${author}, ${year})` : "";
  const working_reference = [
    author,
    year ? `(${year}).` : "",
    title ? `${title}.` : "",
    publication ? `${publication}.` : "",
    doi ? `https://doi.org/${doi}` : url,
  ].filter(Boolean).join(" ");
  return { title, author, year, publication, doi, url, citation, parenthetical_citation, working_reference };
}

export function deriveAuthoringSections(structureText, entryMode = "develop") {
  const source = text(structureText, 30000);
  const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (headingLike(line) && sections.length < 18) {
      current = { heading: line, body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  if (!sections.length) {
    sections.push({
      heading: entryMode === "template" ? "Template-guided section" : entryMode === "rebuild" ? "Existing draft development" : "Manuscript development",
      body: lines,
    });
  }
  return sections.map((section, index) => ({
    id: `section-${index + 1}`,
    heading: section.heading,
    query: `${section.heading} ${section.body.join(" ").slice(0, 12000)}`,
    paragraphs: section.body.map((paragraph, paragraphIndex) => ({
      id: `section-${index + 1}-author-${paragraphIndex + 1}`,
      text: paragraph,
      citation_anchors: citationAnchors(paragraph),
    })),
  }));
}

function sourceUnits(source, sourceIndex) {
  let page = "";
  let counter = 0;
  const blocks = [];
  for (const raw of text(source.text, 60000).split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block) continue;
    const pageMatch = block.match(/^\[Page\s+(\d+)\]\s*/i);
    const cleaned = pageMatch ? block.slice(pageMatch[0].length).trim() : block;
    if (pageMatch) page = `Page ${pageMatch[1]}`;
    if (!cleaned || cleaned.length < 35) continue;
    const chunks = cleaned.length <= 2200
      ? [cleaned]
      : cleaned.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [cleaned];
    for (const chunk of chunks) {
      if (chunk.length < 35) continue;
      counter += 1;
      blocks.push({
        id: `src-${sourceIndex + 1}-extract-${counter}`,
        source_id: source.id,
        source_title: source.bibliographic.title,
        citation: source.citation,
        parenthetical_citation: source.bibliographic.parenthetical_citation,
        working_reference: source.bibliographic.working_reference,
        bibliographic: source.bibliographic,
        locator: page || source.locator || "",
        text: chunk,
      });
    }
  }
  return blocks;
}

function scoreUnit(section, unit) {
  const query = new Set(tokens(section.query));
  const unitTokens = tokens(unit.text);
  if (!query.size || !unitTokens.length) return 0;
  const unique = new Set(unitTokens);
  let overlap = 0;
  for (const token of unique) if (query.has(token)) overlap += 1;
  const density = overlap / Math.sqrt(Math.max(1, unique.size));
  const titleBoost = tokens(section.heading).some((token) => unique.has(token)) ? 1.5 : 0;
  return density + titleBoost;
}

export function retrieveVerbatimCandidates({ structureText, entryMode, sources, perSection = 10 }) {
  const cleanSources = (Array.isArray(sources) ? sources : []).slice(0, 12).map((source, index) => ({
    id: text(source?.id, 80) || `source-${index + 1}`,
    bibliographic: normalizeBibliographic(source, index),
    locator: text(source?.locator, 200),
    text: text(source?.text, 60000),
  })).map((source) => ({ ...source, title: source.bibliographic.title, citation: source.bibliographic.citation })).filter((source) => source.text);
  const sections = deriveAuthoringSections(structureText, entryMode);
  const units = cleanSources.flatMap(sourceUnits);
  const retrieved = sections.map((section) => ({
    ...section,
    candidates: units
      .map((unit) => ({ ...unit, score: scoreUnit(section, unit) + citationAffinity(section.query, unit) }))
      .filter((unit) => unit.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, perSection)
      .map(({ score, ...unit }) => unit),
  }));
  return { sections, sources: cleanSources, retrieved };
}

function citationAffinity(paragraph, candidate) {
  const anchors = citationAnchors(paragraph).join(" ").toLowerCase();
  if (!anchors) return 0;
  const bibliographic = candidate.bibliographic || {};
  let score = 0;
  if (bibliographic.year && anchors.includes(String(bibliographic.year).toLowerCase())) score += 4;
  const authorTokens = tokens(bibliographic.author).filter((token) => token.length > 3);
  if (authorTokens.some((token) => anchors.includes(token))) score += 6;
  return score;
}

function selectForAuthorParagraph(paragraph, candidates, used, limit = 2) {
  return candidates
    .map((candidate) => ({ candidate, score: scoreUnit({ heading: "", query: paragraph }, candidate) + citationAffinity(paragraph, candidate) }))
    .filter((row) => row.score > 0 && !used.has(row.candidate.id))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
    .slice(0, limit)
    .map((row) => row.candidate);
}

function buildExistingStructureSections(retrieval) {
  const used = new Set();
  return retrieval.retrieved.map((section) => {
    const blocks = [];
    const paragraphs = section.paragraphs || [];
    for (const paragraph of paragraphs) {
      blocks.push({
        id: paragraph.id,
        type: "author_text",
        text: paragraph.text,
        locked: true,
        citation_anchors: paragraph.citation_anchors,
      });
      if (!paragraph.citation_anchors.length) continue;
      const selected = selectForAuthorParagraph(paragraph.text, section.candidates, used, 2);
      for (const extract of selected) {
        used.add(extract.id);
        blocks.push({
          id: `${paragraph.id}-alignment-${extract.id}`,
          type: "link",
          text: `Source alignment for ${paragraph.citation_anchors.join("; ")}:`,
          editable: true,
          alignment_only: true,
        });
        blocks.push({ ...extract, type: "extract", locked: true, aligned_to: paragraph.id });
      }
    }
    return { id: section.id, heading: section.heading, blocks };
  });
}

function minimalLink(previous, current) {
  if (!previous) return "";
  if (previous.source_id === current.source_id) return "The same study continued by stating that";
  return "The discussion can then move to the related evidence from the next study:";
}

export function deterministicSourceAssembly(input) {
  const retrieval = retrieveVerbatimCandidates(input);
  const hasExistingBody = retrieval.sections.some((section) => section.paragraphs?.some((paragraph) => paragraph.text));
  const hasCitationAnchors = retrieval.sections.some((section) => section.paragraphs?.some((paragraph) => paragraph.citation_anchors?.length));
  const preserveExisting = input.entryMode === "rebuild" || (input.entryMode === "template" && hasExistingBody && hasCitationAnchors);
  const used = new Set();
  const groundUpSections = retrieval.retrieved.map((section) => {
    let selected = section.candidates.filter((candidate) => !used.has(candidate.id)).slice(0, 5);
    if (!selected.length) selected = section.candidates.slice(0, 3);
    selected.forEach((candidate) => used.add(candidate.id));
    return {
      id: section.id,
      heading: section.heading,
      blocks: selected.flatMap((extract, index) => [
        ...(index ? [{ id: `${section.id}-link-${index}`, type: "link", text: minimalLink(selected[index - 1], extract), editable: true }] : []),
        { ...extract, type: "extract", locked: true },
      ]),
    };
  });
  const sections = preserveExisting ? buildExistingStructureSections(retrieval) : groundUpSections;
  return {
    entry_mode: input.entryMode || "develop",
    sections,
    source_count: retrieval.sources.length,
    extract_count: sections.reduce((sum, section) => sum + section.blocks.filter((block) => block.type === "extract").length, 0),
    assembly_mode: "local_verbatim_retrieval",
    workflow_mode: preserveExisting ? "existing_structure_citation_alignment" : "ground_up_source_scaffold",
    model_calls: 0,
    reference_records: retrieval.sources.map((source) => ({ source_id: source.id, ...source.bibliographic })),
    cache_key: createHash("sha256").update(JSON.stringify({
      entryMode: input.entryMode,
      structureText: text(input.structureText, 30000),
      sources: retrieval.sources.map((source) => [source.bibliographic, source.text]),
    })).digest("hex").slice(0, 24),
  };
}

export function normalizeGuidedPlan(raw, localAssembly) {
  const byId = new Map(localAssembly.sections.flatMap((section) => section.blocks.filter((block) => block.type === "extract").map((block) => [block.id, block])));
  const localSections = new Map(localAssembly.sections.map((section) => [section.id, section]));
  const planned = Array.isArray(raw?.sections) ? raw.sections : [];
  const sections = [];
  for (const row of planned.slice(0, 18)) {
    const base = localSections.get(text(row?.section_id, 80));
    if (!base) continue;
    const ids = Array.isArray(row?.ordered_extract_ids) ? row.ordered_extract_ids.map((id) => text(id, 100)).filter((id) => byId.has(id)) : [];
    const links = Array.isArray(row?.links) ? row.links : [];
    const selected = ids.length ? ids.map((id) => byId.get(id)) : base.blocks.filter((block) => block.type === "extract");
    const blocks = selected.flatMap((extract, index) => {
      if (!index) return [extract];
      const supplied = links.find((link) => text(link?.before_extract_id, 100) === extract.id);
      const linkText = text(supplied?.link, 240) || minimalLink(selected[index - 1], extract);
      return [{ id: `${base.id}-link-${index}`, type: "link", text: linkText, editable: true }, extract];
    });
    sections.push({ id: base.id, heading: base.heading, blocks });
  }
  const merged = sections.length ? sections : localAssembly.sections;
  return {
    ...localAssembly,
    sections: merged,
    extract_count: merged.reduce((sum, section) => sum + section.blocks.filter((block) => block.type === "extract").length, 0),
    assembly_mode: sections.length ? "guided_verbatim_ordering" : "local_verbatim_retrieval",
    model_calls: sections.length ? 1 : 0,
  };
}

export function verifyAssemblyExtracts(assembly, sources) {
  const sourceTexts = new Map((sources || []).map((source) => [source.id, text(source.text, 60000)]));
  const failures = [];
  for (const section of assembly?.sections || []) {
    for (const block of section.blocks || []) {
      if (block.type !== "extract") continue;
      const sourceText = sourceTexts.get(block.source_id) || "";
      if (!sourceText.includes(block.text)) failures.push(block.id);
    }
  }
  return { exact: failures.length === 0, failures };
}
