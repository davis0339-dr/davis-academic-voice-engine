import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseMachineLanguageForensics } from "../server/lib/machineLanguageForensics.js";
import { diagnose } from "../server/lib/diagnostics.js";
import { auditOutputAcceptance } from "../server/lib/outputAcceptance.js";

const machineHeavy = `Creditor assessment involves more than estimating whether a firm can repay its debt. The difficulty is not simple disagreement. Those concerns do not imply that shareholder-aligned governance uniformly reduces debt costs. Conditionality becomes more evident when leadership and board composition enter the analysis.

Temporal variation adds further complexity. The more instructive result comes from evidence showing that the relationship reverses under tighter credit conditions. The unresolved issue is more specific than whether governance matters in the abstract. This evidence does not establish causation; rather, it establishes the context in which differences in borrowing terms become material.

The problem is not whether creditors evaluate governance, but how those signals enter pricing decisions. A similar caution is required when board composition is considered. Even so, the relationship remains conditional on leverage and refinancing exposure. These findings point to two creditor concerns: whether management is constrained and whether reported information can be trusted.

From a creditor standpoint, therefore, independence carries no fixed meaning. Board governance is not merely an oversight mechanism; it is also an information signal. The issue is not simply whether governance is strong, but whether it operates meaningfully under the firm's financial conditions. In other words, governance effects remain contingent on the environment in which creditors assess risk.`;

const directAcademic = `Kim et al. (2011) found higher loan spreads and tighter nonprice terms among borrowers with internal-control weaknesses. Lenders can respond to weak controls through pricing, collateral, covenants, maturity, or monitoring. Each response protects the lender against a different part of the credit risk.

Managers know more about current operations than outside lenders. Financial reporting reduces that gap, but lenders also care about the controls used to produce and review the information. Sengupta (1998) reported lower borrowing costs among firms with stronger disclosure quality.

Evidence on board independence changes with leverage and credit conditions. Bradley and Chen (2015) reported lower debt costs at lower leverage, whereas the relationship reversed when leverage increased or credit conditions tightened. This result makes leverage a relevant condition in the present analysis.

Manufacturers borrow to finance inventories, plant, equipment, working capital, and capital expenditure. Firms within the industry still differ in leverage, liquidity, profitability, collateral, and refinancing exposure. Restricting the sample to manufacturing therefore removes some cross-industry financing differences without assuming that manufacturers face identical credit risk.`;

test("detects polished modern machine-language density rather than relying on old generic clichés", () => {
  const machine = analyseMachineLanguageForensics(machineHeavy);
  const direct = analyseMachineLanguageForensics(directAcademic);

  assert.equal(machine.available, true);
  assert.ok(machine.score >= 0.38, `expected machine-language score >= 0.38, received ${machine.score}`);
  assert.ok(machine.score > direct.score + 0.15, `expected clear separation; machine=${machine.score}, direct=${direct.score}`);
  assert.ok(machine.signals.some((signal) => signal.issue === "machine_language_density"));
  assert.ok(machine.signals.some((signal) => signal.issue === "editorial_discourse_management_density"));
  assert.ok(machine.target_paragraph_indices.length > 0);
});

test("diagnostics exposes machine-language forensics as a first-class signal", () => {
  const result = diagnose(machineHeavy);
  assert.equal(result.machine_language_forensics?.available, true);
  assert.ok(result.machine_language_forensics.score >= 0.38);
});

test("Deep authorial final acceptance refuses an unchanged machine-language-heavy candidate", () => {
  const acceptance = auditOutputAcceptance({
    sourceText: machineHeavy,
    candidateText: machineHeavy,
    rewriteIntensity: "deep",
    naturalisation: "authorial",
    planSummary: { REBUILD_DISCOURSE: 4, SENTENCE_RESTRUCTURE: 6 },
  });

  assert.equal(acceptance.status, "review_required");
  assert.ok(acceptance.reasons.includes("machine_language_residual") || acceptance.reasons.includes("high_machine_language_residual"));
  assert.ok(acceptance.dimensions.candidate_machine_language >= 0.38);
  assert.ok(acceptance.target_paragraph_indices.length > 0);
  assert.equal(acceptance.release_gate.external_detector_check_recommended, false);
});
