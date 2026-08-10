import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTextStructure } from "../server/lib/textStructure.js";
import { analyseDiscourseRegularity } from "../server/lib/discourseRegularityForensics.js";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";

const regularNarrative = `Background of the Problem

Debt creates agency conflicts that differ from those of shareholders. Managers may shift risk after borrowing. Prior evidence found that stronger monitoring was associated with lower borrowing costs (Smith, 2020). These findings therefore suggest that monitoring can protect creditors.

The creditor response to governance is not uniformly favorable. Some mechanisms can protect lenders while constraining managerial discretion. Jones (2021) reported lower spreads where creditor protections were stronger. Governance mechanisms can therefore produce stakeholder-specific consequences.

Board leadership also provides mixed signals. CEO power may weaken monitoring. Brown (2022) found that powerful chief executives were associated with weaker credit outcomes. These results therefore show that leadership effects depend on creditor exposure.

The post-2015 period warrants focused analysis. Financing conditions changed materially across the period. White (2023) documented heterogeneous firm responses to monetary conditions. The period therefore provides useful variation for firm-level analysis.

Manufacturing firms provide a coherent setting for the inquiry. Their financing structures combine productive assets and recurring borrowing needs. Green (2024) reported substantial leverage variation across listed manufacturers. This setting therefore offers a useful context for examining debt costs.

Purpose Statement

The purpose of this study is to examine the relationship between governance and debt cost. The independent variables will be board independence, CEO duality, gender diversity, board size, and audit committee independence.

Research Questions and Hypotheses

Research Question 1

To what extent do the selected governance variables predict debt cost?

H01a: Board independence does not significantly predict debt cost.

H11a: Board independence significantly predicts debt cost.`;

const asymmetricNarrative = `Background of the Problem

Smith (2020) reported lower borrowing costs among firms with stronger monitoring. The result is useful, but it does not settle whether every governance mechanism is equally valuable to creditors. Risk shifting remains possible after debt is issued.

Credit conditions complicate the picture. When leverage is high, the same board arrangement can carry a different implication for lenders. Jones (2021) found this relationship only among highly leveraged firms.

A different issue appears in leadership research. Evidence on CEO power is stronger than direct evidence on CEO duality (Brown, 2022). That distinction remains important for the present study.

Manufacturing firms also differ from asset-light service businesses because borrowing is tied to inventories, productive assets, and working-capital cycles. The choice of setting is therefore not merely convenient. It narrows one source of financing heterogeneity.

The empirical gap becomes clearer only after these strands are considered together. Some findings concern bond yields, others bank-loan spreads, and still others accounting-based interest cost. No single result resolves those measurement differences.`;

test("detects repeated claim-evidence-closure choreography while excluding formal artefacts", () => {
  const structure = parseTextStructure(regularNarrative);
  const result = analyseDiscourseRegularity(regularNarrative, structure);

  assert.equal(result.available, true);
  assert.ok(result.formal_artifact_block_count >= 3);
  assert.ok(result.score >= 0.42);
  assert.ok(result.signals.some((signal) => signal.forensic_id === "repeated_claim_evidence_closure"));
  assert.ok(result.signals.some((signal) => signal.forensic_id === "uniform_tidy_closure"));
  assert.ok(result.priority_sentence_indices.length > 0);

  const formalIndices = new Set(result.formal_artifact_block_indices);
  assert.ok(result.paragraph_profiles.every((profile) => !formalIndices.has(profile.blockIndex)));
});

test("argument-governed asymmetry scores below deliberately repetitive paragraph choreography", () => {
  const regular = analyseDiscourseRegularity(regularNarrative, parseTextStructure(regularNarrative));
  const asymmetric = analyseDiscourseRegularity(asymmetricNarrative, parseTextStructure(asymmetricNarrative));

  assert.equal(asymmetric.available, true);
  assert.ok(regular.score > asymmetric.score);
  assert.ok(regular.rhetorical_asymmetry_score < asymmetric.rhetorical_asymmetry_score);
});

test("Moderate aggressive restructures forensic leverage points without creating a whole-document rewrite quota", () => {
  const diagnostics = diagnose(regularNarrative);
  const plan = buildDiagnosisScopedPlan(diagnostics, {
    rewriteIntensity: "moderate",
    naturalisation: "aggressive",
    lengthPreference: "maintain",
  });

  assert.equal(plan.forensicExecution?.mode, "targeted_sentence_flow_restructure");
  assert.ok((plan.forensicExecution?.targeted_sentence_count || 0) > 0);
  assert.ok((plan.forensicExecution?.targeted_sentence_count || 0) < plan.items.length);
  assert.ok(plan.items.some((item) => item.decisionCode === "FORENSIC_SENTENCE_FLOW_RESTRUCTURE"));
  assert.ok(plan.items.some((item) => item.level === "KEEP" || item.level === "MICRO_EDIT"));
});

test("Deep authorial uses diagnosed forensic scope rather than universal discourse repackaging", () => {
  const diagnostics = diagnose(regularNarrative);
  const plan = buildDiagnosisScopedPlan(diagnostics, {
    rewriteIntensity: "deep",
    naturalisation: "authorial",
    lengthPreference: "maintain",
  });

  assert.equal(plan.forensicExecution?.mode, "targeted_discourse_repackage");
  assert.ok((plan.forensicExecution?.targeted_sentence_count || 0) > 0);
  assert.ok((plan.forensicExecution?.targeted_sentence_count || 0) < plan.items.length);
  assert.ok(plan.items.some((item) => item.decisionCode === "FORENSIC_DISCOURSE_SCOPE"));
});
