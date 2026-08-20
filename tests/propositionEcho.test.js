import test from "node:test";
import assert from "node:assert/strict";

import { analysePropositionEcho } from "../server/lib/propositionEcho.js";
import { analyseResidualWriting } from "../server/lib/residualDiagnostics.js";
import { auditOutputAcceptance } from "../server/lib/outputAcceptance.js";

const duplicated = [
  "Board independence can therefore influence how lenders assess firm risk.",
  "This demonstrates that board independence can influence how lenders assess the risk of the firm.",
  "The audit committee performs a different function by overseeing financial reporting.",
].join(" ");

test("detects reconstruction-plus-retention proposition echoes", () => {
  const result = analysePropositionEcho(duplicated);
  assert.equal(result.count, 1);
  assert.deepEqual(result.target_paragraph_indices, [0]);
  assert.ok(result.pairs[0].containment >= 0.78);
});

test("does not confuse repeated constructs in a contrast with redundancy", () => {
  const text = "Board independence may lower borrowing costs when leverage is modest. However, board independence may raise borrowing costs when leverage is high and directors favour shareholder risk-taking.";
  assert.equal(analysePropositionEcho(text).count, 0);
});

test("detects an original paragraph followed by its reconstructed duplicate", () => {
  const text = `The reason governance can enter a credit decision begins with the structure of debt itself. Once financing has been provided, shareholders and managers may benefit from decisions that increase the risk borne by creditors, including additional leverage, riskier investment policies, or distributions that reduce the resources available to satisfy debt claims. Creditors anticipate these possibilities before and after lending. They can protect themselves through price and nonprice terms rather than through interest rates alone: spreads may rise, collateral may be required, covenants may become more restrictive, maturities may shorten, or credit may simply become less available.

Governance can enter credit decisions because debt creates distinct structural incentives. Once financing has been provided, shareholders and managers may benefit from decisions that shift risk toward creditors: additional leverage, riskier investment policies, or distributions that reduce resources available to satisfy debt claims. Creditors anticipate these possibilities and protect themselves through a combination of price and nonprice terms. Spreads may rise, collateral may be required, covenants may become more restrictive, maturities may shorten, or credit may become less available.`;
  const result = analysePropositionEcho(text);
  assert.equal(result.paragraph_pair_count, 1);
  assert.equal(result.count, 1);
  assert.deepEqual(result.target_paragraph_indices, [0, 1]);
});

test("residual diagnostics make proposition echoes repairable targets", () => {
  const result = analyseResidualWriting(duplicated);
  assert.equal(result.metrics.adjacent_proposition_echo_count, 1);
  assert.ok(result.signals.some((signal) => signal.id === "adjacent_proposition_echo"));
  assert.equal(result.should_rework, true);
});

test("completed-output acceptance rejects a newly introduced proposition echo", () => {
  const source = "Board independence can influence how lenders assess firm risk. The audit committee performs a different function by overseeing financial reporting.";
  const result = auditOutputAcceptance({
    sourceText: source,
    candidateText: duplicated,
    rewriteIntensity: "moderate",
    naturalisation: "aggressive",
    planSummary: { SENTENCE_RESTRUCTURE: 1, MICRO_EDIT: 1 },
    lengthPreference: "maintain",
  });
  assert.notEqual(result.status, "pass");
  assert.ok(result.reasons.includes("proposition_echo_introduced"));
  assert.ok(result.target_paragraph_indices.includes(0));
});
