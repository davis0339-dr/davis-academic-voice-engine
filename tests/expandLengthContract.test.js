import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLengthContract, lengthContractSatisfied } from "../server/lib/lengthContract.js";
import { auditOutputAcceptance } from "../server/lib/outputAcceptance.js";
import { allocateLongDocumentExpansion } from "../server/lib/jobStore.js";

const words = (count, prefix = "word") => Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");

test("single-editor Expand requires at least 200 net additional words", () => {
  const source = words(1458, "source");
  const contract = buildLengthContract({ sourceText: source, preference: "expand" });
  assert.equal(contract.source_words, 1458);
  assert.equal(contract.minimum_addition_words, 200);
  assert.equal(contract.minimum_candidate_words, 1658);
  assert.equal(lengthContractSatisfied(words(1657), contract), false);
  assert.equal(lengthContractSatisfied(words(1658), contract), true);
});

test("completed-output audit rejects an Expand candidate that is not 200 words longer", () => {
  const source = words(400, "source");
  const candidate = `${source} ${words(199, "added")}`;
  const audit = auditOutputAcceptance({
    sourceText: source,
    candidateText: candidate,
    rewriteIntensity: "deep",
    naturalisation: "aggressive",
    lengthPreference: "expand",
  });
  assert.ok(audit.reasons.includes("expand_length_contract_missed"));
  assert.equal(audit.dimensions.minimum_expansion_candidate_words, 600);
  assert.equal(audit.dimensions.expansion_word_deficit, 1);
});

test("long-document chunks share one 200-word document-level addition exactly", () => {
  const allocation = allocateLongDocumentExpansion([
    { index: 0, sourceText: words(500), rewriteMode: "rewrite" },
    { index: 1, sourceText: words(300), rewriteMode: "rewrite" },
    { index: 2, sourceText: words(200), rewriteMode: "rewrite" },
    { index: 3, sourceText: words(100), rewriteMode: "passthrough" },
  ]);
  assert.equal([...allocation.values()].reduce((sum, value) => sum + value, 0), 200);
  assert.equal(allocation.get(0), 100);
  assert.equal(allocation.get(1), 60);
  assert.equal(allocation.get(2), 40);
  assert.equal(allocation.has(3), false);
});
