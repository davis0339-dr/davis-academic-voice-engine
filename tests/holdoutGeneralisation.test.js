import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentMap } from "../server/lib/documentMap.js";
import { chunkDocument } from "../server/lib/chunker.js";
import { auditPreservation } from "../server/lib/preservation.js";
import { extractProtectedSpans } from "../server/lib/protect.js";

const freshProspectus = `Section 1: Foundation of the Study
Introduction
The proposed study will examine board governance and debt cost among U.S.-listed manufacturing firms.
Research Questions and Hypotheses
Research Question 1
To what extent does board independence predict the cost of debt?
H01a: Board independence does not significantly predict the cost of debt.
H11a: Board independence significantly predicts the cost of debt.
Study Alignment
Element
Evidence
Analytic response
Definitions
CEO duality. A binary indicator equal to 1 when the CEO also serves as board chair and 0 otherwise.
Operationalization of Variables
Variable
Operational measure
Role
Expected relation
Board independence
Independent directors / total directors
Independent
Negative, conditional
Data Analysis Plan
The study will estimate panel models for 2015-2024.
References
Anderson, R. C. (2004). Example reference.`;

test("formal academic structures are marked passthrough rather than rewritten", () => {
  const map = buildDocumentMap(freshProspectus);
  const { chunks } = chunkDocument(freshProspectus, map, { targetWordsPerChunk: 300 });
  const rq = chunks.find((c) => /^Research Question 1$/i.test(c.heading || ""));
  const definitions = chunks.find((c) => /^Definitions$/i.test(c.heading || ""));
  const analysisPlan = chunks.find((c) => /^Data Analysis Plan$/i.test(c.heading || ""));
  const refs = chunks.find((c) => /^References$/i.test(c.heading || ""));
  assert.equal(rq?.rewriteMode, "passthrough");
  assert.equal(definitions?.rewriteMode, "passthrough");
  assert.equal(analysisPlan?.rewriteMode, "passthrough");
  assert.equal(refs?.rewriteMode, "passthrough");
});

test("flattened table column labels are not misclassified as independent academic headings", () => {
  const map = buildDocumentMap(freshProspectus);
  const labels = map.headings.map((h) => h.text.toLowerCase());
  assert.ok(!labels.includes("variable"));
  assert.ok(!labels.includes("operational measure"));
  assert.ok(!labels.includes("role"));
  assert.ok(!labels.includes("expected relation"));
  assert.ok(!labels.includes("independent"));
});

test("numeric ranges do not create false negative-number preservation spans", () => {
  const spans = extractProtectedSpans("The panel covers 2015-2024 and NAICS sectors 31-33.");
  assert.ok(spans.numbers.includes("2015"));
  assert.ok(spans.numbers.includes("2024"));
  assert.ok(spans.numbers.includes("31"));
  assert.ok(spans.numbers.includes("33"));
  assert.ok(!spans.numbers.includes("-2024"));
  assert.ok(!spans.numbers.includes("-33"));
});

test("proposal-stage audit rejects introduced completed-study wording", () => {
  const source = "The proposed study will examine the relationships. Interviews will then be used to explain the quantitative results.";
  const revised = "The proposed study will examine the relationships. This study conducted semi-structured interviews to explain the quantitative results.";
  const audit = auditPreservation(source, revised);
  assert.equal(audit.study_stage_ok, false);
  assert.ok(audit.warnings.some((w) => w.type === "study_stage_shift"));
});

test("preservation audit catches explicit list-count inconsistencies introduced by rewriting", () => {
  const source = "The governance variables are board independence, CEO duality, board gender diversity, board size, and audit committee independence.";
  const revised = "Six board characteristics serve as focal variables: board independence, CEO duality, board gender diversity, board size, and audit committee independence.";
  const audit = auditPreservation(source, revised);
  assert.equal(audit.list_counts_ok, false);
  assert.ok(audit.warnings.some((w) => w.type === "list_count_mismatch"));
});

test("preservation audit rejects first-person researcher voice introduced into an impersonal source", () => {
  const source = "Table 1 presents the alignment of the study. The alternative denominator will be used as a robustness test.";
  const revised = "Table 1 presents the alignment of the study. I use the alternative denominator as a robustness test.";
  const audit = auditPreservation(source, revised);
  assert.equal(audit.researcher_voice_ok, false);
  assert.ok(audit.warnings.some((w) => w.type === "researcher_voice_shift"));
});

test("preservation audit rejects Section-to-Chapter structure drift", () => {
  const source = "Section 1 establishes the problem. Section 2 reviews the literature.";
  const revised = "Chapter 1 establishes the problem. The present chapter reviews the literature.";
  const audit = auditPreservation(source, revised);
  assert.equal(audit.document_structure_ok, false);
  assert.ok(audit.warnings.some((w) => w.type === "document_structure_shift"));
});
