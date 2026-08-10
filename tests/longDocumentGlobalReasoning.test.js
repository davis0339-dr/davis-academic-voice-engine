import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";
import { buildDocumentMap } from "../server/lib/documentMap.js";
import {
  buildFallbackBlueprint,
  deriveLongDocumentChunkPolicy,
  auditTransformationCoverage,
  auditWholeDocumentRegularity,
} from "../server/lib/longDocumentIntelligence.js";

const cleanAcademic = [
  "Corporate borrowing remains an important financing source for manufacturing firms. Creditors assess leverage and profitability, but they also consider the reliability of reporting and the quality of board oversight.",
  "The present study examines selected board characteristics and annual debt cost among U.S.-listed manufacturing firms. The design uses firm-year observations and a follow-up qualitative phase to interpret the quantitative patterns.",
].join("\n\n");

const patternedAcademic = [
  "Three principal findings emerge from the analysis. First, governance appears relevant. Second, the relationship varies by leverage. Third, creditor responses differ across conditions.",
  "Three practical implications follow from the evidence. First, boards should not assume one universal effect. Second, lenders may interpret the same mechanism differently. Third, financing context remains important.",
  "Three theoretical points organise the explanation. First, agency conflict affects creditor risk. Second, information asymmetry affects pricing. Third, governance signals can be conditional.",
  "Three conclusions therefore follow from the discussion. First, the evidence is mixed. Second, the mechanisms are context dependent. Third, further integrated analysis is warranted.",
].join("\n\n");

test("Deep Aggressive/Authorial supplies structural authority without manufacturing a rebuild on clean prose", () => {
  const plan = buildDiagnosisScopedPlan(diagnose(cleanAcademic), {
    rewriteIntensity: "deep",
    lengthPreference: "expand",
    naturalisation: "aggressive",
  });
  assert.equal(plan.scopePolicyVersion, "diagnosis-guided-authority-v3");
  assert.equal(plan.diagnosticIntensity, "deep");
  assert.equal(plan.authorialAuthorityActive, true);
  assert.ok(plan.scopePrinciples.some((rule) => /researcher-selected mode supplies the intervention authority/i.test(rule)));
  assert.ok(plan.scopePrinciples.some((rule) => /CAN_CHANGE and SHOULD_CHANGE are separate decisions/i.test(rule)));
  assert.ok(!(plan.paragraphPlan || []).every((item) => (item.actions || []).includes("REBUILD_DISCOURSE")));
});

test("Long Document does not silently downgrade Deep + Aggressive on a locally clean substantive chunk", () => {
  const policy = deriveLongDocumentChunkPolicy({
    sourceText: cleanAcademic,
    requestedIntensity: "deep",
    requestedNaturalisation: "aggressive",
    requestedLengthPreference: "expand",
  });
  assert.equal(policy.requested.naturalisation, "aggressive");
  assert.equal(policy.effective.naturalisation, "aggressive");
  assert.equal(policy.effective.lengthPreference, "maintain");
  assert.equal(policy.authorial_authority, true);
  assert.equal(policy.aggressive_authorised, true);
  assert.equal(policy.expansion_authorised, false);
});

test("Minor still blocks aggressive treatment from becoming hidden deep reconstruction", () => {
  const policy = deriveLongDocumentChunkPolicy({
    sourceText: patternedAcademic,
    requestedIntensity: "minor",
    requestedNaturalisation: "aggressive",
    requestedLengthPreference: "maintain",
  });
  assert.equal(policy.effective.intensity, "minor");
  assert.equal(policy.effective.naturalisation, "faithful");
  assert.equal(policy.authorial_authority, false);
  assert.equal(policy.aggressive_authorised, false);
});

test("Long Document uses Deep Aggressive when a deep diagnosis also exists", () => {
  const policy = deriveLongDocumentChunkPolicy({
    sourceText: patternedAcademic,
    requestedIntensity: "deep",
    requestedNaturalisation: "aggressive",
    requestedLengthPreference: "maintain",
  });
  assert.equal(policy.diagnostic_intent, "discourse_reconstruction");
  assert.equal(policy.effective.naturalisation, "aggressive");
  assert.equal(policy.aggressive_authorised, true);
});

test("fallback whole-document blueprint maps the intellectual arc before chunk revision", () => {
  const text = [
    "Study Title",
    "Introduction",
    "Corporate debt is an important source of financing for listed manufacturers.",
    "Background of the Problem",
    "Governance evidence is mixed across debt markets and institutional settings.",
    "Problem Statement",
    "Decision-makers lack integrated contemporary evidence on which board mechanisms are associated with lower debt cost.",
    "Purpose Statement",
    "The purpose of this study is to examine and explain those relationships.",
  ].join("\n\n");
  const map = buildDocumentMap(text);
  const blueprint = buildFallbackBlueprint(text, map);
  assert.ok(blueprint.sections.length >= 3);
  assert.ok(blueprint.intellectual_arc.length >= 2);
  assert.ok(blueprint.global_constraints.some((rule) => /evidence|citation|meaning/i.test(rule)));
});

test("Deep Authorial transformation coverage rejects an 85% exact-retention pattern", () => {
  const sourceSentences = Array.from({ length: 20 }, (_, i) => `Source sentence ${i + 1} explains governance mechanism ${i + 1} in the firm.`);
  const source = sourceSentences.join(" ");
  const revised = sourceSentences.map((sentence, i) => i < 17 ? sentence : `Reconstructed argument ${i + 1} changes the information architecture materially.`).join(" ");
  const result = auditTransformationCoverage({
    sourceText: source,
    revisedText: revised,
    intensity: "deep",
    naturalisation: "authorial",
  });
  assert.equal(result.blocking, true);
  assert.ok(result.exact_retention_ratio >= 0.8);
});

test("whole-document audit rejects a candidate that becomes systematically more choreographed across chunks", () => {
  const source = [
    "Governance evidence differs across settings. Some firms face stronger monitoring constraints, while others operate under weaker creditor protections.",
    "Debt pricing also varies with leverage and financing conditions. The empirical literature therefore does not reduce to one stable relationship.",
    "Board composition is another source of heterogeneity. Evidence on independence, leadership and diversity remains conditional.",
  ].join("\n\n");
  const revised = [
    "Three principal findings emerge. First, governance matters. Second, leverage matters. Third, conditions matter.",
    "Three practical implications follow. First, monitoring matters. Second, pricing matters. Third, context matters.",
    "Three conclusions follow. First, independence matters. Second, leadership matters. Third, diversity matters.",
  ].join("\n\n");
  const audit = auditWholeDocumentRegularity({ sourceText: source, revisedText: revised });
  assert.equal(audit.blocking, true);
});
