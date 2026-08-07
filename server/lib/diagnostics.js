// Pass B (quality diagnostics): rule-based, deterministic, and runnable
// without any LLM call. This is what the intervention planner (Pass C)
// conditions on, and it maps directly onto the "diagnostics" block of the
// response schema in Section 13 of the build handoff.
//
// This is intentionally NOT an AI-authorship detector. It flags writing
// quality patterns (generic phrasing, repetition, monotony) -- see
// Section 15 for why a separate, calibrated module is required before any
// authorship-style score can be shown.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitSentences, wordCount } from "./sentences.js";

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
      if (lower.includes(phrase)) {
        hits.push({ sentenceIndex: index, phrase, sentence });
      }
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
    if (
      openings[i] &&
      openings[i] === openings[i - 1] &&
      openings[i] === openings[i - 2]
    ) {
      hits.push({
        sentenceIndex: i,
        issue: "repeated_opening",
        detail: `Three consecutive sentences open with "${sentences[i].trim().split(/\s+/)[0]}".`,
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
  const monotony = findMonotony(sentences);

  const structuralMonotony = [
    ...repeatedOpenings,
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
    cohesion: transitionStacking,
    evidence_alignment: [], // requires citation-to-claim linking; see README limitations
    monotony,
  };
}
