import { splitSentences } from "./sentences.js";
import { splitTextBlocks } from "./textStructure.js";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "been", "being", "but", "by", "can", "could",
  "do", "does", "for", "from", "had", "has", "have", "how", "if", "in", "into", "is", "it", "its", "may",
  "might", "more", "not", "of", "on", "or", "should", "so", "such", "than", "that", "the", "their", "there",
  "therefore", "these", "this", "those", "through", "to", "was", "were", "when", "where", "which", "while",
  "will", "with", "would", "demonstrate", "demonstrates", "demonstrated", "show", "shows", "showed",
  "underscore", "underscores", "underscored", "further", "also",
]);

function tokenSet(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
      ?.filter((token) => token.length > 2 && !STOP_WORDS.has(token)) || []
  );
}

function intersectionSize(a, b) {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

function similarity(a, b) {
  if (a.size < 4 || b.size < 4) return { containment: 0, jaccard: 0 };
  const shared = intersectionSize(a, b);
  return {
    containment: shared / Math.min(a.size, b.size),
    jaccard: shared / (a.size + b.size - shared),
  };
}

function paragraphRows(text) {
  return splitTextBlocks(text)
    .map((paragraph, paragraphIndex) => ({ paragraphIndex, text: paragraph.trim() }))
    .filter((row) => row.text);
}

// Finds local proposition echoes introduced when a model reconstructs a source
// sentence but then repeats the retained source proposition as a preservation
// precaution. This is not a general semantic-similarity model: deliberately
// conservative thresholds keep ordinary thematic continuity and contrast safe.
export function analysePropositionEcho(text) {
  const rows = paragraphRows(text);
  const sentences = [];
  for (const row of rows) {
    for (const sentence of splitSentences(row.text)) {
      sentences.push({ sentence, paragraphIndex: row.paragraphIndex, tokens: tokenSet(sentence) });
    }
  }

  const pairs = [];
  for (let i = 0; i < sentences.length - 1; i += 1) {
    const left = sentences[i];
    const right = sentences[i + 1];
    if (left.paragraphIndex !== right.paragraphIndex) continue;
    const score = similarity(left.tokens, right.tokens);
    if (score.containment < 0.78 || score.jaccard < 0.58) continue;
    pairs.push({
      first_sentence_index: i,
      second_sentence_index: i + 1,
      paragraph_index: left.paragraphIndex,
      containment: Number(score.containment.toFixed(3)),
      jaccard: Number(score.jaccard.toFixed(3)),
      first_excerpt: left.sentence.slice(0, 240),
      second_excerpt: right.sentence.slice(0, 240),
    });
  }

  const paragraphPairs = [];
  for (let i = 0; i < rows.length - 1; i += 1) {
    const left = rows[i];
    const right = rows[i + 1];
    const leftTokens = tokenSet(left.text);
    const rightTokens = tokenSet(right.text);
    if (leftTokens.size < 18 || rightTokens.size < 18) continue;
    const score = similarity(leftTokens, rightTokens);
    if (score.containment < 0.72 || score.jaccard < 0.50) continue;
    paragraphPairs.push({
      first_paragraph_index: left.paragraphIndex,
      second_paragraph_index: right.paragraphIndex,
      containment: Number(score.containment.toFixed(3)),
      jaccard: Number(score.jaccard.toFixed(3)),
      first_excerpt: left.text.slice(0, 320),
      second_excerpt: right.text.slice(0, 320),
    });
  }

  const targetParagraphIndices = [...new Set([
    ...pairs.map((pair) => pair.paragraph_index),
    ...paragraphPairs.flatMap((pair) => [pair.first_paragraph_index, pair.second_paragraph_index]),
  ])];

  return {
    version: "proposition-echo-v2",
    count: pairs.length + paragraphPairs.length,
    sentence_pair_count: pairs.length,
    paragraph_pair_count: paragraphPairs.length,
    pairs,
    paragraph_pairs: paragraphPairs,
    sentence_indices: [...new Set(pairs.flatMap((pair) => [pair.first_sentence_index, pair.second_sentence_index]))],
    target_paragraph_indices: targetParagraphIndices,
    note: "Local sentence or adjacent-paragraph proposition echoes indicate likely reconstruction-plus-retention duplication. The measure uses conservative lexical-semantic containment and does not treat normal construct repetition as redundancy.",
  };
}
