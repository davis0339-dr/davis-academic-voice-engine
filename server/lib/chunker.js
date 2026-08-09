// Phase 3 long-document chunking.
// Prefer semantic/section and paragraph boundaries, but enforce a real size
// ceiling. Formal research artefacts (questions/hypotheses, alignment tables,
// definitions, conceptual models, variable tables, equations/statistical plans,
// schedules and references) are passed through rather than paraphrased.

import { countWords } from "../config/limits.js";

const DEFAULT_TARGET_WORDS = 800;
const HARD_MAX_MULTIPLIER = 1.25;

const PASSTHROUGH_HEADING = /^(?:research questions? and hypotheses|research question\s*\d+|study alignment|definitions|conceptual model|operationali[sz]ation of variables|data analysis plan|proposed schedule|references|table\s*\d+\b|figure\s*\d+\b)/i;
const STANDALONE_INSTITUTIONAL = /^(?:Section|Chapter)\s+\d+(?:\.\d+)*$/i;

function wordCount(text) {
  return countWords(text);
}

function splitParagraphs(text) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function splitSentences(text) {
  if (!text.trim()) return [];
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    return Array.from(segmenter.segment(text), (part) => part.segment.trim()).filter(Boolean);
  } catch {
    return (text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [text])
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function splitPathologicalSentence(sentence, hardMaxWords) {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length <= hardMaxWords) return [sentence.trim()];
  const pieces = [];
  for (let i = 0; i < words.length; i += hardMaxWords) {
    pieces.push(words.slice(i, i + hardMaxWords).join(" "));
  }
  return pieces;
}

function groupSentencesByTargetSize(text, targetWords, hardMaxWords) {
  const sentences = splitSentences(text).flatMap((sentence) => splitPathologicalSentence(sentence, hardMaxWords));
  const groups = [];
  let current = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length) groups.push(current.join(" ").trim());
    current = [];
    currentWords = 0;
  };

  for (const sentence of sentences) {
    const w = wordCount(sentence);
    if (current.length && currentWords + w > targetWords) flush();
    current.push(sentence);
    currentWords += w;
    if (currentWords >= hardMaxWords) flush();
  }
  flush();
  return groups;
}

function groupParagraphsByTargetSize(paragraphs, targetWords, hardMaxWords) {
  const groups = [];
  let current = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length) groups.push(current.join("\n\n"));
    current = [];
    currentWords = 0;
  };

  for (const para of paragraphs) {
    const w = wordCount(para);
    if (w > hardMaxWords) {
      flush();
      groups.push(...groupSentencesByTargetSize(para, targetWords, hardMaxWords));
      continue;
    }

    if (current.length && currentWords + w > targetWords) flush();
    current.push(para);
    currentWords += w;
    if (currentWords >= hardMaxWords) flush();
  }
  flush();
  return groups;
}

function lastSentenceTail(text, maxChars = 240) {
  if (!text) return "";
  const tail = text.slice(-maxChars);
  const sentenceStart = tail.search(/[A-Z][^.!?]*[.!?]\s*$/);
  return (sentenceStart >= 0 ? tail.slice(sentenceStart) : tail).trim();
}

function isFormalPassthrough(heading, body) {
  if (heading && (PASSTHROUGH_HEADING.test(heading.trim()) || STANDALONE_INSTITUTIONAL.test(heading.trim()))) return true;
  if (/\bH0?\d+[a-z]?\s*:/i.test(body || "") || /\bH1\d*[a-z]?\s*:/i.test(body || "")) return true;
  return false;
}

function chunkByHeadings(fullText, headings, targetWords, hardMaxWords) {
  const sections = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].offset + headings[i].lineText.length + 1;
    const end = i + 1 < headings.length ? headings[i + 1].offset : fullText.length;
    sections.push({ heading: headings[i].text, body: fullText.slice(start, end).trim() });
  }

  const preamble = fullText.slice(0, headings[0].offset).trim();
  const rawChunks = [];
  if (preamble) rawChunks.push({ heading: null, reattachHeading: false, body: preamble, rewriteMode: "passthrough" });

  for (const section of sections) {
    if (!section.body) {
      if (STANDALONE_INSTITUTIONAL.test(section.heading || "")) {
        rawChunks.push({ heading: section.heading, reattachHeading: true, body: "", rewriteMode: "passthrough" });
      }
      continue;
    }
    const formal = isFormalPassthrough(section.heading, section.body);
    if (formal) {
      rawChunks.push({ heading: section.heading, reattachHeading: true, body: section.body, rewriteMode: "passthrough" });
      continue;
    }
    const groups = groupParagraphsByTargetSize(splitParagraphs(section.body), targetWords, hardMaxWords);
    groups.forEach((body, i) => {
      rawChunks.push({
        heading: section.heading,
        reattachHeading: i === 0,
        body,
        rewriteMode: isFormalPassthrough(section.heading, body) ? "passthrough" : "rewrite",
      });
    });
  }
  return rawChunks;
}

function chunkByParagraphGroups(fullText, targetWords, hardMaxWords) {
  const groups = groupParagraphsByTargetSize(splitParagraphs(fullText), targetWords, hardMaxWords);
  return groups.map((body) => ({ heading: null, reattachHeading: false, body, rewriteMode: "rewrite" }));
}

export function chunkDocument(fullText, documentMap, options = {}) {
  const targetWords = Math.max(200, Number(options.targetWordsPerChunk || DEFAULT_TARGET_WORDS));
  const hardMaxWords = Math.max(targetWords, Math.ceil(targetWords * HARD_MAX_MULTIPLIER));
  const useHeadings = documentMap.headings.length >= 2;

  const rawChunks = useHeadings
    ? chunkByHeadings(fullText, documentMap.headings, targetWords, hardMaxWords)
    : chunkByParagraphGroups(fullText, targetWords, hardMaxWords);

  return {
    method: useHeadings ? "heading_boundary" : "paragraph_group",
    targetWords,
    hardMaxWords,
    chunks: rawChunks.map((c, index) => ({
      index,
      heading: c.heading,
      reattachHeading: c.reattachHeading,
      rewriteMode: c.rewriteMode || "rewrite",
      sourceText: c.body,
      wordCount: wordCount(c.body),
      precedingContextTail: index > 0 ? lastSentenceTail(rawChunks[index - 1].body) : "",
    })),
  };
}
