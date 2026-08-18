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
  "idiom_usage",
  "punctuation",
  "local_clarity",
  "sentence_grammar_repair",
]);

const CLEAR_SEVERITIES = new Set(["clear", "required", "high"]);

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

function occurrencePositions(text, needle) {
  const positions = [];
  if (!needle) return positions;
  let start = 0;
  while (true) {
    const index = text.indexOf(needle, start);
    if (index < 0) break;
    positions.push(index);
    start = index + Math.max(1, needle.length);
  }
  return positions;
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
    audit.rhetorical_semantic_ok !== false &&
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

function buildSystemPrompt({ maxEdits, pass = 1, targetHint = null, priorEdits = [], rejectedEdits = [] }) {
  const passInstruction = pass === 1
    ? [
        "Perform an exhaustive sentence-by-sentence defect scan before proposing edits.",
        "Do NOT confuse preservation with leaving grammatical mistakes untouched. Every clear grammar, agreement, determiner, singular/plural, possessive, word-form, preposition/idiom or genuinely local clarity defect should be reported, up to the edit ceiling.",
      ]
    : [
        "This is an omission-audit pass. A first pass has already proposed some edits. Scan the source again specifically for CLEAR defects that were missed.",
        "Do not repeat a prior proposal unless you can express the same correction with a smaller, safer or uniquely anchored source span.",
        "Do not manufacture edits to satisfy a numeric target. If no additional clear defect exists, return an empty edits array.",
      ];

  const priorSummary = priorEdits.length
    ? `Prior proposals already considered: ${priorEdits.slice(0, 24).map((e) => JSON.stringify({ source_span: e.source_span, replacement: e.replacement, category: e.category })).join(" | ")}`
    : "";
  const rejectedSummary = rejectedEdits.length
    ? `Some earlier proposals were rejected by deterministic safeguards. If the underlying correction is genuinely necessary, re-propose it using a narrower exact span or better local anchoring: ${rejectedEdits.slice(0, 16).map((e) => JSON.stringify({ source_span: e.source_span, rejected_reason: e.rejected_reason })).join(" | ")}`
    : "";
  const targetLine = Number.isFinite(Number(targetHint)) && Number(targetHint) > 0
    ? `The earlier planner identified about ${Number(targetHint)} sentences requiring intervention. Treat this only as an omission-checking clue, NEVER as a quota.`
    : "";

  return [
    "You are a defect-led academic copy editor working on text that already has strong authorial texture.",
    "Your task is to CORRECT genuine defects while preserving the writer. It is not to polish clean prose, standardise personality, modernise style, inflate vocabulary, or make every sentence sound publication-ready.",
    ...passInstruction,
    "Allowed categories: grammar_agreement, article_determiner, singular_plural, possessive, word_form, preposition_idiom, idiom_usage, punctuation, local_clarity, sentence_grammar_repair.",
    "Mark severity as clear when a correction is genuinely warranted by grammar/usage/meaning. Mark optional only when the source is acceptable and the change is merely stylistic. Optional edits will normally be rejected downstream.",
    "For local_clarity, alter the smallest possible phrase or clause. sentence_grammar_repair may replace a full sentence only when the sentence is grammatically malformed and a phrase-level patch cannot repair it safely.",
    "Preserve the author's cadence, paragraph order, rhetorical progression, degree of explicitness, recurring terminology, examples, citations and scholarly personality. Unevenness, repetition, older phrasing and long sentences are NOT defects by themselves.",
    "Never add new claims, examples, citations, statistics, mechanisms or interpretations. Never change the meaning simply to improve elegance.",
    "Every edit must quote an exact SOURCE SPAN copied verbatim from the user text. Prefer a unique span of 2-35 words. If the same span occurs more than once, provide occurrence_number (1-based) and, where useful, exact context_before/context_after copied from the source.",
    "The replacement must preserve all numbers, citations, quotations, acronyms, technical terms, factual relationships and study-stage meaning inside the span.",
    "Examples of the distinction: 'stakeholders interests' -> \"stakeholders' interests\" is a required possessive correction. 'an actionable variables' -> 'actionable variables' is a required determiner/number correction. Recasting a correct sentence with more sophisticated vocabulary is optional stylistic re-authoring and must not be proposed as clear.",
    targetLine,
    priorSummary,
    rejectedSummary,
    `Return every clear defect you can justify, up to ${maxEdits} edits. Fewer is correct only when the source genuinely contains fewer clear defects.`,
    "Return exactly one JSON object and nothing else in this shape:",
    '{"edits":[{"source_span":"exact source text","replacement":"minimal corrected text","category":"grammar_agreement","severity":"clear","reason":"brief explanation","confidence":0.95,"occurrence_number":1,"context_before":"","context_after":""}]}',
  ].filter(Boolean).join("\n");
}

function buildRepairPrompt() {
  return [
    "You are a JSON syntax recovery utility.",
    "The user message contains a response intended to be one JSON object with an edits array.",
    "Repair JSON syntax only. Do not add, remove, rewrite or reinterpret any proposed edit.",
    "Return exactly one valid JSON object and nothing else.",
  ].join("\n");
}

async function proposeEdits(sourceText, { maxEdits, pass = 1, targetHint = null, priorEdits = [], rejectedEdits = [] }) {
  const first = await llmProvider.callAnthropic({
    system: buildSystemPrompt({ maxEdits, pass, targetHint, priorEdits, rejectedEdits }),
    messages: [{ role: "user", content: sourceText }],
    maxTokens: pass === 1 ? 4200 : 3600,
  });
  let parsed = parseStructuredResponseText(first.text);
  let repairUsed = false;
  if (!parsed.ok) {
    const repaired = await llmProvider.callAnthropic({
      system: buildRepairPrompt(),
      messages: [{ role: "user", content: first.text }],
      maxTokens: 3600,
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

function resolvePosition(sourceText, edit) {
  const positions = occurrencePositions(sourceText, edit.source_span);
  if (positions.length === 1) return { position: positions[0], reason: null };
  if (!positions.length) return { position: -1, reason: "source_span_not_found" };

  const occurrence = Number(edit.occurrence_number);
  if (Number.isInteger(occurrence) && occurrence >= 1 && occurrence <= positions.length) {
    return { position: positions[occurrence - 1], reason: null };
  }

  const before = String(edit.context_before || "");
  const after = String(edit.context_after || "");
  if (before || after) {
    const matches = positions.filter((position) => {
      const left = sourceText.slice(Math.max(0, position - before.length), position);
      const rightStart = position + edit.source_span.length;
      const right = sourceText.slice(rightStart, rightStart + after.length);
      return (!before || left === before) && (!after || right === after);
    });
    if (matches.length === 1) return { position: matches[0], reason: null };
  }

  return { position: -1, reason: "source_span_not_unique" };
}

function normaliseProposals(sourceText, proposals, spans) {
  const accepted = [];
  const rejected = [];
  const seenLocations = new Set();

  for (const raw of proposals) {
    const edit = {
      source_span: typeof raw?.source_span === "string" ? raw.source_span : "",
      replacement: typeof raw?.replacement === "string" ? raw.replacement : "",
      category: String(raw?.category || "").trim(),
      severity: String(raw?.severity || "clear").trim().toLowerCase(),
      reason: String(raw?.reason || "").trim(),
      confidence: Number(raw?.confidence),
      occurrence_number: Number(raw?.occurrence_number),
      context_before: typeof raw?.context_before === "string" ? raw.context_before : "",
      context_after: typeof raw?.context_after === "string" ? raw.context_after : "",
    };

    let rejectReason = null;
    if (!ALLOWED_CATEGORIES.has(edit.category)) rejectReason = "category_not_allowed";
    else if (!CLEAR_SEVERITIES.has(edit.severity)) rejectReason = "optional_style_edit";
    else if (!edit.source_span.trim() || !edit.replacement.trim()) rejectReason = "empty_span_or_replacement";
    else if (edit.source_span === edit.replacement) rejectReason = "no_change";
    else if (edit.source_span.length > 420 || edit.replacement.length > 500) rejectReason = "edit_too_large";
    else if (Number.isFinite(edit.confidence) && edit.confidence < 0.70) rejectReason = "low_confidence";

    const resolved = rejectReason ? { position: -1, reason: rejectReason } : resolvePosition(sourceText, edit);
    if (!rejectReason && resolved.reason) rejectReason = resolved.reason;

    if (!rejectReason) {
      const ratio = edit.replacement.length / Math.max(1, edit.source_span.length);
      if (ratio < 0.40 || ratio > 1.95) rejectReason = "replacement_size_out_of_bounds";
      else {
        const wc = tokens(edit.source_span).length;
        const overlap = tokenOverlap(edit.source_span, edit.replacement);
        const threshold = edit.category === "sentence_grammar_repair" ? 0.52 : wc <= 5 ? 0.20 : 0.40;
        if (overlap < threshold) rejectReason = "replacement_not_surgical";
        else if (!editPreservesProtected(edit, spans)) rejectReason = "protected_span_changed";
      }
    }

    if (!rejectReason) {
      const locationKey = `${resolved.position}:${edit.source_span.length}`;
      if (seenLocations.has(locationKey)) rejectReason = "duplicate_location";
      else seenLocations.add(locationKey);
    }

    if (rejectReason) {
      rejected.push({ ...edit, rejected_reason: rejectReason });
      continue;
    }

    accepted.push({
      ...edit,
      confidence: Number.isFinite(edit.confidence) ? edit.confidence : 0.82,
      position: resolved.position,
      sentence_index: sentenceIndexForPosition(sourceText, resolved.position),
    });
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

function rejectionSummary(rejected) {
  const summary = {};
  for (const edit of rejected || []) {
    const key = edit.rejected_reason || "unknown";
    summary[key] = (summary[key] || 0) + 1;
  }
  return summary;
}

function executionStatus(applied, rejected, preservation) {
  if (!preservationPassed(preservation)) return "preservation_failed";
  if (!applied.length) return "no_safe_edit";
  const consideredClear = applied.length + rejected.filter((e) => e.rejected_reason !== "optional_style_edit").length;
  const coverage = consideredClear ? applied.length / consideredClear : 1;
  if (consideredClear >= 4 && coverage < 0.60) return "surgical_partial";
  return "surgical_plan_passed";
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
  const status = executionStatus(selected, rejected, preservation);
  const consideredClear = selected.length + rejected.filter((e) => e.rejected_reason !== "optional_style_edit").length;
  const coverageRatio = consideredClear ? selected.length / consideredClear : 1;

  return {
    revised_text: revisedText,
    preservation,
    applied_edit_count: selected.length,
    affected_sentence_count: affectedSentences,
    sentence_change_ceiling: sentenceCeiling,
    max_changed_sentence_ratio: maxChangedSentenceRatio,
    applied_edits: selected.map(({ position, sentence_index, ...edit }) => edit),
    rejected_edits: rejected.map(({ position, sentence_index, ...edit }) => edit),
    rejection_summary: rejectionSummary(rejected),
    considered_clear_edit_count: consideredClear,
    edit_acceptance_ratio: Number(coverageRatio.toFixed(3)),
    execution_status: status,
    execution_passed: status === "surgical_plan_passed",
    safe_change_made: selected.length > 0,
  };
}

export async function surgicalHumanEdit({
  sourceText,
  maxChangedSentenceRatio = 0.35,
  maxEdits = null,
  targetInterventions = null,
}) {
  const sentences = splitSentences(sourceText);
  const editCeiling = Math.max(1, Math.min(32, Number(maxEdits) || Math.ceil(sentences.length * 0.55)));
  const first = await proposeEdits(sourceText, {
    maxEdits: editCeiling,
    pass: 1,
    targetHint: targetInterventions,
  });

  let allProposals = [...first.edits];
  let applied = applySurgicalEditProposals({
    sourceText,
    proposals: allProposals,
    maxChangedSentenceRatio,
  });

  const targetHint = Number.isFinite(Number(targetInterventions)) && Number(targetInterventions) > 0
    ? Math.min(applied.sentence_change_ceiling, Number(targetInterventions))
    : Math.min(applied.sentence_change_ceiling, Math.max(3, Math.ceil(sentences.length * 0.18)));

  let second = null;
  const needsOmissionAudit =
    applied.affected_sentence_count < targetHint &&
    allProposals.length < editCeiling * 1.5;

  if (needsOmissionAudit) {
    second = await proposeEdits(sourceText, {
      maxEdits: Math.max(4, Math.min(editCeiling, 20)),
      pass: 2,
      targetHint,
      priorEdits: first.edits,
      rejectedEdits: applied.rejected_edits,
    });
    allProposals = [...allProposals, ...second.edits];
    applied = applySurgicalEditProposals({
      sourceText,
      proposals: allProposals,
      maxChangedSentenceRatio,
    });
  }

  return {
    attempted: true,
    ...applied,
    proposed_edit_count: allProposals.length,
    first_pass_proposed: first.edits.length,
    omission_audit_used: Boolean(second),
    omission_audit_proposed: second?.edits?.length || 0,
    response_repair_used: Boolean(first.repairUsed || second?.repairUsed),
    target_interventions_hint: targetHint,
    note: applied.safe_change_made
      ? `Defect-led recovery applied ${applied.applied_edit_count} bounded correction(s) across ${applied.affected_sentence_count} sentence(s). Clean source wording remained untouched; ${applied.rejected_edits.length} proposal(s) were rejected by safeguards.`
      : "No proposed clear local edit survived the surgical safety checks; the source remains unchanged and is reported explicitly as a non-edit result.",
  };
}

