// Phase 3 (Section 14, points 3-4): "chunk by semantic/section boundaries,
// not arbitrary character counts where practical" + "include limited
// preceding/following context for each chunk."
//
// Strategy: if the document map found at least two headings, chunk on
// heading boundaries (splitting an oversized section further at paragraph
// boundaries). Otherwise fall back to paragraph-group chunking. Either way,
// a chunk boundary never falls mid-sentence or mid-paragraph -- the source
// is only ever cut at a blank-line (paragraph) boundary.
//
// The heading line itself is stripped out of what gets sent to the model
// (see jobStore.js) and re-attached verbatim on reassembly, so section
// titles are never at risk of being reworded -- a concrete implementation
// of Section 14 point 8, "preserve formatting."

const DEFAULT_TARGET_WORDS = 900;

function wordCount(text) {
  return (text.match(/[A-Za-z0-9']+/g) || []).length;
}

function splitParagraphs(text) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function groupParagraphsByTargetSize(paragraphs, targetWords) {
  const groups = [];
  let current = [];
  let currentWords = 0;
  for (const para of paragraphs) {
    const w = wordCount(para);
    if (current.length > 0 && currentWords + w > targetWords) {
      groups.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }
    current.push(para);
    currentWords += w;
  }
  if (current.length > 0) groups.push(current.join("\n\n"));
  return groups;
}

function lastSentenceTail(text, maxChars = 240) {
  if (!text) return "";
  const tail = text.slice(-maxChars);
  const sentenceStart = tail.search(/[A-Z][^.!?]*[.!?]\s*$/);
  return (sentenceStart >= 0 ? tail.slice(sentenceStart) : tail).trim();
}

function chunkByHeadings(fullText, headings, targetWords) {
  const sections = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].offset + headings[i].lineText.length + 1;
    const end = i + 1 < headings.length ? headings[i + 1].offset : fullText.length;
    sections.push({ heading: headings[i].text, body: fullText.slice(start, end).trim() });
  }

  // Anything before the first heading (title/abstract-like preamble) becomes
  // its own headless section so it isn't silently dropped.
  const preamble = fullText.slice(0, headings[0].offset).trim();

  const rawChunks = [];
  if (preamble) rawChunks.push({ heading: null, body: preamble });
  for (const section of sections) {
    if (!section.body) continue;
    if (wordCount(section.body) <= targetWords * 1.4) {
      rawChunks.push({ heading: section.heading, body: section.body });
    } else {
      const groups = groupParagraphsByTargetSize(splitParagraphs(section.body), targetWords);
      groups.forEach((body, i) => {
        rawChunks.push({ heading: i === 0 ? section.heading : `${section.heading} (continued)`, body });
      });
    }
  }
  return rawChunks;
}

function chunkByParagraphGroups(fullText, targetWords) {
  const groups = groupParagraphsByTargetSize(splitParagraphs(fullText), targetWords);
  return groups.map((body) => ({ heading: null, body }));
}

export function chunkDocument(fullText, documentMap, options = {}) {
  const targetWords = options.targetWordsPerChunk || DEFAULT_TARGET_WORDS;
  const useHeadings = documentMap.headings.length >= 2;

  const rawChunks = useHeadings
    ? chunkByHeadings(fullText, documentMap.headings, targetWords)
    : chunkByParagraphGroups(fullText, targetWords);

  return {
    method: useHeadings ? "heading_boundary" : "paragraph_group",
    chunks: rawChunks.map((c, index) => ({
      index,
      heading: c.heading,
      sourceText: c.body,
      wordCount: wordCount(c.body),
      precedingContextTail: index > 0 ? lastSentenceTail(rawChunks[index - 1].body) : "",
    })),
  };
}
