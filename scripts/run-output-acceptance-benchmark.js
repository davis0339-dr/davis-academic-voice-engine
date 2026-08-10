import fs from "node:fs";
import path from "node:path";
import { auditOutputAcceptance, acceptanceImproved } from "../server/lib/outputAcceptance.js";

const styleFilters = { document_type: "thesis", discipline: "Finance", section: "background" };

const source = `Introduction

Corporate debt is an important financing source. Evidence indicates that creditors consider governance when they assess borrowers (Anderson et al., 2004). Therefore, governance can influence borrowing cost.

The creditor response is not uniformly favorable. Evidence indicates that takeover defenses and board independence can affect lender risk under different conditions (Bradley & Chen, 2015). Therefore, governance effects remain conditional.

Board leadership also provides mixed signals. Evidence indicates that executive power can affect credit outcomes while direct evidence on CEO duality remains limited (Ashbaugh-Skaife et al., 2006). Therefore, leadership effects require additional analysis.

Gender diversity is similarly contingent. Evidence indicates that female board representation can relate to debt outcomes across institutional settings (Benjamin & Biswas, 2019). Therefore, the relationship cannot be treated as universal.`;

const cosmeticallyPolished = `Introduction

Corporate debt remains an important financing source. Evidence indicates that creditors consider governance when they assess borrowers (Anderson et al., 2004). Therefore, governance can influence borrowing cost.

The creditor response remains conditional. Evidence indicates that takeover defenses and board independence can affect lender risk under different conditions (Bradley & Chen, 2015). Therefore, governance effects remain conditional.

Board leadership also provides mixed signals. Evidence indicates that executive power can affect credit outcomes while direct evidence on CEO duality remains limited (Ashbaugh-Skaife et al., 2006). Therefore, leadership effects require additional analysis.

Gender diversity is also contingent. Evidence indicates that female board representation can relate to debt outcomes across institutional settings (Benjamin & Biswas, 2019). Therefore, the relationship cannot be treated as universal.`;

const argumentGoverned = `Introduction

Creditors do not price corporate debt from accounting ratios alone. Anderson et al. (2004) linked board oversight with debt outcomes, which puts governance inside the financing decision without implying one universal effect.

The qualification becomes clearer in the creditor-protection evidence. Takeover defenses can alter lender risk, whereas the board-independence relationship changes with financing conditions (Bradley & Chen, 2015). The same governance arrangement can therefore be read differently by shareholders and creditors.

Executive power presents a different measurement issue. Ashbaugh-Skaife et al. (2006) associated CEO power with credit outcomes; direct U.S. evidence on CEO duality itself remains limited. Treating those constructs as interchangeable would obscure that distinction.

Gender-diversity evidence is less tidy. Benjamin and Biswas (2019) reported context-dependent debt effects. Findings from other institutional settings remain informative, but they cannot simply be carried into U.S. manufacturing without qualification.`;

const formal = `Purpose Statement

The purpose of this explanatory sequential mixed methods study is to examine board governance and the cost of debt.

Research Questions and Hypotheses

Research Question 1

To what extent do board independence, CEO duality, board gender diversity, board size, and audit committee independence predict the cost of debt?

H01a: Board independence does not significantly predict the cost of debt.

H11a: Board independence significantly predicts the cost of debt.`;

function run(candidateText) {
  return auditOutputAcceptance({
    sourceText: source,
    candidateText,
    styleFilters,
    rewriteIntensity: "moderate",
    naturalisation: "aggressive",
    planSummary: { SENTENCE_RESTRUCTURE: 4, SPLIT_OR_MERGE: 4, MICRO_EDIT: 4 },
  });
}

const polished = run(cosmeticallyPolished);
const improved = run(argumentGoverned);
const formalAudit = auditOutputAcceptance({
  sourceText: formal,
  candidateText: formal,
  styleFilters: { document_type: "thesis", discipline: "Finance", section: "purpose" },
  rewriteIntensity: "minor",
  naturalisation: "faithful",
  planSummary: { KEEP: 6 },
});

const failures = [];
if (polished.status === "pass") failures.push("Cosmetically polished machine choreography incorrectly passed.");
if (polished.release_gate.external_detector_check_recommended) failures.push("External detector spend was recommended before internal acceptance.");
if (!(improved.dimensions.candidate_machine_pattern < polished.dimensions.candidate_machine_pattern)) failures.push("Argument-governed reconstruction did not lower machine-pattern score.");
if (!(improved.dimensions.source_dependence < polished.dimensions.source_dependence)) failures.push("Argument-governed reconstruction did not reduce source-skeleton dependence.");
if (!(acceptanceImproved(polished, improved) || improved.status === "pass")) failures.push("Improved candidate was not recognised as materially better.");
if ((formalAudit.candidate_machine_pattern?.narrative_paragraph_count || 0) > 2) failures.push("Formal academic artefacts leaked into narrative choreography scoring.");

const report = {
  generated_at: new Date().toISOString(),
  benchmark: "completed-output-acceptance-v1",
  pass: failures.length === 0,
  failures,
  cases: {
    cosmetically_polished: {
      status: polished.status,
      score: polished.score,
      reasons: polished.reasons,
      dimensions: polished.dimensions,
      detector_check_recommended: polished.release_gate.external_detector_check_recommended,
    },
    argument_governed: {
      status: improved.status,
      score: improved.score,
      reasons: improved.reasons,
      dimensions: improved.dimensions,
      improved_over_polished: acceptanceImproved(polished, improved) || improved.status === "pass",
    },
    formal_artifact_control: {
      status: formalAudit.status,
      narrative_paragraph_count: formalAudit.candidate_machine_pattern?.narrative_paragraph_count || 0,
    },
  },
};

const outPath = path.resolve("output-acceptance-benchmark.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Output acceptance benchmark: ${report.pass ? "PASS" : "FAIL"}`);
console.log(`- polished: status=${polished.status}, score=${polished.score}, machine=${polished.dimensions.candidate_machine_pattern}, dependence=${polished.dimensions.source_dependence}`);
console.log(`- argument-governed: status=${improved.status}, score=${improved.score}, machine=${improved.dimensions.candidate_machine_pattern}, dependence=${improved.dimensions.source_dependence}`);
console.log(`- formal control: narrative paragraphs=${report.cases.formal_artifact_control.narrative_paragraph_count}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
}
