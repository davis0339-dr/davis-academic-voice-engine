// Semantic text-structure mapping used before intervention planning.
// This layer is deliberately conservative: it identifies presentation units
// (paragraphs, headings, list items and stand-alone quotations) so the planner
// does not mistake formatting fragments for independent propositions.

import { splitSentences, wordCount } from "./sentences.js";

const LIST_ITEM_RE = /^\s*(?:[-*•]|\d{1,3}[.)]|[A-Za-z][.)])\s+\S/;
const NUMBERED_HEADING_RE = /^\s*\d+(?:\.\d+)+\s+\S/;
const BLOCKQUOTE_RE = /^\s*>\s*\S/;
const STANDALONE_QUOTE_RE = /^\s*[“\"][\s\S]+[”\"]\s*$/;

function looksLikeHeading(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("\n")) return false;
  if (NUMBERED_HEADING_RE.test(trimmed)) return true;
  const words = wordCount(trimmed);
  if (words === 0 || words > 14) return false;
  if (/[.!?][”\"]?$/.test(trimmed)) return false;
  return /^[A-Z0-9]/.test(trimmed);
}

function classifyBlock(text) {
  const trimmed = text.trim();
  if (LIST_ITEM_RE.test(trimmed)) return "list_item";
  if (looksLikeHeading(trimmed)) return "heading";
  if ((BLOCKQUOTE_RE.test(trimmed) || STANDALONE_QUOTE_RE.test(trimmed)) && wordCount(trimmed) <= 80) {
    return "quotation";
  }
  return "paragraph";
}

function rawBlocks(text) {
  const normalised = String(text || "").replace(/\r\n?/g, "\n");
  const chunks = normalised.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  const blocks = [];

  for (const chunk of chunks) {
    const lines = chunk.split(/\n/).map((line) => line.trim()).filter(Boolean);
    // A pasted numbered/bulleted list often contains single line breaks rather
    // than blank lines. Keep each item intact instead of feeding its marker to
    // the sentence planner as a separate fragment.
    if (lines.length > 1 && lines.every((line) => LIST_ITEM_RE.test(line))) {
      blocks.push(...lines);
    } else {
      blocks.push(chunk);
    }
  }
  return blocks;
}

function mapSentenceIndices(blockSentences, allSentences, startAt) {
  const indices = [];
  let cursor = startAt;
  for (const sentence of blockSentences) {
    let index = allSentences.indexOf(sentence, cursor);
    if (index < 0) index = allSentences.findIndex((candidate) => candidate === sentence);
    if (index >= 0) {
      indices.push(index);
      cursor = Math.max(cursor, index + 1);
    }
  }
  return { indices, nextCursor: cursor };
}

export function parseTextStructure(text) {
  const allSentences = splitSentences(text);
  const blocks = [];
  let sentenceCursor = 0;
  let paragraphOrdinal = 0;

  rawBlocks(text).forEach((raw, blockIndex) => {
    const type = classifyBlock(raw);
    const blockSentences = splitSentences(raw);
    const mapped = mapSentenceIndices(blockSentences, allSentences, sentenceCursor);
    sentenceCursor = mapped.nextCursor;

    const isReasoningBlock = type === "paragraph" || type === "list_item";
    const record = {
      blockIndex,
      type,
      text: raw,
      wordCount: wordCount(raw),
      sentenceIndices: mapped.indices,
      sentenceCount: mapped.indices.length,
      paragraphOrdinal: isReasoningBlock ? paragraphOrdinal : null,
    };
    if (isReasoningBlock) paragraphOrdinal += 1;
    blocks.push(record);
  });

  return {
    measurement_version: "semantic-structure-v1",
    blocks,
    block_count: blocks.length,
    paragraph_count: blocks.filter((block) => block.type === "paragraph").length,
    list_item_count: blocks.filter((block) => block.type === "list_item").length,
    heading_count: blocks.filter((block) => block.type === "heading").length,
    quotation_count: blocks.filter((block) => block.type === "quotation").length,
  };
}
