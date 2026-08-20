import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentMap } from "../server/lib/documentMap.js";
import { chunkDocument } from "../server/lib/chunker.js";

const HEADED_DOC = `Title Line

1 Introduction

${"This is a filler sentence about governance research. ".repeat(10)}

2 Methodology

${"This is a filler sentence about the sample and estimator. ".repeat(10)}

3 Results

${"This is a filler sentence about the regression findings. ".repeat(10)}
`;

const HEADLESS_DOC = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} with some ordinary sentence content to pad it out a little.`).join(
  "\n\n"
);

test("chunks by heading boundaries when at least two headings are detected", () => {
  const map = buildDocumentMap(HEADED_DOC);
  const { method, chunks } = chunkDocument(HEADED_DOC, map, { targetWordsPerChunk: 5000 });
  assert.equal(method, "heading_boundary");
  const headings = chunks.map((c) => c.heading).filter(Boolean);
  assert.ok(headings.some((h) => h.includes("Introduction")));
  assert.ok(headings.some((h) => h.includes("Methodology")));
  assert.ok(headings.some((h) => h.includes("Results")));
});

test("never splits mid-paragraph -- every chunk's source text is one or more whole paragraphs", () => {
  const map = buildDocumentMap(HEADED_DOC);
  const { chunks } = chunkDocument(HEADED_DOC, map, { targetWordsPerChunk: 5000 });
  for (const chunk of chunks) {
    assert.equal(chunk.sourceText, chunk.sourceText.trim());
  }
});

test("falls back to paragraph-group chunking when there are fewer than two headings", () => {
  const map = buildDocumentMap(HEADLESS_DOC);
  const { method, chunks } = chunkDocument(HEADLESS_DOC, map, { targetWordsPerChunk: 50 });
  assert.equal(method, "paragraph_group");
  assert.ok(chunks.length > 1, "should have split a 20-paragraph doc into multiple chunks at a 50-word target");
});

test("an oversized single section gets sub-split at paragraph boundaries, not silently kept whole", () => {
  const bigSection = `1 Everything\n\n${Array.from({ length: 30 }, (_, i) => `Sentence group ${i}. `.repeat(20)).join("\n\n")}`;
  const map = buildDocumentMap(`Title\n\n${bigSection}\n\n2 Conclusion\n\nShort wrap up.`);
  const { chunks } = chunkDocument(`Title\n\n${bigSection}\n\n2 Conclusion\n\nShort wrap up.`, map, { targetWordsPerChunk: 200 });
  const everythingChunks = chunks.filter((c) => c.heading && c.heading.includes("Everything"));
  assert.ok(everythingChunks.length > 1, "an oversized section should be split into more than one chunk");
});

test("each chunk after the first carries a non-empty preceding-context tail", () => {
  const map = buildDocumentMap(HEADED_DOC);
  const { chunks } = chunkDocument(HEADED_DOC, map, { targetWordsPerChunk: 5000 });
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i].precedingContextTail.length > 0);
  }
  assert.equal(chunks[0].precedingContextTail, "");
});

test("each chunk before the last carries the next chunk's opening context", () => {
  const map = buildDocumentMap(HEADED_DOC);
  const { chunks } = chunkDocument(HEADED_DOC, map, { targetWordsPerChunk: 5000 });
  for (let i = 0; i < chunks.length - 1; i++) {
    assert.ok(chunks[i].followingContextHead.length > 0);
  }
  assert.equal(chunks.at(-1).followingContextHead, "");
});
