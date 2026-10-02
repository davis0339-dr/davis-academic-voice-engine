import { auditPreservation } from "./preservation.js";
import { extractProtectedSpans } from "./protect.js";
import { classifyPreservationRelease } from "./preservationRelease.js";
import { manuscriptWordCount } from "./lengthContract.js";

// Keep offsets into the unmodified candidate. Recovery may insert prose, but
// cannot regenerate, shorten, reorder or silently replace existing paragraphs.
export function expansionParagraphs(candidateText) {
  const parts = String(candidateText || "").split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/u);
  const paragraphs = [];
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    if (index % 2 === 0 && parts[index].trim()) {
      paragraphs.push({ id: paragraphs.length + 1, text: parts[index], end: offset + parts[index].length });
    }
    offset += parts[index].length;
  }
  return paragraphs;
}

export function applyExpansionAdditions({ sourceText, candidateText, additions } = {}) {
  const candidate = String(candidateText || "");
  const paragraphs = expansionParagraphs(candidate);
  const protectedSpans = extractProtectedSpans(sourceText);
  const accepted = new Map();
  const rejected = [];
  const normalise = (text) => text.replace(/\s+/gu, " ").trim().toLowerCase();
  const assemble = () => {
    let result = candidate;
    for (const paragraph of [...paragraphs].reverse()) {
      const additionsHere = accepted.get(paragraph.id);
      if (additionsHere) result = result.slice(0, paragraph.end) + "\n\n" + additionsHere.join("\n\n") + result.slice(paragraph.end);
    }
    return result;
  };
  for (const [index, addition] of (Array.isArray(additions) ? additions : []).entries()) {
    const paragraph = paragraphs.find((item) => item.id === addition?.after_paragraph);
    const text = typeof addition?.text === "string" ? addition.text.trim() : "";
    if (!paragraph || !text) {
      rejected.push({ index, reason: "invalid_addition_or_paragraph" });
      continue;
    }
    if (normalise(assemble()).includes(normalise(text))) {
      rejected.push({ index, reason: "duplicate_candidate_wording" });
      continue;
    }
    const prior = accepted.get(paragraph.id) || [];
    accepted.set(paragraph.id, [...prior, text]);
    const preservation = auditPreservation(sourceText, assemble(), protectedSpans, { lengthPreference: "expand" });
    if (classifyPreservationRelease(preservation).hard_failure) {
      if (prior.length) accepted.set(paragraph.id, prior);
      else accepted.delete(paragraph.id);
      rejected.push({ index, reason: "preservation_failure", warning_types: preservation.warnings.map((warning) => warning.type) });
    }
  }
  const revisedText = assemble();
  return {
    revised_text: revisedText,
    accepted_additions: [...accepted.values()].reduce((count, items) => count + items.length, 0),
    rejected_additions: rejected,
    added_words: manuscriptWordCount(revisedText) - manuscriptWordCount(candidate),
    existing_candidate_preserved: true,
  };
}
