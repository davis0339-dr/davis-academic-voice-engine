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
    bibliographic: { author: "Anderson et al.", year: "2004", title: "Boards and the cost of debt", publication: "Journal of Accounting and Economics", doi: "10.1000/example" },
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
    entryMode: "develop",
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

test("existing-draft mode preserves author paragraphs and aligns extracts at citation-bearing locations", () => {
  const authorParagraph = "Board independence may reduce creditor uncertainty, although the relationship remains conditional (Anderson et al., 2004).";
  const assembly = deterministicSourceAssembly({
    entryMode: "rebuild",
    structureText: `Background of the Problem\n${authorParagraph}`,
    sources,
  });
  assert.equal(assembly.workflow_mode, "existing_structure_citation_alignment");
  const blocks = assembly.sections[0].blocks;
  assert.equal(blocks[0].type, "author_text");
  assert.equal(blocks[0].text, authorParagraph);
  assert.ok(blocks.some((block) => block.type === "extract" && block.aligned_to === blocks[0].id));
  assert.equal(verifyAssemblyExtracts(assembly, sources).exact, true);
});

test("ground-up manuscript mode builds from source evidence instead of retaining guide prose as manuscript text", () => {
  const guideSentence = "Discuss board independence and creditor uncertainty (Anderson et al., 2004).";
  const assembly = deterministicSourceAssembly({ entryMode: "develop", structureText: `Background\n${guideSentence}`, sources });
  assert.equal(assembly.workflow_mode, "ground_up_source_scaffold");
  assert.equal(assembly.sections.flatMap((section) => section.blocks).some((block) => block.type === "author_text"), false);
});

test("a substantive template with citation locations preserves its authored body instead of behaving like ground-up mode", () => {
  const templateParagraph = "Credit pricing reflects governance quality as well as accounting risk (Anderson et al., 2004).";
  const assembly = deterministicSourceAssembly({ entryMode: "template", structureText: `Introduction\n${templateParagraph}`, sources });
  assert.equal(assembly.workflow_mode, "existing_structure_citation_alignment");
  assert.equal(assembly.sections[0].blocks[0].text, templateParagraph);
  assert.equal(assembly.sections[0].blocks[0].type, "author_text");
});

test("every extract carries the reviewed bibliographic record and the assembly exposes working references", () => {
  const assembly = deterministicSourceAssembly({ entryMode: "develop", structureText: "Board independence and debt cost", sources });
  const extract = assembly.sections.flatMap((section) => section.blocks).find((block) => block.type === "extract" && block.source_id === "anderson");
  assert.equal(extract.bibliographic.author, "Anderson et al.");
  assert.equal(extract.bibliographic.year, "2004");
  assert.equal(extract.parenthetical_citation, "(Anderson et al., 2004)");
  assert.match(assembly.reference_records.find((record) => record.source_id === "anderson").working_reference, /Journal of Accounting and Economics/);
});
