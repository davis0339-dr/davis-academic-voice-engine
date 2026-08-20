import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assessSourceBeforeRewrite } from "../server/lib/sourceAssessment.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";
import { analyse } from "../server/lib/pipeline.js";

const aiBenchmark = fs.readFileSync(new URL("./fixtures/detector-benchmark/ai-sample-01-ridwan-salaudeen.txt", import.meta.url), "utf8");
const humanBenchmark = fs.readFileSync(new URL("./fixtures/detector-benchmark/human-sample-01-corporate-governance.txt", import.meta.url), "utf8");
const machineDraft = fs.readFileSync(new URL("./fixtures/collaborative-revision/corporate-governance-cost-of-debt-machine-draft.txt", import.meta.url), "utf8");

test("corroborated machine-pattern layers classify the AI benchmark as high pressure without calling it authorship probability", () => {
  const assessment = assessSourceBeforeRewrite({ text: aiBenchmark, styleFilters: {} });
  const regularity = assessment.authorial_texture.machine_pattern_regularity;
  assert.equal(regularity.label, "high");
  assert.ok(regularity.score >= 0.66);
  assert.equal(regularity.confidence, "high");
  assert.ok(regularity.components.modern_machine_language_pressure >= 0.34);
  assert.ok(regularity.components.cross_paragraph_forensic_regularisation >= 0.34);
  assert.match(regularity.note, /not the probability that AI wrote/i);
});

test("the human benchmark remains low pressure and separated from the AI benchmark", () => {
  const ai = assessSourceBeforeRewrite({ text: aiBenchmark, styleFilters: {} }).authorial_texture.machine_pattern_regularity;
  const human = assessSourceBeforeRewrite({ text: humanBenchmark, styleFilters: {} }).authorial_texture.machine_pattern_regularity;
  assert.equal(human.label, "low");
  assert.ok(ai.score >= human.score + 0.30, `expected useful separation; ai=${ai.score}, human=${human.score}`);
});

test("machine-language targets materially enlarge Moderate and Deep assertive execution scope", () => {
  const diagnostics = assessSourceBeforeRewrite({ text: machineDraft, styleFilters: {} }).diagnostics;
  const moderate = buildDiagnosisScopedPlan(diagnostics, {
    rewriteIntensity: "moderate",
    naturalisation: "aggressive",
    lengthPreference: "maintain",
  });
  const deep = buildDiagnosisScopedPlan(diagnostics, {
    rewriteIntensity: "deep",
    naturalisation: "authorial",
    lengthPreference: "maintain",
  });
  assert.ok(moderate.machineLanguageExecution?.targeted_sentence_count >= 12);
  assert.ok((moderate.summary?.SENTENCE_RESTRUCTURE || 0) >= moderate.machineLanguageExecution.targeted_sentence_count);
  assert.ok(deep.machineLanguageExecution?.targeted_sentence_count >= 12);
  assert.ok((deep.summary?.DISCOURSE_REPACKAGE || 0) >= deep.machineLanguageExecution.targeted_sentence_count);
});

test("assertive mode does not manufacture machine-language scope for the human benchmark", () => {
  const diagnostics = assessSourceBeforeRewrite({ text: humanBenchmark, styleFilters: {} }).diagnostics;
  const plan = buildDiagnosisScopedPlan(diagnostics, {
    rewriteIntensity: "moderate",
    naturalisation: "aggressive",
    lengthPreference: "maintain",
  });
  assert.equal(plan.machineLanguageExecution, undefined);
});

test("the interface names the measure as pressure and explicitly rejects an AI-probability reading", () => {
  const ui = fs.readFileSync(new URL("../public/authorialTextureUI.js", import.meta.url), "utf8");
  const plannerUi = fs.readFileSync(new URL("../public/plannerObservability.js", import.meta.url), "utf8");
  assert.match(ui, /Machine-pattern pressure/);
  assert.match(ui, /not the percentage probability that AI wrote the text/);
  assert.match(ui, /index.*\/100/);
  assert.match(plannerUi, /Machine-language target units/);
  assert.match(plannerUi, /recurrence-based style evidence, not an authorship probability/);
});

test("the public analysis payload retains the machine-language evidence used by the planner", () => {
  const result = analyse({
    sourceText: machineDraft,
    styleFilters: {},
    rewriteIntensity: "moderate",
    grammarIntensity: "standard",
    lengthPreference: "maintain",
    naturalisation: "aggressive",
  });
  assert.equal(result.diagnostics.machine_language_forensics?.available, true);
  assert.ok(result.diagnostics.machine_language_forensics.metrics?.hit_sentence_count > 0);
  assert.ok(result.plan.machineLanguageExecution?.targeted_sentence_count > 0);
});
