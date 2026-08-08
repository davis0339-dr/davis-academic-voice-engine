import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptedArgumentNodes,
  chunkEvidenceSource,
  extractJsonObject,
  normalizeArgumentMap,
  normalizeEvidenceLinks,
  retrieveEvidenceCandidates,
  summarizeAgency,
} from "../server/lib/researcherAgency.js";

test("normalizes an argument map without inventing node content", () => {
  const map = normalizeArgumentMap({
    researcher_summary: "Board independence may matter to creditors through monitoring.",
    nodes: [
      { id: "x", type: "mechanism", statement: "Independent directors may challenge managerial risk-taking.", origin: "researcher", researcher_status: "accepted", confidence: "high" },
      { id: "y", type: "made_up_type", statement: "Formal independence may be insufficient without information access.", origin: "shared", researcher_status: "modified" },
      { id: "z", type: "claim", statement: "   " },
    ],
    boundaries: ["Do not treat information access as a moderator."],
  });

  assert.equal(map.nodes.length, 2);
  assert.equal(map.nodes[0].type, "mechanism");
  assert.equal(map.nodes[1].type, "claim");
  assert.equal(map.boundaries[0], "Do not treat information access as a moderator.");
});

test("extracts JSON from a fenced model response", () => {
  const parsed = extractJsonObject("```json\n{\"researcher_summary\":\"x\",\"nodes\":[]}\n```");
  assert.equal(parsed.researcher_summary, "x");
});

test("chunks source material with stable source identity and paragraph locators", () => {
  const source = {
    id: "paper-1",
    title: "Governance Paper",
    citation: "Author (2024)",
    text: "First paragraph about monitoring and creditors.\n\nSecond paragraph about managerial risk and independent directors.\n\nThird paragraph about debt pricing and information.",
  };
  const chunks = chunkEvidenceSource(source, { targetWords: 5, maxWords: 12 });
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].source_id, "paper-1");
  assert.match(chunks[0].locator, /paragraphs/);
  assert.equal(chunks[0].citation, "Author (2024)");
});

test("retrieves source passages against argument meaning words rather than source order", () => {
  const argumentMap = {
    nodes: [
      { id: "arg-1", type: "mechanism", statement: "Independent directors constrain managerial risk through stronger monitoring.", researcher_status: "accepted" },
    ],
  };
  const sources = [
    { id: "irrelevant", title: "Unrelated", text: "Inventory turnover measures the speed with which stock is sold and replenished." },
    { id: "relevant", title: "Relevant", text: "Independent directors can strengthen board monitoring and constrain managerial risk taking when oversight is effective." },
  ];
  const results = retrieveEvidenceCandidates(argumentMap, sources, { perNode: 2 });
  assert.equal(results.length, 1);
  assert.equal(results[0].candidates[0].source_id, "relevant");
  assert.ok(results[0].candidates[0].retrieval_score > 0);
});

test("rejected researcher nodes do not become reconstruction inputs", () => {
  const nodes = acceptedArgumentNodes({
    nodes: [
      { id: "a", type: "claim", statement: "Retain this.", researcher_status: "accepted" },
      { id: "b", type: "claim", statement: "Do not retain this.", researcher_status: "rejected" },
    ],
  });
  assert.deepEqual(nodes.map((node) => node.id), ["a"]);
});

test("evidence links keep conservative relationship labels", () => {
  const links = normalizeEvidenceLinks({ links: [
    { argument_id: "a", source_id: "s", relationship: "contradicts", excerpt: "The study found no association." },
    { argument_id: "a", source_id: "t", relationship: "certainly_proves", excerpt: "Something." },
  ] });
  assert.equal(links[0].relationship, "contradicts");
  assert.equal(links[1].relationship, "candidate");
});

test("agency summary separates origin from researcher review status", () => {
  const summary = summarizeAgency({ nodes: [
    { statement: "A", origin: "researcher", researcher_status: "accepted" },
    { statement: "B", origin: "system_suggestion", researcher_status: "rejected" },
    { statement: "C", origin: "shared", researcher_status: "modified" },
  ] });
  assert.equal(summary.node_count, 3);
  assert.equal(summary.researcher, 1);
  assert.equal(summary.system_suggestion, 1);
  assert.equal(summary.shared, 1);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.modified, 1);
});
