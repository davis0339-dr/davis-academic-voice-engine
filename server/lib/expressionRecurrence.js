// Inspect repeated expression, not authorship. Technical vocabulary, citation
// identities, direct quotations and evidence-strength qualifiers are not targets.
import { parseTextStructure } from "./textStructure.js";
import { splitSentences } from "./sentences.js";

export const AUTHORIAL_EXPRESSION_CONTRACT = `AUTHORIAL EXPRESSION, NOT AUTOMATIC POLISH:
Let supplied reasoning set the pace: several related angles, a return to a condition, or a tension carried forward are legitimate. No fixed paragraph recipe or compulsory closing verdict.
Keep ordinary content-bearing sentences, defensible authorial stance and purposeful unevenness in explanation and evidence placement. No invented arguments, random quirks, errors or fake informality.
Review recurring evaluative adjectives and stock links by function. Preserve necessary contrast, cause and qualification; reduce decoration, not reasoning. Do not rotate synonyms.
Keep repeated technical terms, statistical descriptors, citations, quotations and epistemic qualifiers such as may, could and suggests.
Do not obtain a less polished rhythm by compressing explanation. Preserve multi-angle discussion, disagreements and unresolved qualifications.`;

const PATTERNS = [
  ["which means", /\bwhich means(?: that)?\b/gi, 3, true],
  ["this distinction matters", /\b(?:this|that|the) distinction matters\b/gi, 3, true],
  ["the pattern suggests", /\b(?:the|this) pattern suggests\b/gi, 3, true],
  ["taken together", /\btaken together\b/gi, 3, true],
  ["this highlights", /\bthis highlights\b/gi, 3, true],
  ["underscores the importance", /\bunderscores? the importance\b/gi, 3, true],
  ["not merely / not simply", /\bnot (?:merely|simply)\b/gi, 3, true],
  // Common logical connectors need a higher threshold and are never banned.
  ["rather than", /\brather than\b/gi, 4, false],
  ["however", /^\s*however\b/gi, 3, false],
  ["furthermore", /^\s*furthermore\b/gi, 3, false],
  ["moreover", /^\s*moreover\b/gi, 3, false],
  ["therefore", /^\s*therefore\b/gi, 3, false],
  ["in addition", /^\s*in addition\b/gi, 3, false],
];
// Deliberately bounded: this is an evaluative-word check, not a POS tagger or a
// blanket ban on adjectives. Significant, independent, financial, robust,
// strong and critical have frequent technical uses and are not in this list.
const EVALUATIVE_WORDS = ["crucial", "pivotal", "remarkable", "compelling", "important", "fundamental", "notable"];
const RULES = [
  ...PATTERNS.map(([phrase, regex, threshold, introducedPair]) => ({ phrase, regex, threshold, introducedPair, kind: "linking_phrase" })),
  ...EVALUATIVE_WORDS.map((phrase) => ({ phrase, regex: new RegExp(`\\b${phrase}\\b`, "gi"), threshold: 3, introducedPair: false, kind: "evaluative_word" })),
];

function unquoted(text) {
  // Mask rather than remove, preserving sentence positions. Single apostrophes
  // inside words (firm's, author's) must not be mistaken for quotation marks.
  return text.replace(/"[^"]*"|“[^”]*”|‘[^’]*’|(?<!\w)'[^'\n]+'(?!\w)/g, (span) => span.replace(/[^\n.!?]/g, " "));
}

export function analyseExpressionRecurrence(text) {
  const structure = parseTextStructure(text);
  const matches = new Map();
  let referenceSection = false;
  for (const block of structure.blocks) {
    if (block.type === "heading") {
      referenceSection = /^(?:references|bibliography|works cited)\s*:?$/i.test(block.text.trim());
      continue;
    }
    if (referenceSection || !["paragraph", "list_item"].includes(block.type)) continue;
    const maskedBlock = unquoted(block.text);
    let cursor = 0;
    // Keep the original segmentation and mask by offset, including quotations
    // spanning multiple sentences. A quoted period must not expose quote text.
    splitSentences(block.text).forEach((sentence, localIndex) => {
      const offset = block.text.indexOf(sentence, cursor);
      if (offset < 0) return;
      cursor = offset + sentence.length;
      const prose = maskedBlock.slice(offset, cursor);
      for (const rule of RULES) {
        const hits = [...prose.matchAll(new RegExp(rule.regex.source, rule.regex.flags))]
          .filter((hit) => !/^fundamental (?:theorem|frequency|frequencies|rights?)\b/i.test(prose.slice(hit.index)));
        if (!hits.length) continue;
        const row = matches.get(rule.phrase) || {
          phrase: rule.phrase, kind: rule.kind, count: 0,
          threshold: rule.threshold, introduced_pair: rule.introducedPair,
          block_indices: [], sentence_indices: [], examples: [],
        };
        row.count += hits.length;
        if (!row.block_indices.includes(block.blockIndex)) row.block_indices.push(block.blockIndex);
        const sentenceIndex = block.sentenceIndices[localIndex];
        if (Number.isInteger(sentenceIndex) && !row.sentence_indices.includes(sentenceIndex)) row.sentence_indices.push(sentenceIndex);
        if (row.examples.length < 3) row.examples.push(sentence.trim());
        matches.set(rule.phrase, row);
      }
    });
  }
  const rows = [...matches.values()];
  const issues = rows.filter((row) => row.count >= row.threshold && row.block_indices.length >= 2);
  return { version: "expression-recurrence-v1", matches: rows, issues };
}

export function auditExpressionRecurrence(sourceText, candidateText) {
  const source = analyseExpressionRecurrence(sourceText);
  const candidate = analyseExpressionRecurrence(candidateText);
  const sourceByPhrase = new Map(source.matches.map((row) => [row.phrase, row]));
  const issues = candidate.matches.filter((row) => {
    const sourceCount = sourceByPhrase.get(row.phrase)?.count || 0;
    return row.block_indices.length >= 2 && (
      row.count >= row.threshold || (row.introduced_pair && row.count >= 2 && sourceCount < 2)
    );
  }).map((row) => ({
    ...row,
    source_count: sourceByPhrase.get(row.phrase)?.count || 0,
    introduced_or_increased: row.count > (sourceByPhrase.get(row.phrase)?.count || 0),
    action: row.kind === "evaluative_word"
      ? "Check whether each evaluation adds a supported judgement. Preserve necessary emphasis; remove decorative repetition without synonym inflation."
      : "Preserve the logical relationship. Reduce repeated packaging only where the substantive reasoning can carry it; do not replace it with another repeated formula.",
  }));
  return {
    version: "expression-recurrence-v1", source, candidate, issues,
    regression: issues.some((row) => row.introduced_or_increased),
    repeated_occurrences: issues.reduce((sum, row) => sum + row.count - 1, 0),
    target_block_indices: [...new Set(issues.flatMap((row) => row.block_indices))],
    note: "A bounded check of recurring evaluative wording and linking phrases. This is not an AI probability; technical terms, quotations and necessary qualifications are protected, not targets for synonym replacement.",
  };
}

export function expressionRecurrencePromptBlock(sourceText) {
  const { issues } = analyseExpressionRecurrence(sourceText);
  return issues.length ? `SOURCE EXPRESSION REVIEW (not word bans): ${JSON.stringify(issues.map(({ phrase, kind, count, block_indices }) => ({ phrase, kind, count, block_indices })))}\nCheck the function of these repetitions within authorised targets. Preserve necessary logical links and the author's reasoning; do not simply rotate synonyms.` : "";
}

export function expressionRecurrenceWorsened(beforeAcceptance, afterAcceptance) {
  const before = beforeAcceptance?.expression_recurrence;
  const after = afterAcceptance?.expression_recurrence;
  if (before && after) {
    const beforeCounts = new Map(before.candidate.matches.map((row) => [row.phrase, row.count]));
    return after.issues.some((row) => row.count > (beforeCounts.get(row.phrase) || 0));
  }
  return Number(afterAcceptance?.dimensions?.candidate_expression_repeated_occurrences || 0) >
    Number(beforeAcceptance?.dimensions?.candidate_expression_repeated_occurrences || 0);
}
