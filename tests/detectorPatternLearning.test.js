import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyseDiscourseArchitecture } from "../server/lib/discourseArchitecture.js";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";
import { normaliseDetectorScreenshotAnalysis } from "../server/lib/detectorScreenshot.js";
import { candidateHistoryFor, clearCandidateHistoryForTests, rememberCandidate } from "../server/lib/candidateHistory.js";
import { detectorFeedbackPromptBlock, resolveDetectorFeedback } from "../server/lib/detectorFeedback.js";

const triadicSample = [
  "Creditors judge whether management is monitored reliably, financial reports can be trusted, and the board constrains or permits risk taking that could weaken creditor protection.",
  "Once financing has been provided, decisions can increase creditor risk through three channels: additional leverage, riskier investment policies, or distributions that reduce resources available to satisfy debt claims.",
  "Prior evidence associates lower debt costs with board independence, board size and fully independent audit committees.",
  "Greater CEO power has been associated with lower credit ratings, higher bond yields and more opaque information environments, yet direct evidence remains limited.",
  "The window spans different financing environments: low-rate years, pandemic disruption, and subsequent monetary tightening.",
  "The index provides a defined large-, mid- and small-cap frame covering the market.",
  "That uncertainty can weaken governance-resource allocation, debt negotiation and credit-risk assessment.",
  "The relationship is not merely statistical, but also institutional.",
].join(" ");

test("ordinary three-part constructions are diagnosed by recurrence rather than only First-Second-Third wording", () => {
  const architecture = analyseDiscourseArchitecture(triadicSample);
  assert.equal(architecture.metrics.triadic_enumeration_count, 7);
  const signal = architecture.signals.find((row) => row.id === "triadic_enumeration_saturation");
  assert.equal(signal?.severity, "high");
  assert.equal(signal?.sentenceIndices.length, 7);
});

test("triadic saturation enters paragraph reconstruction while preserving fixed lists", () => {
  const plan = buildDiagnosisScopedPlan(diagnose(triadicSample), {
    rewriteIntensity: "deep",
    naturalisation: "authorial",
    lengthPreference: "maintain",
  });
  assert.ok(plan.documentGuidance.some((line) => /triadic_enumeration_saturation/.test(line)));
  assert.ok(plan.documentGuidance.some((line) => /fixed taxonomies.*formal construct lists/i.test(line)));
  assert.ok(plan.paragraphPlan.some((row) => row.actions.includes("REBUILD_DISCOURSE")));
});

test("detector pattern cards retain labels, counts, likelihood text and instances", () => {
  const observation = normaliseDetectorScreenshotAnalysis(JSON.stringify({
    detector: "GPTZero",
    classification: "ai",
    aiScore: 100,
    flaggedSentenceIndices: [],
    flaggedExcerpts: [],
    highlightedPassages: [],
    patternFindings: [
      {
        label: "Everything in threes",
        description: "Groups ideas in tidy sets of three to sound complete.",
        reportedCount: 7,
        likelihoodText: "1.6x more likely used by AI",
        instances: [{ text: "board independence, board size and fully independent audit committees", page: 3 }],
      },
      {
        label: "Not just X, but Y",
        description: "Uses a balanced contrast.",
        reportedCount: 1,
        likelihoodText: "1.6x more likely used by AI",
        instances: [{ text: "not merely statistical, but also institutional", page: 4 }],
      },
    ],
    visibleSummary: "Eight explainable pattern instances were reported.",
    confidence: "high",
    warnings: [],
  }));
  assert.equal(observation.patternFindings.length, 2);
  assert.equal(observation.patternFindings[0].reportedCount, 7);
  assert.equal(observation.patternFindings[0].instances.length, 1);
});

test("candidate-linked pattern evidence maps instances and reaches the reconstruction contract", () => {
  clearCandidateHistoryForTests();
  const options = {
    sourceText: triadicSample,
    rewriteIntensity: "deep",
    naturalisation: "authorial",
    lengthPreference: "maintain",
  };
  const history = candidateHistoryFor(options);
  const remembered = rememberCandidate(triadicSample, history);
  const profile = resolveDetectorFeedback({
    candidateId: remembered.candidate_id,
    observations: [{
      detector: "GPTZero",
      classification: "ai",
      aiScore: 100,
      patternFindings: [{
        label: "Everything in threes",
        description: "Groups ideas in tidy sets of three to sound complete.",
        reportedCount: 7,
        likelihoodText: "1.6x more likely used by AI",
        instances: [{ text: "debt negotiation and credit-risk assessment", page: 3 }],
      }],
    }, {
      detector: "GPTZero",
      classification: "ai",
      aiScore: 100,
      patternFindings: [{
        label: "Everything in threes",
        reportedCount: 7,
        instances: [{ text: "board independence, board size and fully independent audit committees", page: 4 }],
      }],
    }],
  }, candidateHistoryFor(options));
  assert.equal(profile.reported_pattern_count, 1);
  assert.equal(profile.reported_pattern_instance_count, 7);
  assert.equal(profile.mapped_highlight_count, 2);
  assert.match(detectorFeedbackPromptBlock(profile), /Everything in threes: 7 reported instance/i);
  assert.match(detectorFeedbackPromptBlock(profile), /Respond to recurrence.*mere existence/i);
});

test("four-item lists and two-part cited comparisons are not mislabeled as triads", () => {
  const control = [
    "Manufacturing firms differ in leverage, profitability, liquidity and growth opportunities.",
    "Federal Reserve data show debt of $13.68 trillion, while interest payments reached $639.36 billion (Board of Governors, n.d.-a, n.d.-b).",
    "Lenders may adjust spreads, collateral, covenants, maturities or availability.",
  ].join(" ");
  assert.equal(analyseDiscourseArchitecture(control).metrics.triadic_enumeration_count, 0);
});

test("browser gateway persists and displays named detector patterns", () => {
  const gateway = fs.readFileSync(new URL("../public/detectorScreenshotGateway.js", import.meta.url), "utf8");
  const research = fs.readFileSync(new URL("../public/detectorResearchUI.js", import.meta.url), "utf8");
  assert.match(gateway, /patternFindings/);
  assert.match(gateway, /named writing pattern\(s\) extracted/);
  assert.match(research, /Reported writing-pattern instances/);
});
