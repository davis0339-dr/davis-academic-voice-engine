import { createHash } from "node:crypto";
import {
  HUMAN_DISCOURSE_GLOBAL_RULES,
  HUMAN_DISCOURSE_MOVES,
  HUMAN_DISCOURSE_PROFILES_VERSION,
} from "../data/humanDiscourseProfiles.js";
import { inferRhetoricalJob } from "./humanDiscourseRetrieval.js";
import { retrieveVerbatimCandidates } from "./sourceGroundedAuthoring.js";

export const MAX_SYNTHESIS_STRUCTURE_CHARS = 120000;
export const MIN_SYNTHESIS_TARGET_WORDS = 400;
export const MAX_SYNTHESIS_TARGET_WORDS = 6000;

const RELATIONSHIPS = new Set([
  "supports", "contrasts", "qualifies", "extends", "defines", "explains_mechanism",
  "distinguishes_measure", "supplies_method", "supplies_finding", "sets_boundary", "contextualises",
]);
const QUOTE_POLICIES = new Set(["none", "selective", "source_heavy"]);

function clean(value, max = 4000) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

function words(value) {
  return String(value || "").match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) || [];
}

function clampTargetWords(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1800;
  return Math.max(MIN_SYNTHESIS_TARGET_WORDS, Math.min(MAX_SYNTHESIS_TARGET_WORDS, parsed));
}

function canonical(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sectionGuidance(section) {
  const sample = `${section.heading} ${(section.paragraphs || []).map((row) => row.text).join(" ").slice(0, 5000)}`;
  const job = inferRhetoricalJob(sample);
  const ranked = HUMAN_DISCOURSE_MOVES
    .filter((move) => move.jobs.includes(job) || move.jobs.includes("exposition"))
    .sort((a, b) => Number(b.jobs.includes(job)) - Number(a.jobs.includes(job)) || a.id.localeCompare(b.id));
  const selected = [];
  const profiles = new Set();
  for (const move of ranked) {
    if (selected.length >= 3) break;
    if (profiles.has(move.profileId)) continue;
    selected.push({ id: move.id, profile_id: move.profileId, instruction: move.instruction, caution: move.caution });
    profiles.add(move.profileId);
  }
  return { rhetorical_job: job, moves: selected };
}

function compactCandidate(candidate) {
  return {
    extract_id: candidate.id,
    source_id: candidate.source_id,
    source_title: candidate.source_title,
    citation: candidate.parenthetical_citation || candidate.citation,
    locator: candidate.locator,
    research_functions: candidate.research_functions,
    text: candidate.text,
  };
}

export function buildSourceSynthesisPacket({ entryMode = "develop", structureText, sources, targetWords, quotePolicy }) {
  const structure = clean(structureText, MAX_SYNTHESIS_STRUCTURE_CHARS);
  const retrieval = retrieveVerbatimCandidates({ entryMode, structureText: structure, sources, perSection: 12 });
  const verifiedSources = retrieval.sources.filter((source) => source.bibliographic?.identity_verified);
  const verifiedIds = new Set(verifiedSources.map((source) => source.id));
  const sections = retrieval.retrieved.map((section) => {
    const candidates = section.candidates.filter((candidate) => verifiedIds.has(candidate.source_id)).slice(0, 12);
    return {
      section_id: section.id,
      heading: section.heading,
      author_paragraphs: (section.paragraphs || []).map((paragraph) => ({
        paragraph_id: paragraph.id,
        text: paragraph.text,
        citation_anchors: paragraph.citation_anchors,
      })),
      evidence: candidates.map(compactCandidate),
      human_discourse_guidance: sectionGuidance(section),
    };
  });
  const packet = {
    version: "source-synthesis-v1",
    entry_mode: entryMode,
    target_words: clampTargetWords(targetWords),
    quote_policy: QUOTE_POLICIES.has(quotePolicy) ? quotePolicy : "selective",
    author_material_role: entryMode === "develop"
      ? "The researcher material supplies scope, questions, intended position and section purpose; it is not source evidence."
      : "The existing manuscript supplies structure, intended claims, qualifications and author position. Rebuild from its reasoning rather than its sentence shells.",
    sections,
    source_records: verifiedSources.map((source) => ({
      source_id: source.id,
      title: source.bibliographic.title,
      author: source.bibliographic.author,
      year: source.bibliographic.year,
      parenthetical_citation: source.bibliographic.parenthetical_citation,
      working_reference: source.bibliographic.working_reference,
    })),
    human_discourse_version: HUMAN_DISCOURSE_PROFILES_VERSION,
    human_discourse_global_rules: [...HUMAN_DISCOURSE_GLOBAL_RULES],
    excluded_unreviewed_source_ids: retrieval.sources.filter((source) => !source.bibliographic?.identity_verified).map((source) => source.id),
  };
  return {
    packet,
    retrieval,
    candidate_count: sections.reduce((sum, section) => sum + section.evidence.length, 0),
    cache_key: createHash("sha256").update(JSON.stringify(packet)).digest("hex").slice(0, 24),
  };
}

function validIds(values, known, max = 80) {
  return unique((Array.isArray(values) ? values : []).slice(0, max).map((value) => clean(value, 100))).filter((id) => known.has(id));
}

function normalizeNotebook(raw, packet, evidenceById) {
  const knownSections = new Map(packet.sections.map((section) => [section.section_id, section]));
  const knownParagraphIds = new Set(packet.sections.flatMap((section) => section.author_paragraphs.map((paragraph) => paragraph.paragraph_id)));
  const rawSections = Array.isArray(raw?.notebook?.sections) ? raw.notebook.sections : [];
  const sections = [];
  const pointIds = new Set();
  for (const [sectionIndex, row] of rawSections.slice(0, packet.sections.length).entries()) {
    const sectionId = clean(row?.section_id, 100);
    const base = knownSections.get(sectionId);
    if (!base) continue;
    const points = [];
    for (const [pointIndex, point] of (Array.isArray(row?.points) ? row.points : []).slice(0, 24).entries()) {
      let id = clean(point?.id, 100) || `${sectionId}-point-${pointIndex + 1}`;
      if (pointIds.has(id)) id = `${sectionId}-point-${sectionIndex + 1}-${pointIndex + 1}`;
      const proposition = clean(point?.proposition, 2200);
      if (!proposition) continue;
      pointIds.add(id);
      const relationship = clean(point?.relationship, 80).toLowerCase().replace(/[\s-]+/g, "_");
      points.push({
        id,
        proposition,
        relationship: RELATIONSHIPS.has(relationship) ? relationship : "supports",
        author_paragraph_ids: validIds(point?.author_paragraph_ids, knownParagraphIds, 24),
        evidence_ids: validIds(point?.evidence_ids, new Set(evidenceById.keys()), 24),
        reasoning_note: clean(point?.reasoning_note, 1800),
        tension_or_boundary: clean(point?.tension_or_boundary, 1400),
      });
    }
    sections.push({
      section_id: sectionId,
      heading: base.heading,
      section_purpose: clean(row?.section_purpose, 1400),
      points,
    });
  }
  return {
    document_position: clean(raw?.notebook?.document_position, 2400),
    sections,
    point_ids: pointIds,
  };
}

function exactQuoteRecord(row, quotePolicy, evidenceById) {
  if (quotePolicy === "none") return null;
  const id = clean(row?.id, 100);
  const extractId = clean(row?.extract_id, 100);
  const value = clean(row?.text, 1200);
  const evidence = evidenceById.get(extractId);
  const limit = quotePolicy === "source_heavy" ? 70 : 45;
  if (!id || !evidence || words(value).length < 4 || words(value).length > limit) return null;
  if (!canonical(evidence.text).includes(canonical(value))) return null;
  return { id, extract_id: extractId, source_id: evidence.source_id, text: value, locator: evidence.locator };
}

function locatorCitation(source, locator) {
  const base = source?.parenthetical_citation || "";
  if (!base) return "[citation unavailable]";
  const page = String(locator || "").match(/\bPage\s+(\d+)\b/i)?.[1];
  if (!page) return base;
  return base.replace(/\)$/, `, p. ${page})`);
}

function appendCitation(text, citations) {
  const suffix = unique(citations).join(" ");
  if (!suffix) return text;
  const value = text.trim();
  const punctuation = value.match(/([.!?])$/)?.[1];
  return punctuation ? `${value.slice(0, -1)} ${suffix}${punctuation}` : `${value} ${suffix}`;
}

function repeatedTransitionOpenings(draft) {
  const counts = new Map();
  const pattern = /(?:^|[.!?]\s+)(Furthermore|Moreover|Additionally|In addition|However|Therefore|Thus|Consequently|Nevertheless),?\s/gi;
  for (const match of draft.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 2).map(([transition, count]) => ({ transition, count }));
}

function unmarkedVerbatimMatches(rawParagraphs, evidenceById, quoteWordFloor = 12) {
  const ngrams = new Map();
  for (const evidence of evidenceById.values()) {
    const sourceWords = canonical(evidence.text).toLowerCase().match(/[a-z0-9][a-z0-9'\-]*/g) || [];
    for (let index = 0; index <= sourceWords.length - quoteWordFloor; index += 1) {
      const gram = sourceWords.slice(index, index + quoteWordFloor).join(" ");
      if (!ngrams.has(gram)) ngrams.set(gram, evidence.id);
    }
  }
  const found = [];
  for (const paragraph of rawParagraphs) {
    const withoutTokens = paragraph.text.replace(/\[\[(?:CITE|QUOTE):[^\]]+\]\]/g, " ");
    const paragraphWords = canonical(withoutTokens).toLowerCase().match(/[a-z0-9][a-z0-9'\-]*/g) || [];
    for (let index = 0; index <= paragraphWords.length - quoteWordFloor; index += 1) {
      const gram = paragraphWords.slice(index, index + quoteWordFloor).join(" ");
      const extractId = ngrams.get(gram);
      if (extractId) {
        found.push({ paragraph_id: paragraph.id, extract_id: extractId, words: gram });
        break;
      }
    }
    if (found.length >= 12) break;
  }
  return found;
}

export function normalizeSourceSynthesis(raw, build) {
  const packet = build.packet;
  const evidence = packet.sections.flatMap((section) => section.evidence).map((row) => ({ ...row, id: row.extract_id }));
  const evidenceById = new Map(evidence.map((row) => [row.extract_id, row]));
  const sourceById = new Map(packet.source_records.map((row) => [row.source_id, row]));
  const notebook = normalizeNotebook(raw, packet, evidenceById);
  const rawQuotes = Array.isArray(raw?.quotes) ? raw.quotes.slice(0, 80) : [];
  const quotes = rawQuotes.map((row) => exactQuoteRecord(row, packet.quote_policy, evidenceById)).filter(Boolean);
  const quoteById = new Map(quotes.map((row) => [row.id, row]));
  const invalidQuoteIds = rawQuotes.map((row) => clean(row?.id, 100)).filter((id) => id && !quoteById.has(id));
  const knownSections = new Map(packet.sections.map((section) => [section.section_id, section]));
  const rawSections = Array.isArray(raw?.sections) ? raw.sections : [];
  const outputSections = [];
  const usedPointIds = new Set();
  const usedExtractIds = new Set();
  const citedSourceIds = new Set();
  const insertedQuoteIds = new Set();
  const unknownTokens = [];
  const rawCitationParagraphs = [];
  const rawParagraphs = [];
  let citationInsertions = 0;

  for (const [sectionIndex, row] of rawSections.slice(0, packet.sections.length).entries()) {
    const sectionId = clean(row?.section_id, 100);
    const base = knownSections.get(sectionId);
    if (!base) continue;
    const paragraphs = [];
    let sectionQuoteCount = 0;
    const sectionQuoteLimit = packet.quote_policy === "source_heavy" ? 2 : packet.quote_policy === "selective" ? 1 : 0;
    for (const [paragraphIndex, paragraph] of (Array.isArray(row?.paragraphs) ? row.paragraphs : []).slice(0, 36).entries()) {
      const paragraphId = `${sectionId}-synthesis-${paragraphIndex + 1}`;
      let paragraphText = clean(paragraph?.text, 16000);
      if (!paragraphText) continue;
      rawParagraphs.push({ id: paragraphId, text: paragraphText });
      if (/\([^()]{0,120}(?:19|20)\d{2}[a-z]?[^()]{0,80}\)/i.test(paragraphText)) rawCitationParagraphs.push(paragraphId);
      const pointIds = validIds(paragraph?.used_point_ids, notebook.point_ids, 40);
      const extractIds = validIds(paragraph?.used_extract_ids, new Set(evidenceById.keys()), 80);
      pointIds.forEach((id) => usedPointIds.add(id));
      extractIds.forEach((id) => usedExtractIds.add(id));

      const representedSources = new Set();
      paragraphText = paragraphText.replace(/\[\[QUOTE:([A-Za-z0-9_-]+)\]\]/g, (token, quoteId) => {
        const quote = quoteById.get(quoteId);
        if (!quote) {
          unknownTokens.push(token);
          return "[verbatim passage needs researcher review]";
        }
        if (sectionQuoteCount >= sectionQuoteLimit) {
          unknownTokens.push(token);
          return "[additional verbatim passage omitted—section quotation limit reached]";
        }
        const source = sourceById.get(quote.source_id);
        sectionQuoteCount += 1;
        insertedQuoteIds.add(quoteId);
        representedSources.add(quote.source_id);
        citedSourceIds.add(quote.source_id);
        citationInsertions += 1;
        return `“${quote.text}” ${locatorCitation(source, quote.locator)}`;
      });
      paragraphText = paragraphText.replace(/\[\[CITE:([A-Za-z0-9_-]+)\]\]/g, (token, sourceId) => {
        const source = sourceById.get(sourceId);
        if (!source?.parenthetical_citation) {
          unknownTokens.push(token);
          return "[citation needs researcher review]";
        }
        representedSources.add(sourceId);
        citedSourceIds.add(sourceId);
        citationInsertions += 1;
        return source.parenthetical_citation;
      });
      const missingCitations = [];
      for (const extractId of extractIds) {
        const sourceId = evidenceById.get(extractId)?.source_id;
        const source = sourceById.get(sourceId);
        if (sourceId && source?.parenthetical_citation && !representedSources.has(sourceId)) {
          missingCitations.push(source.parenthetical_citation);
          representedSources.add(sourceId);
          citedSourceIds.add(sourceId);
          citationInsertions += 1;
        }
      }
      paragraphText = appendCitation(paragraphText, missingCitations);
      paragraphs.push({ id: paragraphId, text: paragraphText, used_point_ids: pointIds, used_extract_ids: extractIds });
    }
    if (paragraphs.length) outputSections.push({ section_id: sectionId, heading: base.heading, paragraphs });
  }

  const draft = outputSections.map((section) => `${section.heading}\n\n${section.paragraphs.map((paragraph) => paragraph.text).join("\n\n")}`).join("\n\n").trim();
  const unmarked = unmarkedVerbatimMatches(rawParagraphs, evidenceById);
  const mappedAuthorParagraphIds = new Set(notebook.sections.flatMap((section) => section.points.flatMap((point) => point.author_paragraph_ids)));
  const submittedAuthorParagraphs = packet.sections.reduce((sum, section) => sum + section.author_paragraphs.length, 0);
  const plannedPointIds = [...notebook.point_ids];
  const missingPlannedPoints = plannedPointIds.filter((id) => !usedPointIds.has(id));
  const repeatedTransitions = repeatedTransitionOpenings(draft);
  const targetWords = packet.target_words;
  const outputWords = words(draft).length;
  const targetRangeMet = outputWords >= Math.round(targetWords * 0.75) && outputWords <= Math.round(targetWords * 1.25);
  const warnings = unique([
    ...(Array.isArray(raw?.warnings) ? raw.warnings.map((row) => clean(row, 800)) : []),
    ...invalidQuoteIds.length ? [`${invalidQuoteIds.length} proposed verbatim passage(s) failed exact-source verification and were not inserted as quotations.`] : [],
    ...unknownTokens.length ? [`${unknownTokens.length} unknown citation or quotation token(s) require researcher review.`] : [],
    ...rawCitationParagraphs.length ? [`${rawCitationParagraphs.length} paragraph(s) contained author-year text outside the controlled citation tokens; verify those citations manually.`] : [],
    ...unmarked.length ? [`${unmarked.length} paragraph(s) contain a 12-word source overlap outside a verified quotation token; review quotation or paraphrase treatment.`] : [],
    ...missingPlannedPoints.length ? [`${missingPlannedPoints.length} planned reasoning point(s) did not reach the composed draft.`] : [],
    ...!targetRangeMet ? [`The completed draft contains ${outputWords.toLocaleString()} words against a ${targetWords.toLocaleString()}-word target; review whether the requested depth was reached.`] : [],
    ...repeatedTransitions.length ? ["Repeated sentence-opening transitions remain and should be reviewed for genuine argumentative function."] : [],
    ...packet.excluded_unreviewed_source_ids.length ? [`${packet.excluded_unreviewed_source_ids.length} source(s) were excluded because their identity was not researcher-confirmed.`] : [],
  ]);
  const materialReview = !draft || !citationInsertions || invalidQuoteIds.length || unknownTokens.length || unmarked.length || missingPlannedPoints.length || !targetRangeMet;

  return {
    version: "source-synthesis-v1",
    synthesis_text: draft,
    notebook: { document_position: notebook.document_position, sections: notebook.sections },
    sections: outputSections,
    verified_quotes: quotes.filter((quote) => insertedQuoteIds.has(quote.id)),
    reference_records: packet.source_records.filter((record) => citedSourceIds.has(record.source_id)),
    warnings,
    synthesis_audit: {
      status: materialReview ? "researcher_review_required" : "complete",
      target_words: targetWords,
      output_words: outputWords,
      target_range_met: targetRangeMet,
      author_paragraphs_submitted: submittedAuthorParagraphs,
      author_paragraphs_mapped: mappedAuthorParagraphIds.size,
      planned_points: plannedPointIds.length,
      used_points: usedPointIds.size,
      missing_planned_point_ids: missingPlannedPoints,
      used_extracts: usedExtractIds.size,
      citation_insertions: citationInsertions,
      cited_sources: citedSourceIds.size,
      verified_quote_count: insertedQuoteIds.size,
      invalid_quote_ids: invalidQuoteIds,
      unknown_tokens: unique(unknownTokens),
      unmarked_verbatim_matches: unmarked,
      repeated_transition_openings: repeatedTransitions,
      excluded_unreviewed_source_ids: packet.excluded_unreviewed_source_ids,
    },
    cache_key: build.cache_key,
    model_calls: 1,
  };
}
