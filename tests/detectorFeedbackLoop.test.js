import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { candidateHistoryFor, clearCandidateHistoryForTests, rememberCandidate } from "../server/lib/candidateHistory.js";
import { auditFeedbackRefinementChange, detectorFeedbackPromptBlock, resolveDetectorFeedback } from "../server/lib/detectorFeedback.js";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";

const options = {
  sourceText: "Boards monitor management. Creditors price the resulting risk. Evidence remains conditional. The study examines those relationships.",
  rewriteIntensity: "deep",
  naturalisation: "aggressive",
  lengthPreference: "expand",
};

test("external observations resolve only against the exact remembered candidate", () => {
  clearCandidateHistoryForTests();
  const history = candidateHistoryFor(options);
  const record = rememberCandidate("Boards monitor management.\n\nCreditors price risk. Evidence remains conditional.", history);
  const current = candidateHistoryFor(options);
  const feedback = {
    candidateId: record.candidate_id,
    observations: [{ detector: "GPTZero", classification: "ai", aiScore: 100, flaggedSentenceIndices: [1] }],
  };
  const profile = resolveDetectorFeedback(feedback, current);
  assert.equal(profile.verified_candidate_link, true);
  assert.equal(profile.mean_ai_score, 100);
  assert.deepEqual(profile.target_paragraph_indices, [1]);
  assert.equal(resolveDetectorFeedback({ ...feedback, candidateId: "0".repeat(24) }, current), null);
  const changedModeHistory = candidateHistoryFor({ ...options, lengthPreference: "maintain" });
  assert.equal(resolveDetectorFeedback(feedback, changedModeHistory)?.candidate_id, record.candidate_id, "the same source may change rewrite settings without losing exact-candidate feedback");
  const differentSourceHistory = candidateHistoryFor({ ...options, sourceText: "An unrelated manuscript." });
  assert.equal(resolveDetectorFeedback(feedback, differentSourceHistory), null, "feedback must not cross manuscript boundaries");
});

test("colour-coded report passages map to exact candidate sentences and paragraphs", () => {
  clearCandidateHistoryForTests();
  const history = candidateHistoryFor(options);
  const candidate = "Opening frame explains the financing question. Creditors assess reporting reliability and board oversight.\n\nEvidence remains conditional when leverage rises. The study examines that boundary.";
  const remembered = rememberCandidate(candidate, history);
  const profile = resolveDetectorFeedback({
    candidateId: remembered.candidate_id,
    observations: [{
      detector: "GPTZero",
      classification: "ai",
      aiScore: 100,
      highlightedPassages: [{ text: "Creditors assess reporting reliability and board oversight", classification: "ai", colour: "orange", page: 2 }],
    }],
  }, candidateHistoryFor(options));
  assert.equal(profile.highlighted_passage_count, 1);
  assert.equal(profile.mapped_highlight_count, 1);
  assert.deepEqual(profile.target_paragraph_indices, [0]);
  assert.equal(profile.excerpt_mappings[0].sentence_index, 1);
});

test("feedback opening audit rejects added padding around substantially unchanged opening paragraphs", () => {
  const prior = "Corporate debt is a routine source of financing. Creditors also assess board oversight. Evidence links governance to borrowing terms.\n\nThis prospectus examines board independence and debt cost. The quantitative strand estimates firm-level relationships. Interviews then explain the results.";
  const padded = "Corporate debt is a routine source of financing. Creditors also assess board oversight. Evidence links governance to borrowing terms. This question has considerable practical importance for contemporary firms.\n\nThis prospectus examines board independence and debt cost. The quantitative strand estimates firm-level relationships. Interviews then explain the results. This design provides additional interpretive depth.";
  const reconstructed = "Borrowing terms reflect more than the availability of corporate debt. Board oversight enters the creditor's assessment because it affects how confidently lenders interpret governance evidence. The financing relationship is therefore conditional.\n\nBoard independence and debt cost are examined through a sequential design. Firm-level estimates establish the relationships first; interviews with finance professionals then investigate why those results vary.";
  assert.equal(auditFeedbackRefinementChange(prior, padded).materially_reconstructed, false);
  assert.equal(auditFeedbackRefinementChange(prior, reconstructed).materially_reconstructed, true);
});

test("the exact tested candidate re-establishes its feedback identity after server-memory restart", () => {
  clearCandidateHistoryForTests();
  const history = candidateHistoryFor(options);
  const candidate = "Boards monitor management. Creditors price the resulting risk differently.";
  const remembered = rememberCandidate(candidate, history);
  const feedback = {
    candidateId: remembered.candidate_id,
    observations: [{ detector: "GPTZero", classification: "ai", aiScore: 100 }],
  };
  clearCandidateHistoryForTests();
  const rebuiltHistory = candidateHistoryFor(options);
  assert.equal(resolveDetectorFeedback(feedback, rebuiltHistory), null);
  assert.equal(resolveDetectorFeedback(feedback, rebuiltHistory, candidate)?.verified_candidate_link, true);
  assert.equal(resolveDetectorFeedback(feedback, rebuiltHistory, `${candidate} Unrelated addition.`), null);
});

test("high candidate-linked evidence becomes operational planner scope, not a passive note", () => {
  const source = Array.from({ length: 12 }, (_, index) => `Evidence sentence ${index + 1} explains how governance conditions affect creditor assessment.`).join(" ");
  const diagnostics = diagnose(source);
  const detectorFeedback = {
    version: "candidate-linked-detector-feedback-v1",
    verified_candidate_link: true,
    candidate_id: "a".repeat(24),
    observation_count: 1,
    mean_ai_score: 100,
    high_machine_pattern_signal: true,
    target_paragraph_indices: [],
    flagged_excerpts: [],
    observations: [{ detector: "GPTZero", classification: "ai", aiScore: 100 }],
  };
  const plan = buildDiagnosisScopedPlan(diagnostics, {
    rewriteIntensity: "deep",
    naturalisation: "aggressive",
    lengthPreference: "expand",
    detectorFeedback,
  });
  assert.ok(plan.externalFeedbackExecution);
  assert.ok(plan.externalFeedbackExecution.targeted_sentence_count >= Math.floor(plan.items.length * 0.55));
  assert.ok(plan.items.some((item) => item.decisionCode === "EXTERNAL_FEEDBACK_DISCOURSE_REPACKAGE"));
  assert.ok(plan.externalFeedbackExecution.opening_paragraph_indices.length >= 1);
  assert.ok(plan.externalFeedbackExecution.target_paragraph_indices.includes(plan.externalFeedbackExecution.opening_paragraph_indices[0]));
  assert.match(detectorFeedbackPromptBlock(detectorFeedback), /exact prior candidate/i);
});

test("editor sends only candidate-linked observations into the next rewrite", () => {
  const script = fs.readFileSync(new URL("../public/rewriteLineage.js", import.meta.url), "utf8");
  assert.match(script, /candidateId/);
  assert.match(script, /detectorFeedback/);
  assert.match(script, /linkedObservationsFor/);
  assert.match(script, /row\?\.candidateId === state\.candidate_id/);
  assert.match(script, /normalise\(sourceText\) !== normalise\(state\.last_revision\)/);
  assert.match(script, /body\.refinementMode === "tested_candidate"\s*\?\s*linkedObservationsFor\(body\.text\)/);
});

test("feedback-guided refinement edits the tested candidate without replacing the visible original source", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const lineage = fs.readFileSync(new URL("../public/rewriteLineage.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../public/candidateRefinementUI.js", import.meta.url), "utf8");
  assert.match(app, /refinement \? String\(options\.candidateText/);
  assert.match(app, /refinementMode: refinement \? "tested_candidate" : "source"/);
  assert.match(lineage, /MAX_FEEDBACK_REFINEMENTS = 2/);
  assert.match(lineage, /refinementPreflight\(candidateText\)/);
  assert.match(ui, /Refine this tested revision/);
  assert.match(ui, /Permanent meaning\/evidence anchor/);
  assert.doesNotMatch(ui, /sourceText[^\n]*\.value\s*=/);
});

test("detector screenshots can be read as a bounded multi-image evidence bundle", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const gateway = fs.readFileSync(new URL("../public/detectorScreenshotGateway.js", import.meta.url), "utf8");
  assert.match(html, /type="file" multiple/);
  assert.match(gateway, /MAX_FILES = 10/);
  assert.match(gateway, /Save and link this evidence bundle/);
  assert.match(gateway, /Nothing is linked until that button is pressed/);
  assert.match(gateway, /if \(!preflight\?\.exact_candidate\)/);
  assert.match(gateway, /cannot be linked because the Revised box no longer contains the exact retained candidate/);
  assert.match(gateway, /colour-coded passage\(s\) extracted/);
  assert.match(gateway, /Evidence saved for the previous revision was consumed there/);
});

test("a global 100 percent failed-candidate signal forces the first two substantive prose paragraphs into Deep scope", () => {
  const source = [
    "Corporate debt financing requires creditors to assess governance alongside accounting information. Board oversight affects how lenders interpret reporting reliability and risk transfer.",
    "The study uses a sequential mixed methods design. Quantitative estimates establish the relationships before interviews examine why the findings vary across financial conditions.",
    "Manufacturing firms provide the empirical setting because debt is embedded in long-lived assets, inventory and recurring refinancing requirements.",
  ].join("\n\n");
  const plan = buildDiagnosisScopedPlan(diagnose(source), {
    rewriteIntensity: "deep",
    naturalisation: "aggressive",
    lengthPreference: "expand",
    detectorFeedback: {
      version: "candidate-linked-detector-feedback-v2",
      verified_candidate_link: true,
      candidate_id: "c".repeat(24),
      observation_count: 1,
      mean_ai_score: 100,
      high_machine_pattern_signal: true,
      global_candidate_failure: true,
      target_paragraph_indices: [],
      flagged_excerpts: [],
      observations: [{ detector: "GPTZero", classification: "ai", aiScore: 100 }],
    },
  });
  assert.equal(plan.externalFeedbackExecution.opening_paragraph_indices.length, 2);
  for (const paragraphIndex of plan.externalFeedbackExecution.opening_paragraph_indices) {
    assert.ok(plan.externalFeedbackExecution.target_paragraph_indices.includes(paragraphIndex));
    assert.ok(plan.items.some((item) => item.paragraphBlockIndex === paragraphIndex && item.decisionCode === "EXTERNAL_FEEDBACK_DISCOURSE_REPACKAGE"));
  }
});

test("detector research omits empty style filters instead of sending rejected null values", () => {
  const researchUi = fs.readFileSync(new URL("../public/detectorResearchUI.js", import.meta.url), "utf8");
  assert.match(researchUi, /Object\.fromEntries\(Object\.entries\(/);
  assert.match(researchUi, /typeof selected === "string" && selected\.length > 0/);
  assert.match(researchUi, /academicVoice:detector-observation-saved/);
  assert.match(researchUi, /loadObservations\(\);\s*renderObservationList\(\);\s*runResearch\(\);/);
});

test("feedback refinement capacity cannot be lower than a valid expanded editor candidate", () => {
  const limits = fs.readFileSync(new URL("../server/config/limits.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(limits, /SINGLE_REFINEMENT_WORD_LIMIT = SINGLE_EDITOR_WORD_LIMIT \* 2/);
  assert.match(app, /singleRefinementWordLimit: 3000/);
});

test("Editor policy copy describes the explicit tested-candidate refinement loop without the retired absolute prohibition", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const screenshotRoute = fs.readFileSync(new URL("../server/routes/detectorScan.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /never fed automatically into generation/i);
  assert.match(app, /Feedback-guided refinement preflight can use it to refine that tested candidate/i);
  assert.match(app, /ordinary Analyse & Revise button does not silently attach candidate feedback/i);
  assert.match(screenshotRoute, /saved_candidate_link_feeds_next_rewrite_planner: true/);
  assert.match(screenshotRoute, /screenshot_read_alone_feeds_generation: false/);
});

test("screenshot extraction discloses its provider-credit cost and manual entry remains free", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /Manual score entry is free/);
  assert.match(html, /uses one language-model provider call/);
  assert.match(html, /never runs automatically/);
});

test("candidate-linked reconstruction scope generalises across governance, employee-performance and audit-market prose", () => {
  const samples = [
    "Corporate debt is a routine source of financing for U.S. businesses, yet accounting ratios alone do not determine its cost. Creditors assess board monitoring, reporting reliability and the risk transferred toward their claims. Prior studies connect those governance arrangements to ratings, yields and loan terms. The practical question concerns which board attributes retain financing relevance as firm conditions change.",
    "Employee performance concerns the efficiency and effectiveness with which employees complete assigned tasks and contribute to organisational goals. It includes output quality, speed, accuracy, adaptability and engagement. In fast-moving consumer goods firms, these dimensions affect responsiveness to changing market demand. High expectations can nevertheless create burnout and weaken longer-term retention when organisations ignore employee wellbeing.",
    "Canada provides a complementary picture of audit-firm performance. Inspection findings varied across firm categories, which makes organisational systems and professional depth analytically important. Across Europe, competition also depends on whether challenger firms can absorb more demanding engagements. Hong Kong evidence adds a technology-adoption gap, showing that market access and organisational capability need not progress together.",
  ];
  for (const source of samples) {
    const plan = buildDiagnosisScopedPlan(diagnose(source), {
      rewriteIntensity: "moderate",
      naturalisation: "aggressive",
      lengthPreference: "maintain",
      detectorFeedback: {
        version: "candidate-linked-detector-feedback-v1",
        verified_candidate_link: true,
        candidate_id: "b".repeat(24),
        observation_count: 1,
        mean_ai_score: 100,
        high_machine_pattern_signal: true,
        target_paragraph_indices: [],
        flagged_excerpts: [],
        observations: [{ detector: "External", classification: "ai", aiScore: 100 }],
      },
    });
    assert.ok(plan.externalFeedbackExecution?.targeted_sentence_count > 0);
    assert.ok((plan.summary.SENTENCE_RESTRUCTURE || 0) > 0);
  }
});
