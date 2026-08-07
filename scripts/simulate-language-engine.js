import fs from "node:fs";
import path from "node:path";
import { analyse } from "../server/lib/pipeline.js";
import { inferSectionFromHeading } from "../server/lib/sectionLanguageGuide.js";

const background = `The audit profession occupies a foundational position in modern capital markets, supplying independent assurance to investors, regulators, creditors and the public. In its earliest institutional form, audit practice performance was understood largely through fee income and client roster size. Growth was equated with the volume of statutory engagements secured. Financial markets deepened. Corporate accountability expectations widened. That narrow conception later gave way to a multidimensional understanding of revenue expansion, competitive standing, audit quality and engagement efficiency (IFAC, 2024; IAASB, 2022).

In developed economies, audit markets are mature, highly regulated and intensely concentrated. North America accounts for roughly 37 per cent of global audit-services revenue, while the Big Four audit close to 97 per cent of the market capitalisation of the S&P 500 (Grand View Research, 2025; Business Research Insights, 2025).

In emerging economies, the pattern differs. The Asia-Pacific auditing market is expanding at roughly 8.6 per cent annually, while the leading four firms in China account for only about 20 per cent of industry revenue (Grand View Research, 2025; IBISWorld, 2024).

In Africa, the Middle East and Africa region accounts for only about 5 per cent of the global audit-services market. Registered auditors in South Africa fell from 3,914 in 2020 to 3,472 in 2025 (ACCA, 2026; Daily Investor, 2023).

In Nigeria, audit earnings among the fifty largest listed companies rose from ₦7.53 billion in 2019 to ₦11.82 billion in 2022, ₦17.34 billion in 2023 and ₦28.2 billion in 2024, the last representing a 65 per cent year-on-year increase (Nairametrics Research, 2020, 2024, 2025). Lagos State hosts the Big Four networks alongside most indigenous and mid-tier practitioners.`;

const problem = `Aggregate expansion conceals a severe performance disparity. The increase from ₦17.34 billion in 2023 to ₦28.2 billion in 2024 accrued largely to international networks, while indigenous and mid-tier firms recorded limited expansion (Nairametrics Research, 2025; Ecofin Agency, 2025). The Big Four command more than 99 per cent of audit fees among Nigeria's fifty largest listed companies.

Conceptually, existing research treats strategic initiatives in isolation without integrating them with the human, social and financial capital needed for execution (Otuya, 2024; Clinton & Salami, 2021). Theoretically, applications of the resource-based view and dynamic-capabilities perspective remain underdeveloped in audit-firm settings (Enwere et al., 2024; Olumoh, 2024). Methodologically, most audit studies are cross-sectional and skew toward Big Four firms and client outcomes (Olorunsola & Ali-Momoh, 2025; Soyemi et al., 2023). Empirically, the moderating role of proactiveness remains under-tested within professional-service firms (Ogundare & van der Merwe, 2024; Eneh et al., 2025). Contextually, Lagos State is rarely examined as a distinct professional-service ecosystem despite hosting most of Nigeria's premium audit market (Ecofin Agency, 2025).`;

function runCase(name, heading, text) {
  const section = inferSectionFromHeading(heading);
  if (!section) throw new Error(`${name}: section inference failed`);

  const analysis = analyse({
    sourceText: text,
    styleFilters: {
      document_type: "thesis",
      discipline: "Accounting",
      section,
    },
    rewriteIntensity: "deep",
    grammarIntensity: "standard",
    lengthPreference: "preserve",
    naturalisation: "aggressive",
  });

  return {
    name,
    heading,
    inferred_section: section,
    protected: {
      citations: analysis.protectedSpans.citations,
      monetary: analysis.protectedSpans.monetary,
      numbers: analysis.protectedSpans.numbers,
    },
    family: {
      label: analysis.measured_language_family?.effective_label,
      documents: analysis.measured_language_family?.measured_document_count,
      evidence_strength: analysis.measured_language_family?.evidence_strength,
      fallback_applied: analysis.measured_language_family?.fallback_applied,
    },
    fingerprint: analysis.diagnostics.language_fingerprint,
    measured_deviation: analysis.diagnostics.measured_language_deviation,
    structural_issues: analysis.diagnostics.structural_monotony,
    plan_summary: analysis.plan.summary,
    section_guide: analysis.style_profile_used.effective.features.section_language_guide,
  };
}

const report = {
  generated_at: new Date().toISOString(),
  simulation: "thesis-language-engine-stress-v1",
  cases: [
    runCase("background", "1.1 Background to the Study", background),
    runCase("problem", "1.2 Statement of the Problem", problem),
  ],
};

const backgroundResult = report.cases[0];
const problemResult = report.cases[1];

const failures = [];
if (backgroundResult.inferred_section !== "background") failures.push("Background heading was not classified as background.");
if (problemResult.inferred_section !== "statement_of_problem") failures.push("Problem heading was not classified as statement_of_problem.");
if (!backgroundResult.protected.monetary.includes("₦28.2 billion")) failures.push("Naira value ₦28.2 billion was not protected.");
if (!backgroundResult.protected.citations.some((c) => c.includes("Grand View Research, 2025"))) failures.push("Corporate-author citation was not protected.");
if ((backgroundResult.family.documents || 0) < 3) failures.push("Measured Accounting thesis family has fewer than 3 pilot documents after fallback.");
if (!backgroundResult.measured_deviation?.available) failures.push("Measured language-deviation analysis is unavailable for Background.");
if (!problemResult.section_guide?.purpose?.match(/gap|study response|unresolved/i)) failures.push("Problem Statement did not receive problem-specific rhetorical guidance.");

const problemIssues = problemResult.structural_issues.map((x) => x.issue);
if (!problemIssues.includes("gap_label_scaffolding")) failures.push("The Conceptually/Theoretically/Methodologically/Empirically/Contextually scaffold was not detected.");
const backgroundIssues = backgroundResult.structural_issues.map((x) => x.issue);
if (!backgroundIssues.includes("choppy_sentence_run")) failures.push("The artificial short-sentence run was not detected.");

report.pass = failures.length === 0;
report.failures = failures;

const outPath = path.resolve("language-simulation.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`Language simulation: ${report.pass ? "PASS" : "FAIL"}`);
for (const item of report.cases) {
  console.log(`- ${item.name}: section=${item.inferred_section}, family=${item.family.label}, n=${item.family.documents}, signals=${item.measured_deviation?.signals?.length || 0}, structural=${item.structural_issues.map((x) => x.issue).join(", ") || "none"}`);
}
if (failures.length) {
  console.error("Simulation failures:");
  failures.forEach((f) => console.error(`- ${f}`));
  process.exitCode = 1;
}
