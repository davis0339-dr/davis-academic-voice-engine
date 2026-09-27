import { test } from "node:test";
import assert from "node:assert/strict";
import { auditLongDocumentStructure, extractFormalArtifacts, normaliseStructuralText } from "../server/lib/longDocumentStructure.js";

test("ordinary academic prose containing programme is not classified as a formal artefact", () => {
  const source = "The programme evaluation explains how audit-firm capability develops across several institutional settings and why these relationships matter for professional quality.";
  assert.deepEqual(extractFormalArtifacts(source), []);
});

test("headings and hypothesis lines are audited as formal artefacts", () => {
  const source = "Research Questions\n\nRQ1: What relationship exists between governance and debt cost?\n\nResearch Hypotheses\n\nH01: Governance has no significant effect on debt cost.";
  const candidate = "Research Questions\n\nRQ1: What relationship exists between governance and debt cost?\n\nResearch Hypotheses";
  const audit = auditLongDocumentStructure(source, candidate);
  assert.equal(audit.passed, false);
  assert.ok(audit.missing_artifacts.some((item) => item.startsWith("H01")));
});

test("unicode and ASCII dashes normalise to the same structural form", () => {
  assert.equal(normaliseStructuralText("2015–2024"), normaliseStructuralText("2015-2024"));
});

test("a missing substantive paragraph is reported separately from formal structure", () => {
  const retained = "This retained paragraph contains enough substantive academic detail about corporate governance, creditor protection, financing conditions, evidence interpretation, and organisational decision making to qualify for review.";
  const lost = "Audit quality provides the professional dimension through which market participation, organisational capability, regulatory inspection, engagement governance, and continuing investment in personnel become analytically connected.";
  const audit = auditLongDocumentStructure(`${retained}\n\n${lost}`, retained);
  assert.equal(audit.passed, true);
  assert.ok(audit.possible_substantive_passage_losses.some((item) => item.excerpt.startsWith("Audit quality")));
});
