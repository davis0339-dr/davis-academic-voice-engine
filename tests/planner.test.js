import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildInterventionPlan, LEVELS } from "../server/lib/planner.js";

const formulaicText =
  "It is important to note that the firm performed well. Furthermore, the firm performed well. Moreover, the firm performed well. Additionally, the firm performed well.";

const cleanTechnicalText =
  "The sample included 214 UK-listed firms between 2010 and 2019. Regression results indicate a significant positive association between board independence and disclosure quality (β = 0.31, p < 0.05).";

test("minor intensity only issues MICRO_EDIT or KEEP, never restructures", () => {
  const plan = buildInterventionPlan(diagnose(formulaicText), { rewriteIntensity: "minor", lengthPreference: "auto" });
  const levels = new Set(plan.items.map((i) => i.level));
  assert.ok(![...levels].includes(LEVELS.SENTENCE_RESTRUCTURE));
});

test("deep and auto intensity differ from minor on the same flagged passage", () => {
  const minorPlan = buildInterventionPlan(diagnose(formulaicText), { rewriteIntensity: "minor", lengthPreference: "auto" });
  const deepPlan = buildInterventionPlan(diagnose(formulaicText), { rewriteIntensity: "deep", lengthPreference: "auto" });
  assert.notDeepEqual(
    minorPlan.items.map((i) => i.level),
    deepPlan.items.map((i) => i.level)
  );
});

test("clean, technical, citation-and-number-heavy prose is mostly left as KEEP", () => {
  const plan = buildInterventionPlan(diagnose(cleanTechnicalText), { rewriteIntensity: "auto", lengthPreference: "auto" });
  assert.ok(plan.items.every((i) => i.level === LEVELS.KEEP));
});

test("an overloaded sentence is planned for SPLIT_OR_MERGE regardless of intensity", () => {
  const overloaded =
    "The study examines the relationship between corporate governance mechanisms, including board independence, audit committee expertise, ownership concentration, and CEO duality, and firm-level disclosure quality across a large sample of UK-listed companies over a ten-year period from 2010 to 2019 using panel regression techniques.";
  const plan = buildInterventionPlan(diagnose(overloaded), { rewriteIntensity: "minor", lengthPreference: "auto" });
  assert.equal(plan.items[0].level, LEVELS.SPLIT_OR_MERGE);
});
