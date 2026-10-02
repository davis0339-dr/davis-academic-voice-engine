import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { rewriteRouter } from "../server/routes/rewrite.js";
import { llmProvider } from "../server/lib/llmProvider.js";
import { manuscriptWordCount } from "../server/lib/lengthContract.js";

const source = "Creditors use reporting to assess debt repayment. Independent oversight is relevant because it concerns the reporting and management activity being assessed. The proposed study examines the association between board independence and debt cost among manufacturing firms. The argument distinguishes oversight of management from oversight of reporting before interpreting that association.";
const development = [
  "The creditor assessment described here gives reporting a specific role in the argument. Reporting supplies the information being assessed; oversight concerns the reporting and management activity behind that information. Explaining the connection gives the reader a basis for considering the proposed association between board independence and debt cost. It does not turn the association into a causal finding.",
  "The distinction between management oversight and reporting oversight should therefore be kept visible. Both appear in the supplied argument, but they describe different aspects of the activity being assessed. An explanation of reporting oversight should identify its connection with the reporting used by creditors. A discussion of management oversight should retain its separate focus on management activity.",
  "The manufacturing setting also belongs in the interpretation. The proposed study is about manufacturing firms, so the discussion should retain that population when explaining the association under examination. There is no need to substitute a different sector or introduce an additional governance mechanism. Development can clarify the relationship between the already specified elements within the stated setting.",
  "The relationship being examined is still proposed, rather than a finding already established by the study. Describing why the elements belong together is part of the argument for investigation. It should not be presented as proof that independent oversight changes borrowing costs. The fuller explanation retains this distinction between a reason to investigate and a result of investigation.",
];
const envelope = (text) => ({ revised_text: text, edit_summary: { kept: 4, micro_edits: 0, sentence_restructures: 0, split_or_merge: 0, paragraph_reorders: 0, flags_for_author: [] } });

async function runRoute(replies) {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousCall = llmProvider.callAnthropic;
  process.env.ANTHROPIC_API_KEY = "test-only-no-provider-request";
  const systems = [];
  llmProvider.callAnthropic = async ({ system }) => {
    systems.push(system);
    assert.ok(systems.length <= replies.length, "no extra model retries");
    return { text: JSON.stringify(replies[systems.length - 1]), raw: { stop_reason: "end_turn" } };
  };
  const app = express();
  app.use(express.json());
  app.use("/api", rewriteRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/rewrite`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: source, lengthPreference: "expand", rewriteIntensity: "auto", naturalisation: "off" }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.message);
    return { body, systems };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    llmProvider.callAnthropic = previousCall;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
}

test("the real editor route repairs facts first, then expands without regenerating the repaired draft", async () => {
  const { body, systems } = await runRoute([
    envelope(`${source} The study will examine firms in 2025.`),
    { revised_text: source },
    { additions: development.map((text) => ({ after_paragraph: 1, text })) },
  ]);
  assert.equal(systems.length, 3);
  assert.match(systems[1], /repairing factual/);
  assert.match(systems[2], /CURRENT CANDIDATE is locked/);
  assert.ok(body.revised_text.startsWith(source));
  assert.doesNotMatch(body.revised_text, /2025/);
  assert.ok(manuscriptWordCount(body.revised_text) >= manuscriptWordCount(source) + 200);
  assert.equal(body.length_contract.satisfied, true);
  assert.equal(body.length_contract.effective_outcome, "expand_completed");
  assert.ok(!body.output_acceptance.reasons.includes("expand_length_contract_missed"));
});

test("a failed additions response preserves the draft and never silently switches Expand to Maintain", async () => {
  const { body, systems } = await runRoute([envelope(source), { revised_text: "A shorter replacement must never be applied." }]);
  assert.equal(systems.length, 2);
  assert.equal(body.revised_text, source);
  assert.equal(body.length_contract.satisfied, false);
  assert.equal(body.length_contract.effective_outcome, "expand_incomplete");
  assert.ok(body.output_acceptance.reasons.includes("expand_length_contract_missed"));
  assert.notEqual(body.candidate_verdict.final_status, "accepted");
});
