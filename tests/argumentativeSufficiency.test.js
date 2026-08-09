import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { assessArgumentativeSufficiency } from "../server/lib/argumentativeSufficiency.js";
import { buildInterventionPlan } from "../server/lib/planner.js";
import { deriveInterventionAuthority } from "../server/lib/interventionAuthority.js";

const compressedLiterature = [
  "Board gender diversity has been examined in relation to debt financing. Benjamin and Biswas (2019) found no overall relationship between female board representation and cost of debt, but the result changed when CEO duality was considered. Bradley and Chen (2015) found that board independence reduced debt cost under favourable credit conditions or lower leverage but had the opposite effect when credit conditions were poor or leverage was high. Anderson et al. (2004) reported lower debt costs with stronger board monitoring, while Liu and Jiraporn (2010) linked greater CEO power with higher bond yields.",
  "Studies have also used credit ratings, bond yields, bank-loan spreads, and accounting-based cost of debt as measures of creditor response. These measures are related to corporate borrowing, but the literature often moves between them when discussing governance effects (Bhojraj & Sengupta, 2003; Francis et al., 2012).",
].join("\n\n");

test("argumentative sufficiency detects evidence compression without using word growth as a target", () => {
  const result = assessArgumentativeSufficiency(compressedLiterature);
  assert.equal(result.available, true);
  assert.ok(["moderate", "high"].includes(result.development_need));
  assert.ok(result.signals.some((signal) => signal.id === "evidence_compression"));
  assert.match(result.guardrail, /word-count growth.*never a target/i);
});

test("Moderate can preserve texture while permitting selective scholarly development", () => {
  const diagnostics = diagnose(compressedLiterature);
  const plan = buildInterventionPlan(diagnostics, {
    rewriteIntensity: "moderate",
    lengthPreference: "auto",
    naturalisation: "faithful",
  });
  assert.equal(plan.plannerVersion, "intent-discourse-v4");
  assert.equal(plan.intent.effective, "context_scholarly_strengthening");
  assert.ok(plan.paragraphPlan.some((row) => row.actions.includes("DEVELOP_EVIDENCE") || row.actions.includes("DISTINGUISH_MEASURES")));
  assert.ok(plan.items.some((item) => item.decisionCode === "SELECTIVE_ARGUMENT_DEVELOPMENT"));
});

test("intervention authority separates surface preservation from development permission", () => {
  const authority = deriveInterventionAuthority({
    planSummary: {
      KEEP: 8,
      MICRO_EDIT: 10,
      CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT: 4,
      SENTENCE_RESTRUCTURE: 2,
    },
    authorialTexture: { preservation_priority: "high" },
    requestedIntensity: "moderate",
    requestedNaturalisation: "faithful",
    effectiveIntent: "context_scholarly_strengthening",
  });
  assert.equal(authority.surface_preservation_required, true);
  assert.equal(authority.discourse_development_permission, "selective_paragraph_development_without_resequence");
  assert.equal(authority.depth_permission, "selective_development_where_diagnosed");
  assert.ok(authority.max_changed_sentence_ratio > 0.6);
  assert.match(authority.rule, /word-count growth is never a target/i);
});
