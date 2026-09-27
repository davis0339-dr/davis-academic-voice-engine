import { test } from "node:test";
import assert from "node:assert/strict";
import { HUMAN_DISCOURSE_PROFILES, HUMAN_DISCOURSE_MOVES } from "../server/data/humanDiscourseProfiles.js";
import { inferRhetoricalJob, selectHumanDiscourseGuidance } from "../server/lib/humanDiscourseRetrieval.js";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildInterventionPlan } from "../server/lib/planner.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";
import { buildSystemPrompt } from "../server/lib/promptContract.js";
import { extractProtectedSpans } from "../server/lib/protect.js";
import { buildRhetoricalLedger } from "../server/lib/rhetoricalPreservation.js";

const multiSectionText = `Introduction

Corporate governance is important to the financing decisions of manufacturing firms. Previous studies report different relationships between board independence and debt costs, but direct evidence for the selected firms remains limited.

Methodology

The study will use panel regression because the observations cover several firms over multiple years. Firm size, leverage and profitability will be included as controls.

Results and Discussion

The findings indicate a negative association between board independence and borrowing cost. One possible explanation is that creditors interpret independent oversight as a constraint on managerial risk-taking, although this interpretation does not establish causality.`;

test("the operational human discourse corpus contains three distinct thesis profiles", () => {
  assert.deepEqual(HUMAN_DISCOURSE_PROFILES.map((profile) => profile.id), [
    "adeoye-2013",
    "abdulkarim-2012",
    "rugangira-2012",
  ]);
  assert.ok(HUMAN_DISCOURSE_MOVES.length >= 12);
  assert.ok(HUMAN_DISCOURSE_MOVES.every((move) => move.instruction && move.caution && move.evidencePages.length));
});

test("rhetorical jobs are inferred from paragraph work rather than sentence length", () => {
  assert.equal(inferRhetoricalJob("Employee performance refers to the work completed by employees."), "definition");
  assert.equal(inferRhetoricalJob("The coefficient was statistically significant and supported H2."), "results");
  assert.equal(inferRhetoricalJob("One possible explanation may be the monitoring role of lenders."), "discussion");
});

test("retrieval assigns section-appropriate moves and retains all three profile identities", () => {
  const diagnostics = diagnose(multiSectionText);
  const paragraphPlan = buildInterventionPlan(diagnostics, {
    rewriteIntensity: "deep",
    lengthPreference: "expand",
    naturalisation: "faithful",
  }).paragraphPlan;
  const evidence = selectHumanDiscourseGuidance(diagnostics, paragraphPlan);
  assert.equal(evidence.profileIds.length, 3);
  assert.ok(evidence.paragraphAssignments.some((row) => row.rhetoricalJob === "methodology"));
  assert.ok(evidence.paragraphAssignments.some((row) => ["results", "discussion"].includes(row.rhetoricalJob)));
  assert.ok(evidence.selectedMoves.some((move) => move.profileId === "abdulkarim-2012"));
  assert.ok(evidence.selectedMoves.some((move) => move.profileId === "rugangira-2012"));
});

test("final generation prompt receives operational thesis moves and anti-imitation filters", () => {
  const diagnostics = diagnose(multiSectionText);
  const plan = buildDiagnosisScopedPlan(diagnostics, {
    rewriteIntensity: "deep",
    lengthPreference: "expand",
    naturalisation: "authorial",
  });
  const prompt = buildSystemPrompt({
    sourceText: multiSectionText,
    styleProfile: { label: "test", evidence: {} },
    protectedSpans: extractProtectedSpans(multiSectionText),
    plan,
    grammarIntensity: "standard",
    lengthPreference: "expand",
    rhetoricalLedger: buildRhetoricalLedger(multiSectionText),
    humanCadence: null,
    naturalisation: "aggressive",
    revisionPurpose: "fidelity",
  });
  assert.match(prompt, /THREE-THESIS HUMAN DISCOURSE EVIDENCE/);
  assert.match(prompt, /adeoye-2013/);
  assert.match(prompt, /abdulkarim-2012/);
  assert.match(prompt, /rugangira-2012/);
  assert.match(prompt, /reasoning moves, never phrase imitation/i);
  assert.match(prompt, /source phraseology, sentence boundaries and paragraph choreography may be replaced/i);
});
