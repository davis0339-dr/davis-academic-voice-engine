import { test } from "node:test";
import assert from "node:assert/strict";
import { applyExpansionAdditions, expansionParagraphs } from "../server/lib/expansionAdditions.js";
import { buildLengthContract, manuscriptWordCount } from "../server/lib/lengthContract.js";
import { rewrite, recoverExpansionResult, modelOutputTokenBudget, analyse } from "../server/lib/pipeline.js";
import { llmProvider } from "../server/lib/llmProvider.js";
import { buildSystemPrompt } from "../server/lib/promptContract.js";

const source = "Independent oversight matters to creditors because reporting informs their assessment of debt repayment. The study examines board independence and debt cost among manufacturing firms. It distinguishes oversight of management from oversight of financial reporting. The proposed relationship is an association, not an established causal result. Differences between these governance roles need explanation before the relationship is interpreted.";
const additions = [
  "The starting point is the creditor's need to assess repayment. Reporting enters that assessment because it supplies information about the firm. Oversight therefore belongs in the argument through its relationship with reporting and creditor assessment, rather than through a general claim that governance is important. The proposed study concerns that relationship within manufacturing firms.",
  "Board independence and reporting oversight should not be treated as interchangeable terms. Oversight of management concerns the conduct being monitored. Oversight of financial reporting concerns the information through which that conduct is assessed. Explaining the distinction gives the reader a reason to ask which aspect of oversight the proposed debt-cost relationship is meant to represent.",
  "The distinction also affects how the argument should be read. The discussion of financial reporting addresses the creditor assessment already identified in the proposed study. Its relevance follows from the stated role of reporting in that assessment. The argument should explain this connection before interpreting the proposed association between board independence and debt cost in manufacturing firms.",
  "The study's focus on manufacturing firms sets the context for this reasoning. The discussion should return to that setting when describing the proposed relationship. It need not move to a different population or introduce an additional governance mechanism to develop the argument. Instead, it should explain how the already specified elements fit together within the stated study.",
  "Finally, the proposed relationship retains its associative meaning. The argument connects oversight, reporting, creditor assessment and debt cost, but it does not establish that oversight causes a change in debt cost. Keeping this boundary visible allows the reasoning to be developed without presenting the proposed investigation as a completed finding. The explanation can be fuller while the evidential claim remains qualified.",
];

test("additive recovery preserves every existing paragraph and its formatting", () => {
  const candidate = `${source}\r\n \r\nThe argument distinguishes oversight roles.`;
  const result = applyExpansionAdditions({ sourceText: candidate, candidateText: candidate, additions: [{ after_paragraph: 1, text: additions[0] }] });
  assert.equal(result.accepted_additions, 1);
  assert.equal(result.revised_text.replace(`\n\n${additions[0]}`, ""), candidate);
  assert.equal(result.added_words, manuscriptWordCount(additions[0]));
  assert.equal(expansionParagraphs(candidate).length, 2);
});

test("invalid locations, copied wording and invented numbers cannot contribute to expansion", () => {
  const result = applyExpansionAdditions({ sourceText: source, candidateText: source, additions: [
    { after_paragraph: 99, text: additions[0] },
    { after_paragraph: 1, text: source },
    { after_paragraph: 1, text: "The study found debt costs were 15 percent lower in 2024." },
    { after_paragraph: 1, text: additions[0] },
  ] });
  assert.equal(result.accepted_additions, 1);
  assert.equal(result.rejected_additions.length, 3);
  assert.equal(result.revised_text, `${source}\n\n${additions[0]}`);
});

test("one additions call develops a short candidate without full-document regeneration", async () => {
  const original = llmProvider.callAnthropic;
  let calls = 0;
  llmProvider.callAnthropic = async ({ system, messages }) => {
    calls += 1;
    assert.match(system, /CURRENT CANDIDATE is locked/);
    assert.match(messages[0].content, /CURRENT DEFICIT:/);
    return { text: JSON.stringify({ additions: additions.map((text) => ({ after_paragraph: 1, text })) }), raw: { stop_reason: "end_turn" } };
  };
  try {
    const result = await recoverExpansionResult({ sourceText: source, result: { revised_text: source, edit_summary: { kept: 4 }, length_contract: buildLengthContract({ sourceText: source, preference: "expand" }) } });
    assert.equal(calls, 1);
    assert.equal(result.length_contract.satisfied, true);
    assert.ok(manuscriptWordCount(result.revised_text) >= manuscriptWordCount(source) + 200);
    assert.equal(result.revised_text, `${source}\n\n${additions.join("\n\n")}`);
    assert.deepEqual(result.edit_summary, { kept: 4 });
  } finally { llmProvider.callAnthropic = original; }
});

test("provider failure retains the existing candidate instead of restarting the pipeline", async () => {
  const original = llmProvider.callAnthropic;
  llmProvider.callAnthropic = async () => { throw Object.assign(new Error("timeout"), { healthState: "NETWORK_TIMEOUT" }); };
  try {
    const result = await recoverExpansionResult({ sourceText: source, result: { revised_text: source, length_contract: buildLengthContract({ sourceText: source, preference: "expand" }) } });
    assert.equal(result.revised_text, source);
    assert.equal(result.length_contract.satisfied, false);
    assert.equal(result.length_contract.recovery.attempts[0].error.code, "NETWORK_TIMEOUT");
  } finally { llmProvider.callAnthropic = original; }
});

test("deferred editor recovery does not spend an additions call before preservation repair", async () => {
  const original = llmProvider.callAnthropic;
  let calls = 0;
  llmProvider.callAnthropic = async () => {
    calls += 1;
    return { text: JSON.stringify({ revised_text: source, edit_summary: { kept: 4, micro_edits: 0, sentence_restructures: 0, split_or_merge: 0, paragraph_reorders: 0, flags_for_author: [] } }), raw: { stop_reason: "end_turn" } };
  };
  try {
    const result = await rewrite({ sourceText: source, styleFilters: {}, rewriteIntensity: "deep", lengthPreference: "expand", deferExpansionRecovery: true });
    assert.equal(calls, 1);
    assert.equal(result.length_contract.recovery.attempted, false);
  } finally { llmProvider.callAnthropic = original; }
});

test("the effective Expand prompt no longer contradicts its mandatory minimum", () => {
  const analysis = analyse({ sourceText: source, styleFilters: {}, rewriteIntensity: "deep", lengthPreference: "expand" });
  const prompt = buildSystemPrompt({ sourceText: source, styleProfile: analysis.style_profile_used.effective, protectedSpans: analysis.protectedSpans, plan: analysis.plan, lengthPreference: "expand" });
  assert.match(prompt, /mandatory production requirement/);
  assert.doesNotMatch(prompt, /no global word-growth quota|not a word-growth quota/);
  const contract = buildLengthContract({ sourceText: "word ".repeat(1319), preference: "expand" });
  assert.ok(modelOutputTokenBudget("word ".repeat(1319), "fidelity", contract) > modelOutputTokenBudget("word ".repeat(1319), "fidelity"));
});
