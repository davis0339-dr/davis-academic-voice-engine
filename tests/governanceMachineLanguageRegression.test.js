import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseMachineLanguageForensics } from "../server/lib/machineLanguageForensics.js";
import { auditOutputAcceptance } from "../server/lib/outputAcceptance.js";

const governanceEditorOutput = `In 2024, U.S. corporate bond issuance reached approximately $2.0 trillion, 30.6% above the prior year (Securities Industry and Financial Markets Association [SIFMA], 2025). That scale does not prove governance shapes financing costs, nor should aggregate borrowing be read as evidence of causation. It does, however, establish the economic context in which modest differences in borrowing terms become material. Boards choose governance arrangements within this environment, finance executives negotiate funding against it, and creditors evaluate which observable borrower characteristics warrant adjustment to their risk assessment.

Creditor assessment involves more than estimating whether a firm will produce enough cash to service its debt. Once financing is extended, lenders cannot continuously control how management deploys resources. Managers and shareholders may later increase leverage, select projects that shift downside risk toward lenders, distribute cash that could support repayment, or pursue strategies whose gains accrue disproportionately to equity while transferring some risk to debt holders. Debt contracting consequently combines pricing with protective mechanisms. Rate increases represent one response to elevated risk, but covenants, collateral requirements, maturity limits, monitoring provisions, and credit ceilings can also be adjusted. Kim et al. (2011) showed that borrowers with internal-control weaknesses faced not only higher loan spreads but tighter nonprice terms, demonstrating that creditors use several contractual channels when information or control problems are detected.

Informational asymmetry complicates the decision further. Managers and directors know considerably more about operating conditions, internal controls, strategic plans, and emerging risks than external lenders can observe. Financial statements narrow that gap, but their reliability depends on how they are produced and overseen. Governance becomes relevant not because directors monitor management abstractly, but because governance arrangements influence creditor confidence in the information underpinning repayment-risk judgments. Sengupta (1998) found that firms with stronger disclosure quality incurred lower effective borrowing costs. Bhojraj and Sengupta (2003) linked stronger outside board oversight with higher bond ratings and lower yields. Anderson et al. (2004) connected board independence, board size, and fully independent audit committees with lower debt costs. These findings point to two creditor concerns: whether management is adequately constrained, and whether the information supporting lending decisions can be trusted.

Those concerns do not imply that shareholder-aligned governance uniformly reduces debt costs. Shareholder and creditor interests overlap in some conditions but diverge sharply in others. Creditors benefit when governance constrains actions that threaten repayment, yet they may be less enthusiastic about governance that empowers shareholders to pursue high-risk, high-return strategies. Klock et al. (2005) found certain antitakeover provisions favourable to bondholders even though shareholders viewed the same provisions as weakening discipline. Chava et al. (2009) observed higher bank-loan spreads among firms facing greater takeover vulnerability. The more instructive result comes from Bradley and Chen (2015): board independence was associated with lower debt costs when leverage remained low or credit conditions were favourable, but the relationship reversed under higher leverage or tightened credit conditions. Independence carries no fixed meaning from the creditor's perspective. Its implications depend on what independent directors can accomplish and on how much risk the firm's financial structure already embeds.

Conditionality becomes more evident when leadership and board composition enter the analysis. CEO power has been linked to weaker credit ratings, higher bond yields, and less transparent information environments (Ashbaugh-Skaife et al., 2006; Liu & Jiraporn, 2010), consistent with creditor concern about concentrated authority. Yet direct U.S. evidence connecting CEO duality to accounting-based debt cost remains limited, preventing duality from being treated as an established determinant. Board gender diversity presents a different pattern. Benjamin and Biswas (2019) found no unconditional relationship between female board representation and cost of debt among S&P 1500 firms, though the association became negative when CEO duality was absent. Evidence from other institutional environments has more often linked female board representation with lower borrowing costs, though the magnitude and even presence of the relationship have depended on director independence, the proportion of women represented, and the broader governance context (Garcia-Blandon et al., 2024; Karavitis et al., 2021; Pandey et al., 2020; Usman et al., 2019). The difficulty is not simple disagreement. Governance mechanisms may become informative only when organisational and financial conditions allow them to operate meaningfully.

Temporal variation adds further complexity. The 2015-2024 period spanned several years of relatively low interest rates, the disruption created by COVID-19, and the rapid monetary tightening that followed. Governance characteristics associated with lower borrowing costs when credit is plentiful may carry different implications when lenders become risk-sensitive and refinancing becomes expensive. Without accounting for these shifts, a relationship concentrated in one subperiod could be mistaken for a stable governance effect. The panel structure matters for more than sample size. Repeated firm-level observations across the decade allow governance relationships to be examined while year effects absorb shocks common to firms in a given period. Sensitivity analysis around 2020 checks whether an estimated association depends disproportionately on the exceptional conditions surrounding the pandemic.

Manufacturing offers a useful setting because debt is integral to the sector's economics. Firms in this industry routinely finance plant and equipment, inventories, working capital, and continuing capital expenditure. Reliance on long-lived productive assets means financing decisions cannot be separated easily from operating structure. Tangible assets may support collateral, yet variation in leverage, liquidity, profitability, growth opportunities, and refinancing exposure persists. A highly leveraged manufacturer with substantial collateral presents a different credit proposition from a less leveraged firm with stronger cash flows, even when board structures appear similar. Restricting the sample to NAICS manufacturing industries reduces structural noise that would arise if banks, utilities, asset-light service firms, technology businesses, and manufacturers were estimated jointly.

The S&P Composite 1500 provides an appropriate frame within that industry boundary because it incorporates large-, mid-, and small-cap firms and represents approximately 90% of U.S. equity market capitalisation (S&P Dow Jones Indices, 2026). The combination of firm sizes broadens the observable range of governance structures and financing conditions without abandoning a clearly defined public-company population. The unresolved issue is more specific than whether governance matters to creditors; existing research establishes that it does. What remains unclear is whether board independence, CEO duality, board gender diversity, board size, and audit committee independence retain distinct explanatory relationships with realised cost of debt when considered together, alongside firm financial characteristics and changing credit conditions, within a contemporary U.S. manufacturing sample. The accounting-based cost-of-debt measure suits that question because it captures the firm's realised interest burden across its outstanding debt portfolio rather than the pricing of a single newly issued instrument.`;

test("governance editor failure is visibly machine-language dense under the internal forensic gate", () => {
  const forensic = analyseMachineLanguageForensics(governanceEditorOutput);

  assert.equal(forensic.available, true);
  assert.ok(forensic.score >= 0.38, `expected machine-language score >= 0.38; received ${forensic.score}`);
  assert.ok(forensic.metrics.hit_sentence_ratio >= 0.30, `expected at least 30% hit density; received ${forensic.metrics.hit_sentence_ratio}`);
  assert.ok(forensic.signals.some((signal) => signal.issue === "machine_language_density"));
  assert.ok(forensic.target_paragraph_indices.length >= 2);
});

test("Deep Authorial acceptance must not release the governance failure unchanged", () => {
  const audit = auditOutputAcceptance({
    sourceText: governanceEditorOutput,
    candidateText: governanceEditorOutput,
    styleFilters: { document_type: "thesis", discipline: "Finance", section: "background" },
    rewriteIntensity: "deep",
    naturalisation: "authorial",
    planSummary: {
      REBUILD_DISCOURSE: 5,
      DISCOURSE_REPACKAGE: 8,
      SENTENCE_RESTRUCTURE: 10,
      MICRO_EDIT: 4,
    },
  });

  assert.notEqual(audit.status, "pass");
  assert.ok(audit.dimensions.candidate_machine_language >= 0.38);
  assert.ok(
    audit.reasons.includes("machine_language_residual") ||
    audit.reasons.includes("high_machine_language_residual") ||
    audit.reasons.includes("machine_language_reduction_insufficient")
  );
  assert.equal(audit.release_gate.release_allowed, false);
  assert.equal(audit.release_gate.external_detector_check_recommended, false);
  assert.ok(audit.target_paragraph_indices.length >= 2);
});
