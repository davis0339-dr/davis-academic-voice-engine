import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";
import { buildDocumentMap } from "../server/lib/documentMap.js";
import {
  buildFallbackBlueprint,
  deriveLongDocumentChunkPolicy,
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

test("Aggressive does not create rewrite scope in the diagnosis-scoped planner", () => {
  const plan = buildDiagnosisScopedPlan(diagnose(cleanAcademic), {
    rewriteIntensity: "deep",
    lengthPreference: "expand",
    naturalisation: "aggressive",
  });
  assert.equal(plan.scopePolicyVersion, "diagnosis-scoped-naturalisation-v1");
  assert.notEqual(plan.intent.recommended, "discourse_reconstruction");
  assert.ok(plan.scopePrinciples.some((rule) => /Aggressive is a treatment style, not a rewrite-scope generator/i.test(rule)));
  assert.ok((plan.items || []).some((item) => item.level === "KEEP" || item.level === "MICRO_EDIT"));
});

test("Long Document narrows Deep + Expand + Aggressive when a clean chunk has no diagnosed development need", () => {
  const policy = deriveLongDocumentChunkPolicy({
    sourceText: cleanAcademic,
    requestedIntensity: "deep",
    requestedNaturalisation: "aggressive",
    requestedLengthPreference: "expand",
  });
  assert.equal(policy.requested.naturalisation, "aggressive");
  assert.equal(policy.effective.naturalisation, "faithful");
  assert.equal(policy.effective.lengthPreference, "maintain");
  assert.equal(policy.aggressive_authorised, false);
  assert.equal(policy.expansion_authorised, false);
});

test("Long Document may use Aggressive only when Deep authority and a deep diagnosis both exist", () => {
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
    "",
    "Introduction",
    "The study introduces a financing problem and identifies the board mechanisms under examination.",
    "",
    "Background of the Problem",
    "The background develops why the financing problem matters and narrows toward the applied gap.",
    "",
    "Problem Statement",
    "The problem statement identifies the unresolved decision problem for finance leaders.",
    "",
    "Purpose Statement",
    "The purpose specifies the variables, population and intended explanatory sequence.",
  ].join("\n");
  const map = buildDocumentMap(text);
  const blueprint = buildFallbackBlueprint(text, map);
  assert.equal(blueprint.version, "longdoc-blueprint-v1");
  assert.ok(blueprint.argument_arc.length >= 4);
  assert.match(blueprint.document_goal, /complete argument/i);
  assert.ok(blueprint.consistency_constraints.some((rule) => /variables|methods|study stage/i.test(rule)));
});

test("whole-document audit rejects a candidate that becomes systematically more choreographed across chunks", () => {
  const sourceChunks = [
    "Creditors use financial information when they assess borrowers. Reporting quality can also matter. The implications differ across firms and contracts.",
    "Board independence has been associated with debt outcomes in earlier studies. The relationship is not constant. Leverage and market conditions alter its interpretation.",
    "CEO authority raises a different question. Some studies examine broad power measures rather than duality itself. The distinction remains relevant to measurement.",
    "Gender diversity evidence comes from several institutional settings. Results differ. The U.S. setting therefore requires careful qualification.",
  ];
  const revisedChunks = [
    "This problem extends to the way creditors evaluate borrowers. Although accounting information remains useful, governance signals also matter because they influence monitoring, which means the financing relationship must be interpreted through several connected mechanisms. Taken together, these considerations demonstrate an important implication for the analysis.",
    "A similar problem arises with board independence. Although monitoring may improve, the debt-cost consequence can change when leverage rises or credit conditions deteriorate, which means the same governance mechanism can carry different implications. Taken together, the evidence therefore demonstrates a conditional relationship.",
    "This distinction is important for CEO authority. Although executive power can affect monitoring, studies often use broader power measures rather than duality itself, which means the empirical construct must be interpreted carefully. Taken together, these findings therefore support a more refined analysis.",
    "A similar problem arises with gender diversity. Although evidence from other settings is informative, institutional conditions differ across markets, which means the U.S. setting cannot be assumed to reproduce the same relationship. Taken together, these findings therefore establish an important contextual qualification.",
  ];
  const sourceText = sourceChunks.join("\n\n");
  const revisedText = revisedChunks.join("\n\n");
  const chunks = sourceChunks.map((sourceText, index) => ({
    index,
    heading: `Section ${index + 1}`,
    sourceText,
    revisedText: revisedChunks[index],
    rewriteMode: "rewrite",
  }));

  const audit = auditWholeDocumentRegularity({ sourceText, revisedText, chunks });
  assert.equal(audit.version, "longdoc-global-audit-v1");
  assert.equal(audit.passed, false);
  assert.equal(audit.status, "selective_repair_required");
  assert.ok(audit.risk_delta > 0);
  assert.ok(audit.systemic_signal_ids.length > 0 || audit.severe_cross_chunk_homogenisation);
  assert.ok(audit.target_chunk_indices.length > 0);
});
