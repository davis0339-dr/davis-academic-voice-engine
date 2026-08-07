// Pass B writing-quality diagnostics. Deterministic and runnable without an
// LLM. These are revision signals, not claims about authorship.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitSentences, wordCount } from "./sentences.js";
import { findRhetoricalScaffolding } from "./rhetoricalDiagnostics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GENERIC_PHRASES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "genericPhrases.json"), "utf8")
);
const TRANSITION_WORDS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "transitionWords.json"), "utf8")
);

function stddev(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function findGenericPhrasing(sentences) {
  const hits = [];
  sentences.forEach((sentence, index) => {
    const lower = sentence.toLowerCase();
    for (const phrase of GENERIC_PHRASES) {
      if (lower.includes(phrase)) hits.push({ sentenceIndex: index, phrase, sentence });
    }
  });
  return hits;
}

function findTransitionStacking(sentences) {
  const hits = [];
  let consecutiveTransitionStarts = 0;
  sentences.forEach((sentence, index) => {
    const lower = sentence.trim().toLowerCase();
    const opensWithTransition = TRANSITION_WORDS.some(
      (t) => lower.startsWith(t + ",") || lower.startsWith(t + " ")
    );
    if (opensWithTransition) {
      consecutiveTransitionStarts += 1;
      if (consecutiveTransitionStarts >= 3) {
        hits.push({
          sentenceIndex: index,
          issue: "transition_stacking",
          detail: `${consecutiveTransitionStarts} consecutive sentences open with an explicit transition word.`,
        });
      }
    } else {
      consecutiveTransitionStarts = 0;
    }
  });
  return hits;
}

function findRepeatedOpenings(sentences) {
  const hits = [];
  const openings = sentences.map((s) => (s.trim().split(/\s+/)[0] || "").toLowerCase());
  for (let i = 2; i < openings.length; i++) {
    if (openings[i] && openings[i] === openings[i - 1] && openings[i] === openings[i - 2]) {
      hits.push({
        sentenceIndex: i,
        issue: "repeated_opening",
        detail: `Three consecutive sentences open with "${sentences[i].trim().split(/\s+/)[0]}".`,
      });
    }
  }
  return hits;
}

function paragraphOpeningFrame(sentence) {
  const s = sentence.trim().toLowerCase();
  if (/^(conceptually|theoretically|methodologically|empirically|contextually)\b/.test(s)) return "disciplinary_label_adverb";
  if (/^(however|moreover|furthermore|therefore|additionally|consequently|similarly|conversely)\b/.test(s)) return "explicit_transition";
  if (/^in\s+/.test(s)) return "in_prepositional_opening";
  if (/^(within|across|among|from|under|through|despite|although|while)\s+/.test(s)) return "prepositional_or_subordinate_opening";
  if (/^(this|the)\s+(study|research|finding|findings|evidence|literature|result|results|analysis)\b/.test(s)) return "research_noun_opening";
  return null;
}

function findParagraphPatterning(text, sentences) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length < 3) return [];

  const rows = [];
  let sentenceSearchStart = 0;
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const firstSentence = splitSentences(paragraph)[0] || paragraph;
    let sentenceIndex = sentences.indexOf(firstSentence, sentenceSearchStart);
    if (sentenceIndex < 0) sentenceIndex = sentences.findIndex((s) => paragraph.startsWith(s));
    if (sentenceIndex >= 0) sentenceSearchStart = sentenceIndex + 1;
    rows.push({
      paragraphIndex,
      sentenceIndex: sentenceIndex >= 0 ? sentenceIndex : null,
      frame: paragraphOpeningFrame(firstSentence),
      wordCount: wordCount(paragraph),
      firstSentence,
    });
  });

  const hits = [];
  const frameCounts = new Map();
  for (const row of rows) {
    if (!row.frame) continue;
    if (!frameCounts.has(row.frame)) frameCounts.set(row.frame, []);
    frameCounts.get(row.frame).push(row);
  }

  for (const [frame, members] of frameCounts.entries()) {
    if (members.length >= 3) {
      members.forEach((row) => hits.push({
        paragraphIndex: row.paragraphIndex,
        sentenceIndex: row.sentenceIndex,
        issue: "repeated_paragraph_opening_frame",
        frame,
        detail: `${members.length} paragraphs reuse the same opening frame (${frame}).`,
      }));
    }
  }

  const lengths = rows.map((r) => r.wordCount).filter((n) => n > 0);
  if (lengths.length >= 4) {
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const sd = stddev(lengths);
    const cv = mean ? sd / mean : 0;
    if (mean >= 40 && cv < 0.16) {
      hits.push({
        paragraphIndex: null,
        sentenceIndex: null,
        issue: "uniform_paragraph_length",
        detail: `Paragraph lengths are unusually even (CV ${cv.toFixed(2)} across ${lengths.length} paragraphs).`,
      });
    }
  }

  return hits;
}

function findMonotony(sentences) {
  const lengths = sentences.map(wordCount);
  const overloaded = [];
  const choppy = [];
  lengths.forEach((len, i) => {
    if (len >= 40) overloaded.push({ sentenceIndex: i, wordCount: len });
    if (len > 0 && len <= 5) choppy.push({ sentenceIndex: i, wordCount: len });
  });

  const sd = stddev(lengths);
  const mean = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
  const lowVariation = sentences.length >= 6 && sd < 3 && mean > 8;

  return { lengths, overloaded, choppy, stddev: sd, mean, lowVariation };
}

export function diagnose(text) {
  const sentences = splitSentences(text);
  const genericPhrasing = findGenericPhrasing(sentences);
  const transitionStacking = findTransitionStacking(sentences);
  const repeatedOpenings = findRepeatedOpenings(sentences);
  const paragraphPatterns = findParagraphPatterning(text, sentences);
  const rhetoricalScaffolding = findRhetoricalScaffolding(sentences);
  const monotony = findMonotony(sentences);

  const structuralMonotony = [
    ...repeatedOpenings,
    ...paragraphPatterns,
    ...rhetoricalScaffolding,
    ...monotony.overloaded.map((o) => ({
      sentenceIndex: o.sentenceIndex,
      issue: "overloaded_sentence",
      detail: `${o.wordCount} words in one sentence -- candidate for SPLIT_OR_MERGE.`,
    })),
  ];
  if (monotony.lowVariation) {
    structuralMonotony.push({
      sentenceIndex: null,
      issue: "low_sentence_length_variation",
      detail: `Sentence length stddev ${monotony.stddev.toFixed(1)} across ${sentences.length} sentences -- rhythm reads mechanically uniform.`,
    });
  }

  return {
    sentences,
    generic_phrasing: genericPhrasing,
    structural_monotony: structuralMonotony,
    paragraph_patterns: paragraphPatterns,
    rhetorical_scaffolding: rhetoricalScaffolding,
    cohesion: transitionStacking,
    evidence_alignment: [],
    monotony,
  };
}
