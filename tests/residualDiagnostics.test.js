import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseResidualWriting } from "../server/lib/residualDiagnostics.js";

test("detects discourse-management density, retrospective neatness and nominalisation pressure in an over-engineered revision", () => {
  const text = [
    "That distinction is enormous. That taught us something important about the system. This led us toward a new framework. Another major breakthrough followed from the same test.",
    "Conceptual evolution from the original scope has been considerable. Recognition of these patterns represents a significant development in the work. Empirical grounding replaced reliance on intuition alone, while implementation of the framework represents another important achievement.",
    "The next stage therefore matters greatly. Current positioning appears promising because the project now operates at a deeper level of analysis.",
  ].join("\n\n");

  const result = analyseResidualWriting(text);
  const ids = result.signals.map((signal) => signal.id);
  assert.ok(ids.includes("discourse_management_density"));
  assert.ok(ids.includes("retrospective_neatness"));
  assert.ok(ids.includes("nominalisation_pressure"));
  assert.ok(result.target_blocks.length > 0);
  assert.equal(result.should_rework, true);
});

test("preserves ordinary short content-bearing sentences as useful texture rather than treating simplicity as a defect", () => {
  const text = [
    "A prompt can tell an AI to vary sentence length. A corpus can show it how sentence lengths actually vary.",
    "The pilot corpus contains measured academic documents. Those measurements provide a reference for cadence without proving authorship.",
  ].join("\n\n");

  const result = analyseResidualWriting(text);
  assert.ok(result.metrics.ordinary_content_sentence_count >= 2);
  assert.equal(result.should_rework, false);
  assert.equal(result.signals.some((signal) => signal.id === "nominalisation_pressure"), false);
});

test("flags repeated rhetorical valuation when sentences mainly announce importance instead of developing the proposition", () => {
  const text = [
    "This is a major breakthrough. That distinction is enormous. The result is a significant achievement.",
    "The evidence base remains small, however, and additional documents are still required before narrow disciplinary claims can be made.",
  ].join("\n\n");

  const result = analyseResidualWriting(text);
  assert.ok(result.signals.some((signal) => signal.id === "rhetorical_valuation"));
});

test("detects taxonomy pressure without claiming that every substantive list must be removed", () => {
  const text = [
    "The system distinguishes among five treatment modes: preserve and polish, repair clarity and flow, strengthen context, reconstruct discourse, and redevelop weak reasoning.",
    "The next framework is divided into four stages: diagnosis, planning, revision and audit.",
    "These categories are product controls and may therefore remain when they represent actual system behaviour.",
  ].join("\n\n");

  const result = analyseResidualWriting(text);
  const signal = result.signals.find((item) => item.id === "taxonomy_pressure");
  assert.ok(signal);
  assert.match(signal.action, /Keep classifications that genuinely belong to the source or product design/i);
});

test("rechecks document-level architecture so unresolved discourse reconstruction is not mistaken for successful sentence rewriting", () => {
  const text = [
    "Three principal findings emerge from the analysis. First, governance appears relevant. Second, the relationship varies by leverage. Third, creditor responses differ across conditions.",
    "Three practical implications follow from the evidence. First, boards should not assume one universal effect. Second, lenders may interpret the same mechanism differently. Third, financing context remains important.",
    "Three theoretical points organise the explanation. First, agency conflict affects creditor risk. Second, information asymmetry affects pricing. Third, governance signals can be conditional.",
    "Three conclusions therefore follow from the discussion. First, the evidence is mixed. Second, the mechanisms are context dependent. Third, further integrated analysis is warranted.",
  ].join("\n\n");

  const result = analyseResidualWriting(text);
  const ids = result.signals.map((signal) => signal.id);
  assert.equal(result.measurement_version, "residual-writing-v2");
  assert.ok(ids.includes("argument_packaging"));
  assert.ok(ids.includes("enumeration_saturation"));
  assert.ok(result.metrics.discourse_architecture_signal_count >= 2);
  assert.ok(result.target_blocks.length > 0);
  assert.equal(result.should_rework, true);
});
