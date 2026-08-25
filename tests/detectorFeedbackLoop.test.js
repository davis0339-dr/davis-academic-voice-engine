import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { candidateHistoryFor, clearCandidateHistoryForTests, rememberCandidate } from "../server/lib/candidateHistory.js";
import { detectorFeedbackPromptBlock, resolveDetectorFeedback } from "../server/lib/detectorFeedback.js";
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
  assert.match(detectorFeedbackPromptBlock(detectorFeedback), /exact prior candidate/i);
});

test("editor sends only candidate-linked observations into the next rewrite", () => {
  const script = fs.readFileSync(new URL("../public/rewriteLineage.js", import.meta.url), "utf8");
  assert.match(script, /candidateId/);
  assert.match(script, /detectorFeedback/);
  assert.match(script, /linkedObservationsFor/);
  assert.match(script, /row\?\.candidateId === state\.candidate_id/);
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
