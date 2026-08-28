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
    bibliographic: { author: "Anderson et al.", year: "2004", title: "Boards and the cost of debt", publication: "Journal of Accounting and Economics", doi: "10.1000/example", metadata_confidence: "researcher_reviewed" },
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

test("exact-source verification still covers passages located beyond the retired 60,000-character source ceiling", () => {
  const targetPassage = "Greater board independence is associated with lower debt financing costs because creditors value reliable monitoring arrangements.";
  const longSource = `${"Background material about governance systems and institutional context. ".repeat(1000)}\n${targetPassage}`;
  assert.ok(longSource.indexOf(targetPassage) > 60000);
  const assembly = {
    sections: [{ id: "section-1", heading: "Finding", blocks: [{ id: "late-extract", type: "extract", source_id: "late", text: targetPassage }] }],
  };
  assert.equal(verifyAssemblyExtracts(assembly, [{ id: "late", text: longSource }]).exact, true);
});

test("processes the complete 61,707-character single-line-break manuscript without collapsing it", () => {
  const targetLength = 61707;
  const heading = "Literature Search Strategy";
  const paragraphCount = 97;
  const remaining = targetLength - heading.length - paragraphCount;
  const baseLength = Math.floor(remaining / paragraphCount);
  const remainder = remaining % paragraphCount;
  const paragraphs = Array.from({ length: paragraphCount }, (_, index) => {
    const target = baseLength + (index < remainder ? 1 : 0);
    const prefix = `Paragraph ${index + 1} explains how board oversight affects creditor assessment and debt pricing. `;
    const suffix = " The relationship remains conditional (Anderson et al., 2004).";
    const fillerLength = target - prefix.length - suffix.length;
    return `${prefix}${"evidence ".repeat(Math.ceil(fillerLength / 9)).slice(0, fillerLength)}${suffix}`;
  });
  const manuscript = [heading, ...paragraphs].join("\n");
  assert.equal(manuscript.length, targetLength);
  assert.equal((manuscript.match(/\n/g) || []).length, 97);
  assert.equal((manuscript.match(/\n\s*\n/g) || []).length, 0);

  const sections = deriveAuthoringSections(manuscript, "rebuild");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].paragraphs.length, paragraphCount);
  assert.equal(sections[0].paragraphs.at(-1).text, paragraphs.at(-1));

  const assembly = deterministicSourceAssembly({ entryMode: "rebuild", structureText: manuscript, sources });
  assert.equal(assembly.input_audit.submitted_characters, targetLength);
  assert.equal(assembly.input_audit.processed_characters, targetLength);
  assert.equal(assembly.input_audit.complete, true);
  assert.equal(assembly.input_audit.paragraph_count, paragraphCount);
  assert.equal(assembly.input_audit.citation_anchor_count, paragraphCount);
  assert.ok(assembly.sections.flatMap((section) => section.blocks).some((block) => block.type === "author_text" && block.text === paragraphs.at(-1)));
});

test("splits grouped citations into source-specific anchors and rejects bare years", () => {
  const paragraph = "Prior evidence differs across settings (Anderson et al., 2004; Bradley & Chen, 2015; Liu and Jiraporn, 2010), while another summary mentioned (2021).";
  const sections = deriveAuthoringSections(`Literature Review\n${paragraph}`, "rebuild");
  assert.deepEqual(sections[0].paragraphs[0].citation_anchors, [
    "(Anderson et al., 2004)",
    "(Bradley & Chen, 2015)",
    "(Liu and Jiraporn, 2010)",
  ]);
});

test("quarantines automatically inferred metadata until the researcher confirms it", () => {
  const unreviewed = [{
    ...sources[0],
    bibliographic: { ...sources[0].bibliographic, metadata_confidence: "auto_complete_review_required" },
  }];
  const paragraph = "Board independence may reduce creditor uncertainty (Anderson et al., 2004).";
  const assembly = deterministicSourceAssembly({ entryMode: "rebuild", structureText: `Literature Review\n${paragraph}`, sources: unreviewed });
  assert.equal(assembly.extract_count, 0);
  assert.deepEqual(assembly.input_audit.identities_needing_review, ["anderson"]);
  assert.ok(assembly.sections[0].blocks.some((block) => block.type === "review_note"));
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

test("title pages, bylines, URLs and page furniture can never become evidence extracts", () => {
  const source = {
    id: "jensen",
    title: "uploaded-file.pdf",
    bibliographic: { title: "Theory of the Firm", author: "Michael Jensen and William Meckling", year: "1976", metadata_confidence: "researcher_reviewed" },
    text: `[Page 1]\n[Line 1] Electronic copy available at: http://ssrn.com/abstract=94043\n[Line 2] Theory of the Firm: Managerial Behavior,\n[Line 3] Agency Costs and Ownership Structure\n[Line 4] Michael C. Jensen and William H. Meckling\n[Line 5] We define an agency relationship as a contract under which a principal engages an agent to perform a service and delegates decision-making authority.\n[Line 6] If both parties are utility maximizers, the agent will not always act in the best interests of the principal.`,
  };
  const assembly = deterministicSourceAssembly({ entryMode: "develop", structureText: "Theoretical Foundation\nExplain agency relationships and delegated decision authority.", sources: [source] });
  const extracts = assembly.sections.flatMap((section) => section.blocks).filter((block) => block.type === "extract");
  assert.ok(extracts.length > 0);
  assert.ok(extracts.every((block) => !/Theory of the Firm:|Michael C\. Jensen|ssrn\.com/i.test(block.text)));
  assert.ok(extracts.every((block) => /Page 1, lines? \d+/i.test(block.locator)));
});

test("citation-bearing draft text cannot be aligned to a different uploaded author merely because topic words overlap", () => {
  const wrongSource = {
    id: "jensen",
    bibliographic: { title: "Theory of the Firm", author: "Jensen and Meckling", year: "1976", metadata_confidence: "researcher_reviewed" },
    text: "[Page 6]\nAgency relationships can create monitoring and bonding costs when managers control firm resources and creditors bear risk. These costs affect contractual protection and financing choices.",
  };
  const paragraph = "Antitakeover provisions can protect creditors when control changes create uncertainty (Klock et al., 2005).";
  const assembly = deterministicSourceAssembly({ entryMode: "rebuild", structureText: `Literature Review\n${paragraph}`, sources: [wrongSource] });
  const blocks = assembly.sections[0].blocks;
  assert.equal(blocks.some((block) => block.type === "extract"), false);
  assert.ok(blocks.some((block) => block.type === "review_note" && /Nothing unrelated|abstained|No uploaded source passage/i.test(block.text)));
});

test("claim-aware alignment records why a passage was selected and what research function it performs", () => {
  const paragraph = "Board independence may reduce creditor uncertainty (Anderson et al., 2004).";
  const assembly = deterministicSourceAssembly({ entryMode: "rebuild", structureText: `Literature Review\n${paragraph}`, sources });
  const extract = assembly.sections[0].blocks.find((block) => block.type === "extract");
  assert.equal(extract.citation_match, true);
  assert.ok(extract.matched_claim.includes("Board independence"));
  assert.ok(extract.selection_reason.length > 20);
  assert.ok(Array.isArray(extract.research_functions));
  assert.ok(assembly.evidence_map.some((row) => row.extract_id === extract.id && row.relationship));
});

test("guided matching is server-gated against a model selecting the wrong cited study", () => {
  const allSources = [
    ...sources,
    {
      id: "jensen",
      bibliographic: { title: "Theory of the Firm", author: "Jensen and Meckling", year: "1976", metadata_confidence: "researcher_reviewed" },
      text: "[Page 6]\nAgency relationships create monitoring costs when managers and creditors have different incentives. Contract design can reduce some of these conflicts.",
    },
  ];
  const paragraph = "Board independence may reduce creditor uncertainty (Anderson et al., 2004).";
  const local = deterministicSourceAssembly({ entryMode: "rebuild", structureText: `Literature Review\n${paragraph}`, sources: allSources });
  const authorBlock = local.sections[0].blocks.find((block) => block.type === "author_text");
  const wrongAssembly = deterministicSourceAssembly({ entryMode: "develop", structureText: "Theoretical Foundation\nExplain agency relationships, monitoring costs and conflicting incentives.", sources: [allSources[2]] });
  const wrong = wrongAssembly.candidate_pool.flatMap((section) => section.candidates)[0];
  assert.ok(wrong);
  wrong.id = "src-3-extract-1";
  local.candidate_pool[0].candidates.push(wrong);
  const guided = normalizeGuidedPlan({ matches: [{ paragraph_id: authorBlock.id, extract_id: wrong.id, relationship: "supports", reason: "shared topic words" }] }, local);
  assert.equal(guided.sections[0].blocks.some((block) => block.type === "extract"), false);
  assert.ok(guided.sections[0].blocks.some((block) => block.type === "review_note"));
});
