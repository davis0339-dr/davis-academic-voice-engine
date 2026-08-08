import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentMap } from "../server/lib/documentMap.js";
import { chunkDocument } from "../server/lib/chunker.js";
import { extractProtectedSpans } from "../server/lib/protect.js";
import { auditPreservation } from "../server/lib/preservation.js";

const STRUCTURED_SAMPLE = `Section 1: Foundation of the Study

Purpose Statement

The purpose of this explanatory sequential mixed methods study is to examine and explain the relationship between board-level corporate governance and the cost of debt of U.S.-listed manufacturing firms in the S&P 1500 during 2015-2024.

Study Alignment

Element\tQuestion or focus\tEvidence\tAnalytic response
RQ1\tMagnitude and direction of governance-cost relationships\t2015-2024 firm-year governance and financial data\tFirm and year fixed-effects panel regression

Section 3: Research Method

Research Design and Rationale

The study will use an explanatory sequential mixed methods design with a dominant quantitative strand.

Population and Sampling

The accessible population will consist of firms classified within NAICS sectors 31-33 that were included in the S&P Composite 1500 at any point during 2015-2024.`;

test("institutional Section headings survive document mapping as atomic headings", () => {
  const map = buildDocumentMap(STRUCTURED_SAMPLE);
  const section3 = map.headings.find((h) => h.text === "Section 3: Research Method");
  assert.ok(section3);
  assert.equal(section3.style, "institutional_numbered");
});

test("academic numeric ranges are protected atomically", () => {
  const spans = extractProtectedSpans(STRUCTURED_SAMPLE);
  assert.ok(spans.ranges.includes("2015-2024"));
  assert.ok(spans.ranges.includes("31-33"));
});

test("Study Alignment remains passthrough rather than becoming rewrite prose", () => {
  const map = buildDocumentMap(STRUCTURED_SAMPLE);
  const chunks = chunkDocument(STRUCTURED_SAMPLE, map, { targetWordsPerChunk: 300 }).chunks;
  const alignment = chunks.find((chunk) => chunk.heading === "Study Alignment");
  assert.ok(alignment);
  assert.equal(alignment.rewriteMode, "passthrough");
  assert.ok(alignment.sourceText.includes("2015-2024 firm-year governance and financial data"));
});

test("purpose-statement proposal orientation cannot become present reporting", () => {
  const source = "The purpose of this explanatory sequential mixed methods study is to examine and explain the relationship between board-level corporate governance and the cost of debt during 2015-2024.";
  const revised = "This explanatory sequential mixed methods study examines and explains the relationship between board-level corporate governance and the cost of debt during 2015-2024.";
  const result = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(result.study_stage_ok, false);
  assert.ok(result.warnings.some((w) => w.type === "study_stage_shift"));
});

test("breaking a year range into comma-separated endpoints is a hard preservation failure", () => {
  const source = "The evidence consists of 2015-2024 firm-year governance and financial data.";
  const revised = "The evidence consists of 2015, 2024 firm-year governance and financial data.";
  const result = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(result.ranges_ok, false);
  assert.equal(result.new_factual_claims_detected, true);
  assert.ok(result.warnings.some((w) => w.type === "range_corruption"));
});

test("dropping an institutional Section label is a structure-preservation failure", () => {
  const source = "Section 3: Research Method\n\nResearch Design and Rationale\n\nThe study will use a mixed methods design.";
  const revised = "Research Method\n\nThis section\n\nResearch Design and Rationale\n\nThe study will use a mixed methods design.";
  const result = auditPreservation(source, revised, extractProtectedSpans(source));
  assert.equal(result.document_structure_ok, false);
  assert.ok(result.warnings.some((w) => w.type === "document_structure_shift"));
});
