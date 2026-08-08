import { llmProvider } from "./llmProvider.js";
import { parseStructuredResponseText } from "./modelResponse.js";
import { extractProtectedSpans } from "./protect.js";
import { auditPreservation } from "./preservation.js";
import { splitSentences } from "./sentences.js";

const ALLOWED_CATEGORIES = new Set([
  "grammar_agreement",
  "article_determiner",
  "singular_plural",
  "possessive",
  "word_form",
  "preposition_idiom",
  "punctuation",
  "local_clarity",
]);

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(needle, start);
    if (index < 0) break;
    count += 1;
    start = index + Math.max(1, needle.length);
  }
  return count;
}

function tokens(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

function tokenOverlap(source, replacement) {
  const left = new Set(tokens(source));
  const right = new Set(tokens(replacement));
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / Math.min(left.size, right.size);
}

function preservationPassed(audit) {
  return Boolean(
    audit &&
    audit.numbers_ok !== false &&
    audit.citations_ok !== false &&
    audit.technical_terms_ok !== false &&
    audit.quotes_ok !== false &&
    audit.study_stage_ok !== false &&
    audit.researcher_voice_ok !== false &&
    audit.document_structure_ok !== false &&
    audit.new_factual_claims_detected !== true
  );
}

function protectedValues(spans) {
  return [
    ...(spans?.citations || []),
    ...(spans?.numbers || []),
    ...(spans?.ranges || []),
    ...(spans?.monetary || []),
    ...(spans?.statNotation || []),
    ...(spans?.quotes || []),
    ...(spans?.acronyms || []),
  ].filter(Boolean);
}

function editPreservesProtected(edit, spans) {
  for (const value of protectedValues(spans)) {
    if (edit.source_span.includes(value) && !edit.replacement.includes(value)) return false;
  }
  return true;
}

function buildSystemPrompt({ maxEdits }) {
  return [
    "You are a surgical academic copy editor working on text that already has strong authorial texture.",
    "Your job is NOT to rewrite the document, modernise its style, increase sophistication, vary wording for its own sake, or make it sound more polished.",
    "Identify only objective or near-objective local defects whose correction improves correctness or clarity while preserving the writer's wording, rhythm, sequencing, examples, citations and scholarly personality.",
    "Allowed edit categories are: grammar_agreement, article_determiner, singular_plural, possessive, word_form, preposition_idiom, punctuation, local_clarity.",
    "Do not propose paragraph reordering, new transitions, new examples, new claims, new citations, synonym substitution for elegance, nominalisation, rhetorical tightening, stylistic upgrading, or sentence reconstruction merely because an alternative sounds more academic.",
    "For local_clarity, change the smallest possible span. Do not replace a whole sentence when a clause or phrase can be repaired.",
    "Every edit must quote an exact SOURCE SPAN copied verbatim from the user text. The source span should normally be between 2 and 35 words and must be uniquely identifiable.",
    "The replacement must preserve all numbers, citations, quotations, acronyms, technical terms, factual relationships and study-stage meaning contained in that span.",
    `Return at most ${maxEdits} edits. If the passage genuinely needs fewer edits, return fewer. If no safe local correction is justified, return an empty edits array.`,
    "Return exactly one JSON object and nothing else in this shape:",
    '{"edits":[{"source_span":"exact source text","replacement":"minimal corrected text","category":"grammar_agreement","reason":"brief explanation","confidence":0.95}]}',
  ].join("\n");
}

function buildRepairPrompt() {
  return [
    "You are a JSON syntax recovery utility.",
    "The user message contains a response intended to be one JSON object with an edits array.",
    "Repair JSON syntax only. Do not add, remove, rewrite or reinterpret any proposed edit.",
    "Return exactly one valid JSON object and nothing else.",
  ].join("\n");
}

async function proposeEdits(sourceText, maxEdits) {
  const first = await llmProvider.callAnthropic({
    system: buildSystemPrompt({ maxEdits }),
    messages: [{ role: "user", content: sourceText }],
    maxTokens: 3000,
  });
  let parsed = parseStructuredResponseText(first.text);
  let repairUsed = false;
  if (!parsed.ok) {
    const repaired = await llmProvider.callAnthropic({
      system: buildRepairPrompt(),
      messages: [{ role: "user", content: first.text }],
      maxTokens: 3000,
    });
    parsed = parseStructuredResponseText(repaired.text);
    repairUsed = true;
  }
  if (!parsed.ok || !Array.isArray(parsed.parsed?.edits)) {
    const err = new Error("Surgical edit pass did not return a valid edits array.");
    err.code = "INVALID_SURGICAL_EDIT_RESPONSE";
    throw err;
  }
  return { edits: parsed.parsed.edits, repairUsed };
}

function sentenceIndexForPosition(sourceText, position) {
  const sentences = splitSentences(sourceText);
  let cursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const idx = sourceText.indexOf(sentences[i], cursor);
    if (idx < 0) continue;
    const end = idx + sentences[i].length;
    if (position >= idx && position <= end) return i;
    cursor = end;
  }
  return null;
}

function normaliseProposals(sourceText, proposals, spans) {
  const accepted = [];
  const rejected = [];
  const seenSpans = new Set();

  for (const raw of proposals) {
    const edit = {
      source_span: typeof raw?.source_span === "string" ? raw.source_span : "",
      replacement: typeof raw?.replacement === "string" ? raw.replacement : "",
      category: String(raw?.category || "").trim(),
      reason: String(raw?.reason || "").trim(),
      confidence: Number(raw?.confidence),
    };

    let rejectReason = null;
    if (!ALLOWED_CATEGORIES.has(edit.category)) rejectReason = "category_not_allowed";
    else if (!edit.source_span.trim() || !edit.replacement.trim()) rejectReason = "empty_span_or_replacement";
    else if (edit.source_span === edit.replacement) rejectReason = "no_change";
    else if (edit.source_span.length > 260 || edit.replacement.length > 320) rejectReason = "edit_too_large";
    else if (countOccurrences(sourceText, edit.source_span) !== 1) rejectReason = "source_span_not_unique";
    else if (seenSpans.has(edit.source_span)) rejectReason = "duplicate_span";
    else if (Number.isFinite(edit.confidence) && edit.confidence < 0.72) rejectReason = "low_confidence";
    else {
      const ratio = edit.replacement.length / Math.max(1, edit.source_span.length);
      if (ratio < 0.45 || ratio > 1.8) rejectReason = "replacement_size_out_of_bounds";
      else {
        const wc = tokens(edit.source_span).length;
        const overlap = tokenOverlap(edit.source_span, edit.replacement);
        const threshold = wc <= 5 ? 0.25 : 0.45;
        if (overlap < threshold) rejectReason = "replacement_not_surgical";
        else if (!editPreservesProtected(edit, spans)) rejectReason = "protected_span_changed";
      }
    }

    if (rejectReason) {
      rejected.push({ ...edit, rejected_reason: rejectReason });
      continue;
    }

    const position = sourceText.indexOf(edit.source_span);
    accepted.push({
      ...edit,
      confidence: Number.isFinite(edit.confidence) ? edit.confidence : 0.8,
      position,
      sentence_index: sentenceIndexForPosition(sourceText, position),
    });
    seenSpans.add(edit.source_span);
  }

  return { accepted, rejected };
}

function nonOverlappingEdits(edits) {
  const sorted = [...edits].sort((a, b) => b.confidence - a.confidence || a.position - b.position);
  const selected = [];
  for (const edit of sorted) {
    const start = edit.position;
    const end = start + edit.source_span.length;
    const overlaps = selected.some((other) => {
      const otherStart = other.position;
      const otherEnd = otherStart + other.source_span.length;
      return start < otherEnd && end > otherStart;
    });
    if (!overlaps) selected.push(edit);
  }
  return selected;
}

function applyEdits(sourceText, edits) {
  let out = sourceText;
  for (const edit of [...edits].sort((a, b) => b.position - a.position)) {
    out = out.slice(0, edit.position) + edit.replacement + out.slice(edit.position + edit.source_span.length);
  }
  return out;
}

export function applySurgicalEditProposals({
  sourceText,
  proposals,
  maxChangedSentenceRatio = 0.35,
}) {
  const sentences = splitSentences(sourceText);
  const sentenceCeiling = Math.max(1, Math.floor(sentences.length * Math.max(0.08, Math.min(0.50, Number(maxChangedSentenceRatio) || 0.35))));
  const spans = extractProtectedSpans(sourceText);
  const normalised = normaliseProposals(sourceText, proposals || [], spans);
  const candidates = nonOverlappingEdits(normalised.accepted);

  const selected = [];
  const selectedSentenceIndexes = new Set();
  const rejected = [...normalised.rejected];

  for (const edit of candidates) {
    const nextSentenceIndexes = new Set(selectedSentenceIndexes);
    if (edit.sentence_index !== null) nextSentenceIndexes.add(edit.sentence_index);
    if (nextSentenceIndexes.size > sentenceCeiling) {
      rejected.push({ ...edit, rejected_reason: "sentence_change_ceiling" });
      continue;
    }

    const tentative = [...selected, edit];
    const tentativeText = applyEdits(sourceText, tentative);
    const audit = auditPreservation(sourceText, tentativeText, spans);
    if (!preservationPassed(audit)) {
      rejected.push({ ...edit, rejected_reason: "preservation_audit_failed" });
      continue;
    }

    selected.push(edit);
    selectedSentenceIndexes.clear();
    for (const index of nextSentenceIndexes) selectedSentenceIndexes.add(index);
  }

  const revisedText = applyEdits(sourceText, selected);
  const preservation = auditPreservation(sourceText, revisedText, spans);
  const affectedSentences = selectedSentenceIndexes.size;

  return {
    revised_text: revisedText,
    preservation,
    applied_edit_count: selected.length,
    affected_sentence_count: affectedSentences,
    sentence_change_ceiling: sentenceCeiling,
    max_changed_sentence_ratio: maxChangedSentenceRatio,
    applied_edits: selected.map(({ position, sentence_index, ...edit }) => edit),
    rejected_edits: rejected.map(({ position, sentence_index, ...edit }) => edit),
    safe_change_made: selected.length > 0,
  };
}

export async function surgicalHumanEdit({
  sourceText,
  maxChangedSentenceRatio = 0.35,
  maxEdits = null,
}) {
  const sentences = splitSentences(sourceText);
  const editCeiling = Math.max(1, Math.min(24, Number(maxEdits) || Math.ceil(sentences.length * 0.35)));
  const proposal = await proposeEdits(sourceText, editCeiling);
  const applied = applySurgicalEditProposals({
    sourceText,
    proposals: proposal.edits,
    maxChangedSentenceRatio,
  });

  return {
    attempted: true,
    ...applied,
    proposed_edit_count: proposal.edits.length,
    response_repair_used: proposal.repairUsed,
    note: applied.safe_change_made
      ? "Only local grammar/clarity edits that survived preservation and breadth checks were applied; all other source text remained untouched."
      : "No proposed local edit survived the surgical safety checks; the source remains unchanged and this is reported explicitly rather than presented as a successful revision.",
  };
}
