import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveAuthoringSections,
  deterministicSourceAssembly,
  normalizeGuidedPlan,
  verifyAssemblyExtracts,
} from "../server/lib/sourceGroundedAuthoring.js";

const sources = [
  {
    id: "anderson",
    title: "Anderson et al. (2004)",
    citation: "Anderson et al. (2004)",
    text: "[Page 4]\n\nCreditors rely on accounting-based numbers when assessing firm health and viability.\n\n[Page 7]\n\nGreater board independence is associated with a lower cost of debt financing.",
  },
  {
    id: "bradley",
    title: "Bradley and Chen (2015)",
    text: "[Page 3]\n\nBoard independence reduces the cost of debt when shareholder and bondholder conflict is mild, but increases it when the conflict becomes severe.",
  },
];

test("derives sections from a researcher-supplied structure", () => {
  const sections = deriveAuthoringSections("Introduction\n\nBackground of the Problem\n\nProblem Statement", "template");
  assert.deepEqual(sections.map((section) => section.heading), ["Introduction", "Background of the Problem", "Problem Statement"]);
});

test("local assembly preserves retrieved extracts exactly and spends no model calls", () => {
  const assembly = deterministicSourceAssembly({
    entryMode: "develop",
    structureText: "Background of the Problem\nBoard independence and cost of debt under different conflict conditions.",
    sources,
  });
  assert.equal(assembly.model_calls, 0);
  assert.equal(assembly.assembly_mode, "local_verbatim_retrieval");
  assert.ok(assembly.extract_count > 0);
  assert.equal(verifyAssemblyExtracts(assembly, sources).exact, true);
  for (const block of assembly.sections.flatMap((section) => section.blocks).filter((block) => block.type === "extract")) {
    assert.equal(sources.find((source) => source.id === block.source_id).text.includes(block.text), true);
    assert.equal(block.locked, true);
  }
});

test("guided ordering may reorder IDs but cannot replace extract wording", () => {
  const local = deterministicSourceAssembly({
    entryMode: "rebuild",
    structureText: "Background of the Problem\nBoard independence and debt cost.",
    sources,
  });
  const extracts = local.sections[0].blocks.filter((block) => block.type === "extract");
  assert.ok(extracts.length >= 2);
  const guided = normalizeGuidedPlan({
    sections: [{
      section_id: local.sections[0].id,
      ordered_extract_ids: [extracts[1].id, extracts[0].id],
      links: [{ before_extract_id: extracts[0].id, link: "The next source presents a related position:" }],
    }],
  }, local);
  const guidedExtracts = guided.sections[0].blocks.filter((block) => block.type === "extract");
  assert.equal(guidedExtracts[0].text, extracts[1].text);
  assert.equal(guidedExtracts[1].text, extracts[0].text);
  assert.equal(verifyAssemblyExtracts(guided, sources).exact, true);
  assert.equal(guided.model_calls, 1);
});

test("exact-source verification rejects altered extracts", () => {
  const assembly = deterministicSourceAssembly({ entryMode: "develop", structureText: "Board independence and cost of debt", sources });
  const extract = assembly.sections[0].blocks.find((block) => block.type === "extract");
  extract.text = `${extract.text} Added wording.`;
  assert.equal(verifyAssemblyExtracts(assembly, sources).exact, false);
});
