import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseHumanDiscourse } from "../server/lib/humanDiscourse.js";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildInterventionPlan } from "../server/lib/planner.js";
import { TEXTURE_EXEMPLARS, texturePromptBlock } from "../server/data/textureExemplars.js";

const isolated = `Audit markets are highly concentrated. Large networks dominate premium engagements. Technology investment is expensive. Smaller firms face recruitment difficulties. Client expectations continue to rise. Regulation is becoming more demanding. Digital tools are increasingly important. Indigenous firms compete under difficult conditions.`;

const repeatedParagraphLogic = `Anderson et al. (2004) found that stronger boards were associated with lower debt cost. This evidence suggests that monitoring quality matters to creditors. However, the relationship may depend on leverage.

Francis et al. (2012) found that independent boards were associated with favourable loan terms. This evidence suggests that monitoring quality matters to creditors. However, the relationship may depend on borrower risk.

Fields et al. (2012) found that higher-quality boards were associated with cheaper bank borrowing. This evidence suggests that monitoring quality matters to creditors. However, the relationship may depend on credit conditions.

Bradley and Chen (2015) found that independence could increase debt cost under adverse conditions. This evidence suggests that monitoring quality matters to creditors. However, the relationship may depend on the financing environment.`;

const evidenceStack = `Prior research reports several creditor responses to governance. Anderson et al. (2004) found that board independence was associated with lower debt cost. Francis et al. (2012) reported more favourable loan pricing for firms with stronger boards. Fields et al. (2012) found that higher-quality boards borrowed at lower rates. Bradley and Chen (2015) documented conditional effects of independence under different credit conditions. The combined evidence therefore points to a lender response that is meaningful but not uniform across financing environments.`;

test("qualitative discourse analysis can detect isolated proposition texture", () => {
  const result = analyseHumanDiscourse(isolated);
  assert.ok(result.metrics.adjacent_pair_count >= 6);
  assert.ok(result.signals.some((signal) => signal.issue === "isolated_proposition_texture"));
});

test("qualitative discourse analysis detects repeated paragraph development logic", () => {
  const result = analyseHumanDiscourse(repeatedParagraphLogic);
  assert.ok(result.signals.some((signal) => signal.issue === "repeated_paragraph_logic"));
  assert.ok(result.signals.some((signal) => signal.issue === "generic_evidence_interpretation_bridge"));
});

test("qualitative discourse analysis detects long evidence stacking", () => {
  const result = analyseHumanDiscourse(evidenceStack);
  assert.ok(result.metrics.max_consecutive_evidence_sentences >= 4);
  assert.ok(result.signals.some((signal) => signal.issue === "evidence_stacking"));
});

test("qualitative discourse signals reach the intervention planner as document guidance", () => {
  const diagnostics = diagnose(repeatedParagraphLogic);
  const plan = buildInterventionPlan(diagnostics, {
    rewriteIntensity: "deep",
    lengthPreference: "auto",
    naturalisation: "aggressive",
  });
  assert.ok(plan.qualitativeDiscourseSignalCount >= 1);
  assert.ok(plan.documentGuidance.some((item) => item.includes("templated") || item.includes("evidence")));
});

test("single detector-selected texture exemplar remains retired while general authorial guidance is permitted", () => {
  assert.equal(TEXTURE_EXEMPLARS.length, 0);
  const guidance = texturePromptBlock();
  assert.match(guidance, /AUTHORIAL RECONSTRUCTION GUIDANCE/i);
  assert.match(guidance, /first two prose paragraphs/i);
  assert.match(guidance, /Do not optimise for any third-party authorship classifier/i);
  assert.ok(!guidance.includes("TEXTURE EXEMPLAR"));
});
