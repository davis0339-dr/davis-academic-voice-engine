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
  return String(value || "").toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g)?.filter((token) => !STOP.has(token)).map((token) => {
    if (token.length > 7 && token.endsWith("ing")) return token.slice(0, -3);
    if (token.length > 6 && token.endsWith("ed")) return token.slice(0, -2);
    if (token.length > 6 && token.endsWith("es")) return token.slice(0, -2);
    if (token.length > 5 && token.endsWith("s")) return token.slice(0, -1);
    return token;
  }) || [];
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wordCount(value) {
  return String(value || "").match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g)?.length || 0;
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
  const metadata_confidence = text(source?.bibliographic?.metadata_confidence || source?.metadata_confidence, 30) || (author && year ? "reviewed_or_complete" : "needs_review");
  return { title, author, year, publication, doi, url, citation, parenthetical_citation, working_reference, metadata_confidence };
}

export function deriveAuthoringSections(structureText, entryMode = "develop") {
  const source = text(structureText, 30000);
  const lines = source.split(/\n{2,}/).flatMap((block) => {
    const rows = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (rows.length > 1 && headingLike(rows[0])) return [rows[0], rows.slice(1).join(" ")];
    return [rows.join(" ")];
  }).map((line) => line.trim()).filter(Boolean);
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

const NON_EVIDENCE_LINE = /^(?:electronic copy available|https?:\/\/|www\.|doi\s*:|copyright|©|all rights reserved|ssrn(?:-|\s|#)|downloaded from|accepted manuscript|forthcoming|corresponding author|e-?mail\s*:|keywords?\s*:|jel(?: classification)?\s*:|volume\s+\d+|issue\s+\d+|table\s+\d+|figure\s+\d+|references|bibliography)$/i;
const REFERENCE_LINE = /^[A-Z][A-Za-z'’\-]+,?\s+(?:[A-Z]\.?\s*){1,4}(?:,|\.)\s*\(?(?:19|20)\d{2}[a-z]?\)?/;

function usefulLine(value) {
  const line = normalizeSpace(value);
  if (!line || NON_EVIDENCE_LINE.test(line) || REFERENCE_LINE.test(line)) return false;
  if (/^(?:\d+|[ivxlcdm]+)$/i.test(line)) return false;
  if (/^[\W_]*$/.test(line) || /@/.test(line) || /(?:https?:\/\/|www\.|ssrn\.com)/i.test(line)) return false;
  if (wordCount(line) <= 3 && !/[.!?]$/.test(line)) return false;
  if (wordCount(line) <= 14 && !/[.!?]$/.test(line) && !/\b(?:is|are|was|were|has|have|find|show|suggest|examine|argue|report|use|affect|increase|decrease|provide|require|allow|explain|predict|measure|control|define|create|engage|delegate|act)\b/i.test(line)) return false;
  return true;
}

function researchFunctions(value) {
  const lower = normalizeSpace(value).toLowerCase();
  const roles = [];
  if (/\b(?:gap|void|little attention|few studies|remains unclear|unresolved|research question|objective|aims? to|problem)\b/.test(lower)) roles.push("problem_or_gap");
  if (/\b(?:theory|theoretical|because|mechanism|channel|incentive|information asymmetry|agency cost|agency relationship|risk factor|explain)\b/.test(lower)) roles.push("theory_or_mechanism");
  if (/\b(?:sample|observations?|data(?:base)?|measure[ds]?|proxy|regression|method|design|period|survey|interview|difference-in-differences|fixed effects?)\b/.test(lower)) roles.push("method_or_measure");
  if (/\b(?:we find|we show|results? (?:show|indicate|suggest)|coefficient|significant|associated with|evidence that|higher|lower|increase[sd]?|decrease[sd]?)\b/.test(lower)) roles.push("finding");
  if (/\b(?:limitation|cannot|may not|generaliz|caution|endogene|bias|however|in contrast|mixed|inconsistent|conditional|depends? on)\b/.test(lower)) roles.push("boundary_or_contrast");
  if (/\b(?:implication|contribute|important|matters?|policy|practical|benefit|relevance|therefore)\b/.test(lower)) roles.push("implication");
  return roles.length ? [...new Set(roles)] : ["background_or_context"];
}

function substantivePassage(value) {
  const normalized = normalizeSpace(value);
  const words = wordCount(normalized);
  if (words < 10 || words > 320) return false;
  if (!/[.!?]/.test(normalized)) return false;
  if (!/\b(?:is|are|was|were|be|been|has|have|had|find|show|suggest|indicate|examine|argue|report|use|affect|increase|decrease|associate|provide|require|allow|explain|predict|measure|control|define|create|engage|delegate|act|design)\b/i.test(normalized)) return false;
  const alpha = (normalized.match(/[A-Za-z]/g) || []).length;
  if (alpha / Math.max(1, normalized.length) < 0.58) return false;
  return true;
}

function pageRecords(sourceText) {
  const records = [];
  let current = { page: "", lines: [] };
  const flush = () => { if (current.lines.length) records.push(current); };
  for (const rawLine of text(sourceText, 60000).split(/\n/)) {
    const marker = rawLine.trim().match(/^\[Page\s+(\d+)\]$/i);
    if (marker) {
      flush();
      current = { page: `Page ${marker[1]}`, lines: [] };
      continue;
    }
    current.lines.push(rawLine);
  }
  flush();
  return records;
}

function sentenceWindows(lines) {
  const usable = lines.map((line, index) => {
    const marked = String(line || "").match(/^\[Line\s+(\d+)\]\s*(.*)$/i);
    return { line: Number(marked?.[1] || index + 1), text: normalizeSpace(marked?.[2] ?? line) };
  }).filter((row) => usefulLine(row.text));
  let joined = "";
  const spans = [];
  for (const row of usable) {
    if (joined) joined += " ";
    const start = joined.length;
    joined += row.text;
    spans.push({ start, end: joined.length, line: row.line });
  }
  const sentences = [];
  const pattern = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
  let match;
  while ((match = pattern.exec(joined))) {
    const value = normalizeSpace(match[0]);
    if (value) sentences.push({ text: value, start: match.index, end: pattern.lastIndex });
  }
  const windows = [];
  for (let index = 0; index < sentences.length; index += 1) {
    for (const size of [2, 1, 3]) {
      const selected = sentences.slice(index, index + size);
      const value = selected.map((row) => row.text).join(" ");
      if (substantivePassage(value)) {
        const startLine = spans.find((span) => span.end >= selected[0].start)?.line || "";
        const endLine = [...spans].reverse().find((span) => span.start <= selected[selected.length - 1].end)?.line || startLine;
        windows.push({ text: value, startLine, endLine });
        break;
      }
    }
  }
  const seen = new Set();
  return windows.filter((row) => !seen.has(row.text) && seen.add(row.text));
}

function sourceUnits(source, sourceIndex) {
  let counter = 0;
  const blocks = [];
  for (const record of pageRecords(source.text)) {
    for (const chunk of sentenceWindows(record.lines)) {
      counter += 1;
      const lineRange = chunk.startLine ? `, lines ${chunk.startLine}${chunk.endLine && chunk.endLine !== chunk.startLine ? `-${chunk.endLine}` : ""}` : "";
      blocks.push({
        id: `src-${sourceIndex + 1}-extract-${counter}`,
        source_id: source.id,
        source_title: source.bibliographic.title,
        citation: source.citation,
        parenthetical_citation: source.bibliographic.parenthetical_citation,
        working_reference: source.bibliographic.working_reference,
        bibliographic: source.bibliographic,
        locator: `${record.page || source.locator || ""}${lineRange}`,
        text: chunk.text,
        research_functions: researchFunctions(chunk.text),
      });
    }
  }
  return blocks;
}

function scoreUnit(section, unit) {
  const queryTokens = tokens(section.query);
  const unitTokens = tokens(unit.text);
  if (!queryTokens.length || !unitTokens.length) return 0;
  const query = new Set(queryTokens);
  const unique = new Set(unitTokens);
  let overlap = 0;
  for (const token of unique) if (query.has(token)) overlap += token.length >= 8 ? 1.35 : 1;
  const coverage = overlap / Math.sqrt(Math.max(12, unique.size));
  const headingBoost = tokens(section.heading).filter((token) => unique.has(token)).length * 0.35;
  const wantedRoles = new Set(researchFunctions(section.query));
  const roleBoost = unit.research_functions.some((role) => wantedRoles.has(role)) ? 1.2 : 0;
  return coverage + headingBoost + roleBoost;
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
  const retrieved = sections.map((section) => {
    const ranked = units
      .map((unit) => {
        const citation = citationAffinity(section.query, unit);
        return { ...unit, citation, score: scoreUnit(section, unit) + citation.score };
      })
      .filter((unit) => unit.score >= 0.8)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return {
      ...section,
      candidates: diversifySources(ranked, perSection).map(({ score, citation, ...unit }) => ({
        ...unit,
        match_strength: Number(score.toFixed(2)),
        citation_match: citation.matched,
      })),
    };
  });
  return { sections, sources: cleanSources, retrieved };
}

function citationAffinity(paragraph, candidate) {
  const anchors = citationAnchors(paragraph).join(" ").toLowerCase();
  if (!anchors) return { score: 0, matched: false, has_anchors: false };
  const bibliographic = candidate.bibliographic || {};
  let score = 0;
  const yearMatch = Boolean(bibliographic.year && anchors.includes(String(bibliographic.year).toLowerCase()));
  if (yearMatch) score += 3;
  const authorTokens = tokens(bibliographic.author).filter((token) => token.length > 3 && !/^(?:university|department|school|faculty)$/.test(token));
  const authorMatch = authorTokens.some((token) => anchors.includes(token));
  if (authorMatch) score += 6;
  const matched = authorMatch && (!bibliographic.year || yearMatch);
  return { score: matched ? score : 0, matched, has_anchors: true };
}

function diversifySources(rows, limit) {
  const selected = [];
  const perSource = new Map();
  for (const row of rows) {
    const count = perSource.get(row.source_id) || 0;
    if (count >= 3) continue;
    selected.push(row);
    perSource.set(row.source_id, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function claimExcerpt(paragraph) {
  return normalizeSpace(paragraph).slice(0, 420);
}

function relationshipFor(paragraph, candidate) {
  const lower = candidate.text.toLowerCase();
  if (/\b(?:however|in contrast|inconsistent|opposite|whereas)\b/.test(lower)) return "contrasts_or_qualifies";
  if (candidate.research_functions.includes("method_or_measure")) return "supplies_method_or_measure";
  if (candidate.research_functions.includes("finding")) return "supplies_finding";
  if (candidate.research_functions.includes("theory_or_mechanism")) return "supplies_mechanism";
  if (candidate.research_functions.includes("problem_or_gap")) return "supplies_problem_or_gap";
  return researchFunctions(paragraph).some((role) => candidate.research_functions.includes(role)) ? "directly_supports" : "provides_context";
}

function selectForAuthorParagraph(paragraph, candidates, used, limit = 2) {
  const hasAnchors = citationAnchors(paragraph).length > 0;
  return candidates
    .map((candidate) => {
      const citation = citationAffinity(paragraph, candidate);
      const relevance = scoreUnit({ heading: "", query: paragraph }, candidate);
      return { candidate, citation, relevance, score: relevance + citation.score };
    })
    .filter((row) => row.relevance >= 0.5 && row.score >= 1.2 && !used.has(row.candidate.id) && (!hasAnchors || row.citation.matched))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
    .slice(0, limit)
    .map((row) => ({
      ...row.candidate,
      match_strength: Number(row.score.toFixed(2)),
      citation_match: row.citation.matched,
      relationship: relationshipFor(paragraph, row.candidate),
      matched_claim: claimExcerpt(paragraph),
      selection_reason: row.citation.matched
        ? "The source identity matches a citation in this paragraph and the passage addresses the same claim."
        : "The passage addresses the same claim and research function.",
    }));
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
      if (!selected.length) {
        blocks.push({
          id: `${paragraph.id}-evidence-gap`,
          type: "review_note",
          text: `No uploaded source passage was accepted for ${paragraph.citation_anchors.join("; ")}. The system abstained instead of inserting unrelated evidence.`,
          locked: true,
          aligned_to: paragraph.id,
        });
      }
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
  const retrieval = retrieveVerbatimCandidates({ ...input, perSection: input.entryMode === "develop" ? 18 : 36 });
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
    candidate_pool: retrieval.retrieved.map((section) => ({
      section_id: section.id,
      heading: section.heading,
      paragraphs: section.paragraphs,
      candidates: section.candidates,
    })),
    evidence_map: sections.flatMap((section) => section.blocks.filter((block) => block.type === "extract").map((block) => ({
      section_id: section.id,
      section_heading: section.heading,
      extract_id: block.id,
      source_id: block.source_id,
      source_title: block.source_title,
      citation: block.citation,
      locator: block.locator,
      research_functions: block.research_functions,
      relationship: block.relationship || "candidate_for_section",
      matched_claim: block.matched_claim || "",
      selection_reason: block.selection_reason || "Selected from substantive source prose for this section.",
      text: block.text,
    }))),
    reference_records: retrieval.sources.map((source) => ({ source_id: source.id, ...source.bibliographic })),
    cache_key: createHash("sha256").update(JSON.stringify({
      entryMode: input.entryMode,
      structureText: text(input.structureText, 30000),
      sources: retrieval.sources.map((source) => [source.bibliographic, source.text]),
    })).digest("hex").slice(0, 24),
  };
}

export function normalizeGuidedPlan(raw, localAssembly) {
  const pooled = (localAssembly.candidate_pool || []).flatMap((section) => section.candidates || []);
  const byId = new Map([
    ...pooled.map((block) => [block.id, block]),
    ...localAssembly.sections.flatMap((section) => section.blocks.filter((block) => block.type === "extract").map((block) => [block.id, block])),
  ]);
  const localSections = new Map(localAssembly.sections.map((section) => [section.id, section]));
  const matches = Array.isArray(raw?.matches) ? raw.matches : [];
  if (Array.isArray(raw?.matches) && localAssembly.workflow_mode === "existing_structure_citation_alignment") {
    const paragraphById = new Map(localAssembly.sections.flatMap((section) => section.blocks.filter((block) => block.type === "author_text").map((block) => [block.id, block])));
    const byParagraph = new Map();
    for (const row of matches) {
      const paragraphId = text(row?.paragraph_id, 100);
      const extract = byId.get(text(row?.extract_id, 100));
      const paragraph = paragraphById.get(paragraphId);
      if (!paragraphId || !paragraph || !extract) continue;
      if (paragraph.citation_anchors?.length && !citationAffinity(paragraph.text, extract).matched) continue;
      if (scoreUnit({ heading: "", query: paragraph.text }, extract) < 0.45) continue;
      const list = byParagraph.get(paragraphId) || [];
      if (list.length >= 2) continue;
      list.push({
        extract: {
          ...extract,
          relationship: text(row?.relationship, 80) || relationshipFor("", extract),
          selection_reason: text(row?.reason, 360) || "Guided review found that this exact passage addresses the draft claim.",
        },
        link: text(row?.link, 240),
      });
      byParagraph.set(paragraphId, list);
    }
    const sections = localAssembly.sections.map((section) => {
      const blocks = [];
      for (const base of section.blocks) {
        if (base.type !== "author_text") continue;
        blocks.push(base);
        const selected = byParagraph.get(base.id) || [];
        if (!selected.length && base.citation_anchors?.length) {
          blocks.push({
            id: `${base.id}-evidence-gap`,
            type: "review_note",
            text: `Guided review found no direct passage among the uploaded studies for ${base.citation_anchors.join("; ")}. Nothing unrelated was inserted.`,
            locked: true,
            aligned_to: base.id,
          });
        }
        for (const [index, row] of selected.entries()) {
          blocks.push({
            id: `${base.id}-guided-link-${index + 1}`,
            type: "link",
            text: row.link || `The source passage ${row.extract.relationship.replaceAll("_", " ")} this claim:`,
            editable: true,
            alignment_only: true,
          });
          blocks.push({ ...row.extract, type: "extract", locked: true, aligned_to: base.id, matched_claim: claimExcerpt(base.text) });
        }
      }
      return { id: section.id, heading: section.heading, blocks };
    });
    return {
      ...localAssembly,
      sections,
      extract_count: sections.reduce((sum, section) => sum + section.blocks.filter((block) => block.type === "extract").length, 0),
      assembly_mode: "guided_claim_evidence_selection",
      model_calls: 1,
      evidence_map: sections.flatMap((section) => section.blocks.filter((block) => block.type === "extract").map((block) => ({
        section_id: section.id,
        section_heading: section.heading,
        extract_id: block.id,
        source_id: block.source_id,
        source_title: block.source_title,
        citation: block.citation,
        locator: block.locator,
        research_functions: block.research_functions,
        relationship: block.relationship,
        matched_claim: block.matched_claim,
        selection_reason: block.selection_reason,
        text: block.text,
      }))),
    };
  }
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
  const sourceTexts = new Map((sources || []).map((source) => [source.id, normalizeSpace(text(source.text, 60000).replace(/^\[(?:Page|Line)\s+\d+\]\s*/gim, ""))]));
  const failures = [];
  for (const section of assembly?.sections || []) {
    for (const block of section.blocks || []) {
      if (block.type !== "extract") continue;
      const sourceText = sourceTexts.get(block.source_id) || "";
      if (!sourceText.includes(normalizeSpace(block.text))) failures.push(block.id);
    }
  }
  return { exact: failures.length === 0, failures };
}
