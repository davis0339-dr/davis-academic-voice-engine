import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentMap } from "../server/lib/documentMap.js";

const SAMPLE = `A Study of Board Independence and Firm Performance

1 Introduction

This thesis examines Board Independence (BI) in UK-listed firms. Prior work (Al-Najjar, 2012) established the baseline relationship.

2 Literature Review

The Board Independence (BI) literature is extensive. Governance scholars have long debated agency theory implications.

2.1 Agency Theory

Agency theory (Fama & Jensen, 1983) frames the discussion.
`;

test("detects a title from the preamble before the first heading", () => {
  const map = buildDocumentMap(SAMPLE);
  assert.equal(map.title, "A Study of Board Independence and Firm Performance");
});

test("detects numbered headings at the right nesting depth", () => {
  const map = buildDocumentMap(SAMPLE);
  const texts = map.headings.map((h) => h.text);
  assert.ok(texts.includes("1 Introduction"));
  assert.ok(texts.includes("2 Literature Review"));
  assert.ok(texts.includes("2.1 Agency Theory"));
  const nested = map.headings.find((h) => h.text === "2.1 Agency Theory");
  assert.equal(nested.level, 2);
});

test("builds a glossary from acronym-expansion pairs found anywhere in the document", () => {
  const map = buildDocumentMap(SAMPLE);
  assert.equal(map.glossary["BI"], "Board Independence");
});

test("aggregates document-wide citations via Pass A", () => {
  const map = buildDocumentMap(SAMPLE);
  assert.ok(map.protectedSpans.citations.some((c) => c.includes("Al-Najjar")));
  assert.ok(map.protectedSpans.citations.some((c) => c.includes("Fama")));
});

test("a document with no headings still produces a usable map", () => {
  const map = buildDocumentMap("Just one plain paragraph with no structure at all.");
  assert.equal(map.headings.length, 0);
  assert.equal(map.title, "Just one plain paragraph with no structure at all.");
});
