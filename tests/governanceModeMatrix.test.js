import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";
import { resolveRewriteModePolicy } from "../server/lib/rewriteModePolicy.js";

const governanceTrial = [
  "Corporate debt is a central source of financing for U.S. businesses, but it is not priced solely from accounting ratios. Creditors also assess the reliability of financial reporting, the quality of oversight, the concentration of managerial authority, and the board's capacity to monitor risk.",
  "Evidence from bond and bank-loan markets shows that governance arrangements can affect credit ratings, bond yields, loan spreads, collateral requirements, covenants, and other financing terms (Anderson et al., 2004; Ashbaugh-Skaife et al., 2006; Bhojraj & Sengupta, 2003; Francis et al., 2012).",
  "The practical question is therefore not whether governance matters in the abstract, but which board-level mechanisms are credibly associated with lower borrowing costs in a contemporary U.S. setting.",
  "The proposed explanatory sequential mixed methods study examines board independence, CEO duality, board gender diversity, board size, audit committee independence, and the cost of debt among U.S.-listed manufacturing firms in the S&P 1500 during 2015-2024.",
  "The quantitative strand estimates firm-level relationships, while the qualitative strand explains significant, nonsignificant, and unexpected statistical patterns through interviews with corporate finance executives and lending professionals.",
].join("\n\n");

const matrix = [
  { name: "Minor + Faithful", intensity: "minor", naturalisation: "faithful", expectedNaturalisation: "faithful", authorial: false },
  { name: "Minor + Aggressive", intensity: "minor", naturalisation: "aggressive", expectedNaturalisation: "faithful", authorial: false },
  { name: "Moderate + Faithful", intensity: "moderate", naturalisation: "faithful", expectedNaturalisation: "faithful", authorial: false },
  { name: "Moderate + Aggressive", intensity: "moderate", naturalisation: "aggressive", expectedNaturalisation: "aggressive", authorial: false },
  { name: "Deep + Faithful", intensity: "deep", naturalisation: "faithful", expectedNaturalisation: "faithful", authorial: false },
  { name: "Deep + Authorial", intensity: "deep", naturalisation: "authorial", expectedNaturalisation: "aggressive", authorial: true },
];

for (const row of matrix) {
  test(`${row.name} resolves without silent intensity escalation and produces a scoped backend plan`, () => {
    const diagnosis = diagnose(governanceTrial);
    const texture = diagnosis.authorial_texture || diagnosis.authorialTexture || {};
    const policy = resolveRewriteModePolicy({
      rewriteIntensity: row.intensity,
      naturalisation: row.naturalisation,
      authorialTexture: texture,
    });
    const plan = buildDiagnosisScopedPlan(diagnosis, {
      rewriteIntensity: row.intensity,
      naturalisation: row.naturalisation,
      lengthPreference: "maintain",
    });

    assert.equal(policy.requested_intensity, row.intensity);
    assert.equal(policy.effective_intensity, row.intensity);
    assert.equal(policy.effective_naturalisation, row.expectedNaturalisation);
    assert.equal(Boolean(policy.authorial_reconstruction), row.authorial);
    assert.equal(Boolean(plan.authorialAuthorityActive), row.authorial);
    assert.equal(plan.scopePolicyVersion, "diagnosis-guided-authority-v3");
    assert.ok(Array.isArray(plan.documentGuidance));
    assert.ok(Array.isArray(plan.paragraphPlan));
  });
}

test("the six-option matrix preserves the central ceiling rule", () => {
  const minorAggressive = resolveRewriteModePolicy({ rewriteIntensity: "minor", naturalisation: "aggressive", authorialTexture: {} });
  const moderateAggressive = resolveRewriteModePolicy({ rewriteIntensity: "moderate", naturalisation: "aggressive", authorialTexture: {} });
  const deepAuthorial = resolveRewriteModePolicy({ rewriteIntensity: "deep", naturalisation: "authorial", authorialTexture: {} });

  assert.equal(minorAggressive.effective_intensity, "minor");
  assert.equal(minorAggressive.effective_naturalisation, "faithful");
  assert.equal(moderateAggressive.effective_intensity, "moderate");
  assert.equal(moderateAggressive.effective_naturalisation, "aggressive");
  assert.equal(deepAuthorial.effective_intensity, "deep");
  assert.equal(deepAuthorial.authorial_reconstruction, true);
});
