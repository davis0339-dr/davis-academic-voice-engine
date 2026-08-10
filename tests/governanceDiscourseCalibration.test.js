import test from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildDiagnosisScopedPlan } from "../server/lib/diagnosisScopedPlanner.js";
import { assessSourceBeforeRewrite } from "../server/lib/sourceAssessment.js";

const paragraphs = [
  "Corporate debt is a central source of financing for U.S. businesses, but creditors do not price it solely from accounting ratios. They also assess the reliability of financial reporting, the quality of oversight, the concentration of managerial authority, and the board's capacity to monitor risk. Evidence from bond and bank-loan markets shows that governance arrangements can affect credit ratings, bond yields, loan spreads, collateral requirements, and covenant terms (Anderson et al., 2004; Ashbaugh-Skaife et al., 2006; Bhojraj & Sengupta, 2003; Francis et al., 2012). The practical question is not whether governance matters in the abstract, but which board-level mechanisms are credibly associated with lower borrowing costs in a contemporary U.S. setting.",
  "This prospectus proposes an explanatory sequential mixed methods study of board independence, chief executive officer (CEO) duality, board gender diversity, board size, audit committee independence, and the cost of debt of U.S.-listed manufacturing firms in the S&P 1500. The quantitative strand will estimate firm-level relationships over 2015-2024. The qualitative strand will then explain how corporate finance executives and lending professionals interpret the significant, nonsignificant, and unexpected statistical patterns. The design seeks to produce an applied explanation that is empirically grounded, theoretically coherent, and useful to decision-makers.",
  "Background of the Problem",
  "The scale of the U.S. corporate debt market makes small differences in borrowing cost economically important. Federal Reserve data indicate that nonfinancial corporate debt securities and loans totaled approximately $13.68 trillion in 2024. Nonfinancial corporate interest payments were approximately $639.36 billion (Board of Governors of the Federal Reserve System, n.d.-a, n.d.-b). Corporate bond issuance also reached approximately $2.0 trillion in 2024, an increase of 30.6% from the prior year (Securities Industry and Financial Markets Association [SIFMA], 2025). These figures do not establish that governance caused the observed financing burden, but they demonstrate the decision context in which firms, lenders, and boards evaluate any governance mechanism claimed to reduce credit risk or financing cost.",
  "Creditors examine governance because debt creates agency conflicts that differ from those of shareholders. Managers may increase operating or financial risk after debt is issued, transfer value through distributions, or use information advantages in ways that weaken creditor protection. Governance and reporting mechanisms can reduce these concerns by improving monitoring and the credibility of information available to lenders. Sengupta (1998) found that firms with higher disclosure quality incurred lower effective interest costs. Bhojraj and Sengupta (2003) linked outside board control to higher bond ratings and lower yields. Anderson et al. (2004) further reported that board independence, board size, and fully independent audit committees were associated with lower debt costs among S&P 500 firms.",
  "The creditor response to governance is not uniformly favorable. Klock et al. (2005) found that some antitakeover provisions reduced bondholder risk even though such provisions could weaken shareholder rights. Chava et al. (2009) similarly reported that firms with weaker takeover defenses faced higher bank-loan spreads, illustrating that creditors may value mechanisms that constrain risk shifting even when shareholders prefer greater managerial discipline. Bradley and Chen (2015) found that board independence reduced debt cost when credit conditions were strong or leverage was low, but increased it when credit conditions were poor or leverage was high. Governance mechanisms can therefore have conditional, nonlinear, or stakeholder-specific consequences rather than a single universal effect.",
  "Board leadership and composition also provide mixed signals. Ashbaugh-Skaife et al. (2006) associated greater CEO power with lower credit ratings. Liu and Jiraporn (2010) found that powerful CEOs were associated with lower ratings, higher bond yields, and more opaque information environments. Direct U.S. evidence on CEO duality and accounting-based debt cost remains limited. Gender-diversity studies are similarly contingent. Benjamin and Biswas (2019) found no overall relationship between female board representation and cost of debt for S&P 1500 firms, but identified a negative relationship among firms without CEO duality. Studies in other institutional settings have generally found lower debt costs when female directors are present or sufficiently represented, although the magnitude depends on independence, critical mass, and market context (Garcia-Blandon et al., 2024; Karavitis et al., 2021; Pandey et al., 2020; Usman et al., 2019).",
  "The post-2015 period warrants focused analysis. Corporate borrowing during 2015-2024 occurred across low-rate conditions, the COVID-19 disruption, rapid policy tightening, and changing expectations concerning disclosure, risk oversight, and board accountability. Hojat and Sharifzadeh (2017) showed that U.S. firms respond heterogeneously to monetary-policy conditions, supporting the use of firm-level panel analysis and year effects rather than assuming a common financing environment. The period provides substantial within-firm and across-time variation while remaining recent enough to reflect contemporary governance and credit-market practices.",
  "Manufacturing firms provide a coherent setting for the proposed inquiry because their financing structures commonly combine long-lived productive assets, inventories, working-capital needs, and recurring access to public or private debt. Restricting the study to manufacturing firms reduces uncontrolled variation that would arise from combining financial institutions, utilities, technology platforms, and asset-light service businesses under one model. The S&P Composite 1500 combines the S&P 500, S&P MidCap 400, and S&P SmallCap 600. It covers approximately 90% of U.S. market capitalisation and provides a defined large-, mid-, and small-cap framework for the proposed study (S&P Dow Jones Indices, 2026).",
  "The existing evidence presents a practical difficulty. Some governance mechanisms appear to reduce information risk and debt cost; others protect shareholders in ways that can increase creditor risk; several relationships vary with leverage, credit conditions, leadership structure, or institutional context. Most prior studies examine a single governance mechanism, a single debt market, an earlier regulatory period, or a non-U.S. sample. A decision-maker cannot safely infer from that fragmented evidence that adding an independent director, separating the CEO and chair roles, increasing board diversity, enlarging the board, or restructuring the audit committee will reduce the firm's borrowing cost.",
  "Problem Statement",
  "U.S. nonfinancial corporations carried approximately $13.68 trillion in debt securities and loans and paid approximately $639.36 billion in interest during 2024 (Board of Governors of the Federal Reserve System, n.d.-a, n.d.-b). Prior research links board monitoring, CEO power, board composition, audit oversight, and reporting quality to bond yields, credit ratings, and bank-loan terms. Yet the direction and strength of these relationships are inconsistent across mechanisms and conditions (Anderson et al., 2004; Bradley & Chen, 2015; Francis et al., 2012; Liu & Jiraporn, 2010). The general business problem is that corporate governance investments may not produce the creditor-risk benefits assumed by firms and lenders. The specific business problem is that some corporate finance leaders of U.S.-listed manufacturing firms lack integrated, contemporary evidence concerning which board-level governance mechanisms are associated with lower accounting-based debt costs and how lenders interpret those mechanisms when pricing credit. This uncertainty can impair governance-resource allocation, debt negotiation, and credit-risk assessment.",
  "Purpose Statement",
  "The purpose of this explanatory sequential mixed methods study is to examine and explain the relationship between board-level corporate governance and the cost of debt of U.S.-listed manufacturing firms in the S&P 1500 during 2015-2024. In the dominant quantitative strand, the independent variables will be board independence, CEO duality, board gender diversity, board size, and audit committee independence. The primary dependent variable will be annual interest expense divided by average interest-bearing debt.",
];

const blankSeparated = paragraphs.join("\n\n");
const singleLineSeparated = paragraphs.join("\n");

function assertGovernanceForensics(text) {
  const diagnostics = diagnose(text);
  const forensics = diagnostics.discourse_regularity_forensics;
  assert.equal(forensics.available, true);
  assert.ok(forensics.narrative_paragraph_count >= 8, `expected >=8 narrative paragraphs, got ${forensics.narrative_paragraph_count}`);
  assert.ok(forensics.score >= 0.42, `expected at least moderate cross-paragraph regularity, got ${forensics.score}`);
  assert.ok(forensics.priority_sentence_indices.length >= 6, `expected multiple forensic leverage points, got ${forensics.priority_sentence_indices.length}`);
  return { diagnostics, forensics };
}

test("governance benchmark no longer passes as low cross-paragraph regularity", () => {
  const { diagnostics } = assertGovernanceForensics(blankSeparated);
  const plan = buildDiagnosisScopedPlan(diagnostics, {
    rewriteIntensity: "moderate",
    naturalisation: "aggressive",
    lengthPreference: "auto",
  });
  assert.ok((plan.summary?.SENTENCE_RESTRUCTURE || 0) >= 6, `expected forensic sentence restructuring, got ${plan.summary?.SENTENCE_RESTRUCTURE || 0}`);
  assert.ok((plan.forensicExecution?.targeted_sentence_count || 0) >= 6, "Moderate + Aggressive should act on diagnosed cross-paragraph leverage points");
});

test("single-line pasted academic formatting still receives cross-paragraph forensics", () => {
  const { forensics } = assertGovernanceForensics(singleLineSeparated);
  assert.equal(forensics.formatting_recovery_used, true);
});

test("strong surface quality cannot preserve a strong-texture label when calibrated regularity is material", () => {
  const assessment = assessSourceBeforeRewrite({ text: blankSeparated, styleFilters: {} });
  assert.ok(Number(assessment.authorial_texture.machine_pattern_regularity?.score || 0) >= 0.42);
  assert.notEqual(assessment.authorial_texture.authorial_texture?.label, "strong", "machine-regular governance benchmark must not retain a blanket strong-texture judgement");
  assert.notEqual(assessment.authorial_texture.preservation_priority, "high", "expressive preservation should not stay high when cross-paragraph regularity is material");
});
