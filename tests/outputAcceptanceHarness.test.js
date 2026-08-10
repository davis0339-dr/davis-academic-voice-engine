import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditOutputAcceptance,
  acceptanceImproved,
  narrativeView,
} from "../server/lib/outputAcceptance.js";

const styleFilters = {
  document_type: "thesis",
  discipline: "Finance",
  section: "background",
};

const patternedSource = `Introduction

Corporate debt is a central source of financing for U.S. businesses, but creditors also consider governance. Evidence shows that reporting quality and board oversight can influence credit outcomes (Anderson et al., 2004). Therefore, governance can matter for borrowing cost.

The creditor response is not uniformly favorable. Studies report that takeover defenses can alter lender risk, while board independence may have conditional effects (Bradley & Chen, 2015). Therefore, governance consequences depend on financing conditions.

Board leadership also provides mixed signals. Research links executive power with credit outcomes, but direct evidence on CEO duality remains limited (Ashbaugh-Skaife et al., 2006). Therefore, leadership effects require further analysis.

Gender diversity is similarly contingent. Evidence from several settings links female board representation with debt outcomes, although the magnitude varies with context (Benjamin & Biswas, 2019). Therefore, the relationship should not be assumed to be universal.`;

const polishedButChoreographed = `Introduction

Corporate debt remains an important financing source for U.S. businesses. Evidence indicates that creditors also use governance information when they assess reporting reliability and board oversight (Anderson et al., 2004). Therefore, governance can influence borrowing cost.

The creditor response is not uniformly favorable. Evidence indicates that takeover defenses can alter lender risk and that board independence can operate differently across financing conditions (Bradley & Chen, 2015). Therefore, governance effects remain conditional.

Board leadership also provides mixed signals. Evidence indicates that executive power can influence credit outcomes, although direct evidence on CEO duality remains limited (Ashbaugh-Skaife et al., 2006). Therefore, leadership effects require additional analysis.

Gender diversity is similarly contingent. Evidence indicates that female board representation can be related to debt outcomes, although the magnitude varies by institutional setting (Benjamin & Biswas, 2019). Therefore, the relationship cannot be treated as universal.`;

const asymmetricCandidate = `Introduction

Creditors do not rely on accounting information alone when they price corporate debt. Anderson et al. (2004) linked board oversight to debt outcomes, which makes governance relevant to the financing decision, but not in a uniform way.

That qualification becomes clearer in the evidence on creditor protection. Takeover defenses can reduce some lender risks, whereas the effect of board independence changes with financing conditions (Bradley & Chen, 2015). A governance mechanism that appears desirable from one stakeholder perspective may therefore carry a different implication for creditors.

Executive power raises a narrower measurement problem. Ashbaugh-Skaife et al. (2006) associated CEO power with credit outcomes; direct U.S. evidence on CEO duality itself remains limited. The distinction matters because power and duality are related constructs, not interchangeable measures.

The gender-diversity evidence is less easily reduced to one direction. Benjamin and Biswas (2019) reported context-dependent debt effects. Other settings may still be informative, but institutional differences limit how confidently those findings can be transferred to U.S. manufacturing firms.`;

const formalOnly = `Purpose Statement

The purpose of this explanatory sequential mixed methods study is to examine board governance and the cost of debt among U.S.-listed manufacturing firms.

Research Questions and Hypotheses

Research Question 1

To what extent do board independence, CEO duality, board gender diversity, board size, and audit committee independence predict the cost of debt?

H01a: Board independence does not significantly predict the cost of debt.

H11a: Board independence significantly predicts the cost of debt.

H01b: CEO duality does not significantly predict the cost of debt.

H11b: CEO duality significantly predicts the cost of debt.`;

function aggressiveAudit(sourceText, candidateText) {
  return auditOutputAcceptance({
    sourceText,
    candidateText,
    styleFilters,
    rewriteIntensity: "moderate",
    naturalisation: "aggressive",
    planSummary: {
      SENTENCE_RESTRUCTURE: 4,
      SPLIT_OR_MERGE: 4,
      MICRO_EDIT: 4,
    },
  });
}

test("completed-output audit does not clear polished paragraph choreography merely because the prose is fluent", () => {
  const audit = aggressiveAudit(patternedSource, polishedButChoreographed);
  assert.notEqual(audit.status, "pass");
  assert.ok(audit.dimensions.academic_surface_quality >= 0.58);
  assert.ok(
    audit.reasons.includes("machine_pattern_reduction_insufficient") ||
    audit.reasons.includes("high_machine_pattern_residual") ||
    audit.reasons.includes("machine_language_residual") ||
    audit.reasons.includes("high_machine_language_residual") ||
    audit.reasons.includes("machine_language_reduction_insufficient") ||
    audit.reasons.includes("high_discourse_regularity_residual") ||
    audit.reasons.includes("discourse_regularity_reduction_insufficient") ||
    audit.reasons.includes("source_skeleton_dependence_high")
  );
  assert.equal(audit.release_gate.external_detector_check_recommended, false);
});

test("argument-governed asymmetry materially improves the independent acceptance profile", () => {
  const bad = aggressiveAudit(patternedSource, polishedButChoreographed);
  const improved = aggressiveAudit(patternedSource, asymmetricCandidate);
  assert.ok(improved.dimensions.candidate_machine_pattern < bad.dimensions.candidate_machine_pattern);
  assert.ok(improved.dimensions.source_dependence < bad.dimensions.source_dependence);
  assert.ok(improved.score >= bad.score);
  assert.equal(acceptanceImproved(bad, improved) || improved.status === "pass", true);
});

test("formal research artefacts are excluded from narrative choreography pressure", () => {
  const view = narrativeView(formalOnly);
  const joined = view.map((row) => row.text).join("\n");
  assert.doesNotMatch(joined, /^H01a:/m);
  assert.doesNotMatch(joined, /^H11a:/m);
  assert.doesNotMatch(joined, /^Research Question 1$/m);
});

test("semantic preservation failure is a hard output-acceptance failure", () => {
  const candidate = asymmetricCandidate.replace("(Bradley & Chen, 2015)", "");
  const audit = aggressiveAudit(patternedSource, candidate);
  assert.equal(audit.status, "fail");
  assert.ok(audit.hard_failures.includes("semantic_preservation_failed"));
  assert.equal(audit.release_gate.release_allowed, false);
});

test("acceptance report exposes the dimensions needed to separate good writing from human-texture recovery", () => {
  const audit = aggressiveAudit(patternedSource, polishedButChoreographed);
  for (const key of [
    "academic_surface_quality",
    "semantic_preservation",
    "source_machine_pattern",
    "candidate_machine_pattern",
    "machine_pattern_delta",
    "source_machine_language",
    "candidate_machine_language",
    "machine_language_delta",
    "source_discourse_regularity",
    "candidate_discourse_regularity",
    "discourse_regularity_delta",
    "source_authorial_texture",
    "candidate_authorial_texture",
    "authorial_texture_delta",
    "source_dependence",
    "substantive_plan_ratio",
  ]) {
    assert.ok(Object.hasOwn(audit.dimensions, key), `missing ${key}`);
  }
  assert.match(audit.note, /not an AI-authorship classifier/i);
});
