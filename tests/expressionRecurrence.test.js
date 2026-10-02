import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import vm from "node:vm";
import express from "express";
import { analyseExpressionRecurrence, auditExpressionRecurrence, AUTHORIAL_EXPRESSION_CONTRACT } from "../server/lib/expressionRecurrence.js";
import { auditOutputAcceptance } from "../server/lib/outputAcceptance.js";
import { analyseResidualWriting } from "../server/lib/residualDiagnostics.js";
import { shouldAcceptResidualCandidate, selectiveResidualRework, buildResidualSystemPrompt, buildDevelopmentRecoverySystemPrompt } from "../server/lib/residualRework.js";
import { analyse, buildExpansionCompletionPrompt } from "../server/lib/pipeline.js";
import { buildSystemPrompt } from "../server/lib/promptContract.js";
import { repairPrompt } from "../server/lib/preservationRepair.js";
import { llmProvider } from "../server/lib/llmProvider.js";
import { rewriteRouter } from "../server/routes/rewrite.js";

// Entirely synthetic. Live manuscript regression evidence stays local/private.
const source = `Synthetic Research Example

Case Alpha concerns whether reporting is reliable. Creditors consider accounting information before pricing a loan, so audit committee oversight concerns the reporting process. A boundary condition follows: formal independence is not proof of effective monitoring. The draft retains that unresolved condition.

Case Beta concerns how oversight relates to managerial risk. The mechanism could affect a lender's judgement; creditor valuation may depend on the behaviour being monitored. The source states "Monitoring is not a guarantee." It does not claim that the study establishes causation.`;
const candidate = source.replace(", so audit committee", ", which means that audit committee")
  .replace("; creditor valuation", ", which means creditor valuation");
const repairWording = (text) => text.replace(", which means that audit committee", ", so audit committee")
  .replace(", which means creditor valuation", "; creditor valuation");

test("source-relative expression audit identifies introduced phrase pairs and their paragraphs", () => {
  const audit = auditExpressionRecurrence(source, candidate);
  const issue = audit.issues.find((row) => row.phrase === "which means");
  assert.equal(issue.source_count, 0);
  assert.equal(issue.count, 2);
  assert.deepEqual(issue.block_indices, [1, 2]);
  assert.equal(audit.regression, true);
  assert.equal(auditExpressionRecurrence(source, repairWording(candidate)).issues.length, 0);
  const acceptance = auditOutputAcceptance({ sourceText: source, candidateText: candidate });
  assert.notEqual(acceptance.status, "pass");
  assert.ok(acceptance.reasons.includes("expression_recurrence_introduced"));
  assert.ok(acceptance.target_paragraph_indices.includes(1));
  assert.ok(acceptance.target_paragraph_indices.includes(2));
});

test("recurring evaluative words carry exact counts and local targets without banning ordinary adjectives", () => {
  const text = ["The crucial distinction concerns information available at the time of contracting.", "The crucial point concerns how managers respond once financing is agreed.", "The crucial implication concerns the interpretation of the observed debt costs."].join("\n\n");
  assert.equal(analyseExpressionRecurrence(text).issues.find((row) => row.phrase === "crucial").count, 3);
  const residual = analyseResidualWriting(text);
  assert.ok(residual.signals.some((row) => row.id === "expression_recurrence"));
  assert.ok(residual.target_blocks.length >= 2);
  const technical = Array.from({ length: 4 }, () => "Audit committee independence may predict cost of debt. A significant association could reflect robust standard errors or a strong effect. The fundamental theorem defines the mathematical relation.").join("\n\n");
  assert.equal(analyseExpressionRecurrence(technical).issues.length, 0);
  assert.equal(auditExpressionRecurrence(candidate, candidate).issues.length, 0);
});

test("multi-sentence quotations and reference lists remain excluded from expression targets", () => {
  const text = `The author writes, "Which means the result is crucial. Which means the point is crucial. Which means the implication is crucial." The qualification is retained.

References

Author (2024). The crucial insight and which means in research discussion.

Author (2023). The crucial insight and which means in research discussion.

Author (2022). The crucial insight and which means in research discussion.`;
  assert.equal(analyseExpressionRecurrence(text).matches.length, 0);
});

test("length recovery and aggregate score gains cannot excuse new repeated expression", () => {
  const before = { status: "review_required", score: 65, reasons: ["expand_length_contract_missed"], dimensions: { candidate_expression_repeated_occurrences: 0 } };
  const after = { status: "pass", score: 85, reasons: [], hard_failures: [], dimensions: { candidate_expression_repeated_occurrences: 2 } };
  assert.equal(shouldAcceptResidualCandidate({ preservationOk: true, noResidualRegression: true, beforeScore: 18, afterScore: 1, beforeAcceptance: before, afterAcceptance: after }), false);
  const previous = auditOutputAcceptance({ sourceText: source, candidateText: candidate });
  const rotated = auditOutputAcceptance({ sourceText: source, candidateText: candidate.replaceAll("which means", "this highlights") });
  assert.equal(previous.dimensions.candidate_expression_repeated_occurrences, rotated.dimensions.candidate_expression_repeated_occurrences);
  assert.equal(shouldAcceptResidualCandidate({ preservationOk: true, noResidualRegression: true, beforeScore: 30, afterScore: 1, beforeAcceptance: previous, afterAcceptance: { ...rotated, status: "pass", score: 99 } }), false);
});

test("primary generation, expansion and repairs share a reasoning-led expression contract", () => {
  const analysis = analyse({ sourceText: source, naturalisation: "aggressive", rewriteIntensity: "deep" });
  const prompt = buildSystemPrompt({ sourceText: source, styleProfile: analysis.style_profile_used.effective, protectedSpans: analysis.protectedSpans, plan: analysis.plan, naturalisation: "aggressive" });
  assert.doesNotMatch(prompt, /Preserve sequence: FRAME/);
  for (const system of [prompt, buildResidualSystemPrompt(), buildDevelopmentRecoverySystemPrompt(), repairPrompt(), buildExpansionCompletionPrompt({ source_words: 400, minimum_candidate_words: 600, target_candidate_words: 650, maximum_candidate_words: 750 })]) {
    assert.ok(system.includes(AUTHORIAL_EXPRESSION_CONTRACT));
    assert.match(system, /Do not obtain a less polished rhythm by compressing/);
  }
});

test("selective recovery targets exact recurrence, preserves evidence and makes one bounded call", async () => {
  const original = llmProvider.callAnthropic;
  let calls = 0;
  llmProvider.callAnthropic = async ({ messages }) => {
    calls += 1;
    const payload = JSON.parse(messages[0].content);
    assert.ok(payload.targets.some((target) => target.expression_recurrence?.some((issue) => issue.phrase === "which means")));
    return { text: JSON.stringify({ replacements: payload.targets.map((target) => ({ block_index: target.block_index, revised_text: repairWording(target.candidate_text) })) }) };
  };
  try {
    const result = await selectiveResidualRework({ sourceText: source, candidateText: candidate });
    assert.equal(calls, 1);
    assert.equal(result.accepted, true);
    assert.equal(result.revised_text, source);
    assert.ok(result.revised_text.includes('"Monitoring is not a guarantee."'));
    assert.ok(result.revised_text.includes("may depend"));
  } finally { llmProvider.callAnthropic = original; }
});

test("the editor endpoint returns repaired text and its final audit, not the pre-repair candidate", async () => {
  const previousCall = llmProvider.callAnthropic;
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-only-no-network-provider-call";
  let calls = 0;
  llmProvider.callAnthropic = async ({ system, messages }) => {
    calls += 1;
    assert.ok(calls <= 2);
    if (calls === 1) return { text: JSON.stringify({ revised_text: candidate, edit_summary: { kept: 6, micro_edits: 2, sentence_restructures: 0, split_or_merge: 0, paragraph_reorders: 0, flags_for_author: [] } }), raw: { stop_reason: "end_turn" } };
    assert.match(system, /SELECTIVE COMPLETED-OUTPUT RECOVERY/);
    const payload = JSON.parse(messages[0].content);
    return { text: JSON.stringify({ replacements: payload.targets.map((target) => ({ block_index: target.block_index, revised_text: repairWording(target.candidate_text) })) }), raw: { stop_reason: "end_turn" } };
  };
  const app = express();
  app.use(express.json());
  app.use("/api", rewriteRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/rewrite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: source, naturalisation: "faithful", rewriteIntensity: "auto", lengthPreference: "auto" }) });
    const body = await response.json();
    assert.equal(response.status, 200, body.message);
    assert.equal(calls, 2);
    assert.equal(body.residual_rework.accepted, true);
    assert.equal(body.revised_text, source);
    assert.equal(body.output_acceptance.expression_recurrence.issues.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    llmProvider.callAnthropic = previousCall;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

test("the actual verdict UI renders source-to-revision counts and escapes evidence", async () => {
  const panel = { innerHTML: "" };
  const scheduled = [];
  const audit = auditExpressionRecurrence(source, candidate);
  audit.issues[0].phrase += " <unsafe>";
  const body = { candidate_verdict: { final_status: "accepted_with_residual_risks" }, output_acceptance: { expression_recurrence: audit } };
  const context = vm.createContext({ window: { fetch: async () => ({ ok: true, clone: () => ({ json: async () => body }) }), addEventListener() {} }, document: { getElementById: (id) => id === "tab-changes" || id === "candidateVerdictV4" ? panel : null, createElement: () => ({}), head: { appendChild() {} } }, setTimeout: (callback) => { scheduled.push(callback); return 1; }, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(new URL("../public/rewriteVerdict.js", import.meta.url), "utf8"), context);
  await context.window.fetch("/api/rewrite");
  await new Promise((resolve) => setImmediate(resolve));
  scheduled.forEach((callback) => callback());
  assert.match(panel.innerHTML, /source 0 → revision 2/);
  assert.match(panel.innerHTML, /across 2 reasoning blocks/);
  assert.match(panel.innerHTML, /&lt;unsafe&gt;/);
  assert.doesNotMatch(panel.innerHTML, /<unsafe>/);
});
