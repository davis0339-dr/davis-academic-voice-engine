import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences } from "../server/lib/sentences.js";
import { parseTextStructure } from "../server/lib/textStructure.js";
import { analyseDiscourseArchitecture } from "../server/lib/discourseArchitecture.js";
import { diagnose } from "../server/lib/diagnostics.js";
import {
  buildInterventionPlan,
  INTERVENTION_INTENTS,
  KEEP_CLASSES,
  PARAGRAPH_ACTIONS,
  PLANNER_SEQUENCE,
  LEVELS,
} from "../server/lib/planner.js";

const aiOrganisedStressText = `Three principal findings emerge from the analysis. First, brand status appears to matter. Second, the fee result weakens after scale controls. Third, tenure contributes little incremental information.

Three contributions follow from this evidence. First, the audit-quality construct should be decomposed. Second, fee-based inference should control rigorously for scale. Third, tenure should not be treated as automatically informative.

Three theoretical pillars organise the explanation. First, agency theory supplies the monitoring logic. Second, signalling theory explains the value of visible reputation. Third, legitimacy theory explains why disclosure incentives become salient.

Three policy implications follow. First, disclosure rules should consider verification capacity. Second, smaller assurance providers need stronger capability. Third, boards should understand that auditor choice can become part of the transparency signal.`;

test("numbered list markers remain attached to their semantic item", () => {
  const text = "The engine needs several treatment paths: 1. Preserve and polish. 2. Improve clarity and flow. 3. Strengthen context and scholarly substance.";
  const sentences = splitSentences(text);
  assert.equal(sentences.length, 3);
  assert.match(sentences[0], /1\. Preserve and polish\.$/);
  assert.equal(sentences[1], "2. Improve clarity and flow.");
  assert.equal(sentences[2], "3. Strengthen context and scholarly substance.");
  assert.ok(!sentences.includes("2."));
  assert.ok(!sentences.includes("3."));
});

test("blank-line heading boundaries do not fuse a heading into the first list item", () => {
  const sentences = splitSentences("Treatment paths:\n\n1. Preserve and polish.\n2. Improve clarity and flow.");
  assert.equal(sentences[0], "Treatment paths:");
  assert.equal(sentences[1], "1. Preserve and polish.");
  assert.equal(sentences[2], "2. Improve clarity and flow.");
});

test("semantic structure recognises pasted single-line-break numbered lists", () => {
  const structure = parseTextStructure("Treatment paths:\n\n1. Preserve and polish.\n2. Improve clarity and flow.\n3. Rebuild discourse when necessary.");
  const listItems = structure.blocks.filter((block) => block.type === "list_item");
  assert.equal(listItems.length, 3);
  assert.ok(listItems.every((item) => item.sentenceCount === 1));
});

test("a paragraph that opens with a quotation is not misclassified as a standalone quotation", () => {
  const structure = parseTextStructure('“Audit quality matters,” the author argues, before relating the point to reporting incentives and firm visibility in the local market.');
  assert.equal(structure.blocks.length, 1);
  assert.equal(structure.blocks[0].type, "paragraph");
});

test("a true standalone quotation remains a protected quotation block", () => {
  const structure = parseTextStructure('“Audit quality is not one thing.”');
  assert.equal(structure.blocks[0].type, "quotation");
});

test("discourse architecture detects repeated conceptual packaging and enumeration", () => {
  const architecture = analyseDiscourseArchitecture(aiOrganisedStressText);
  const ids = new Set(architecture.signals.map((signal) => signal.id));
  assert.ok(ids.has("argument_packaging"));
  assert.ok(ids.has("enumeration_saturation"));
  assert.ok(architecture.metrics.packaging_phrase_count >= 3);
  assert.ok(architecture.metrics.enumeration_opening_count >= 8);
});

test("auto mode recommends discourse reconstruction when global architecture is strongly patterned", () => {
  const plan = buildInterventionPlan(diagnose(aiOrganisedStressText), {
    rewriteIntensity: "auto",
    lengthPreference: "maintain",
    naturalisation: "faithful",
  });
  assert.equal(plan.plannerVersion, "intent-discourse-v3");
  assert.deepEqual(plan.sequence, [...PLANNER_SEQUENCE]);
  assert.equal(plan.intent.recommended, INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION);
  assert.equal(plan.intent.effective, INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION);
  assert.ok(plan.discourseArchitectureSignalCount >= 2);
  assert.ok(plan.items.filter((item) => item.level === LEVELS.DISCOURSE_REPACKAGE).length >= 8);
  assert.ok(plan.items.some((item) => item.decisionCode === "DISCOURSE_SCOPE"));
  assert.ok(plan.paragraphPlan.some((item) =>
    item.actions.includes(PARAGRAPH_ACTIONS.REDUCE_SIGNPOSTING) ||
    item.actions.includes(PARAGRAPH_ACTIONS.REBUILD_DISCOURSE)
  ));
});

test("KEEP now records why technically clean evidence is being preserved", () => {
  const technical = "The sample included 214 UK-listed firms between 2010 and 2019. Regression results indicate a significant positive association between board independence and disclosure quality (β = 0.31, p < 0.05).";
  const plan = buildInterventionPlan(diagnose(technical), {
    rewriteIntensity: "auto",
    lengthPreference: "maintain",
    naturalisation: "faithful",
  });
  assert.ok(plan.items.every((item) => item.level === LEVELS.KEEP));
  assert.ok(plan.items.every((item) => item.preservationClass === KEEP_CLASSES.KEEP_EVIDENCE));
  assert.ok(plan.items.every((item) => item.decisionCode === KEEP_CLASSES.KEEP_EVIDENCE));
});

test("deep aggressive mode gives paragraph rebuild scope without turning that scope into a sentence quota", () => {
  const text = "The discussion develops a coherent explanation of the financing issue while retaining the distinctions that matter for interpretation. The supporting propositions are already expressed in clear academic language and do not contain a local grammatical defect. The paragraph therefore provides a useful case for testing whether deep permission is represented as discourse scope rather than compulsory sentence replacement.";
  const plan = buildInterventionPlan(diagnose(text), {
    rewriteIntensity: "deep",
    lengthPreference: "maintain",
    naturalisation: "aggressive",
  });
  const keepCount = plan.items.filter((item) => item.level === LEVELS.KEEP).length;
  const discourseScopeCount = plan.items.filter((item) => item.level === LEVELS.DISCOURSE_REPACKAGE).length;
  assert.equal(plan.intent.effective, INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION);
  assert.equal(keepCount, 0);
  assert.ok(discourseScopeCount > 0);
  assert.ok(plan.paragraphPlan.some((item) => item.actions.includes(PARAGRAPH_ACTIONS.REBUILD_DISCOURSE)));
});
