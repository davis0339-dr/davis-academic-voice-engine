import { test } from "node:test";
import assert from "node:assert/strict";
import { assessContrastiveLanguage } from "../server/lib/contrastiveLanguage.js";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildInterventionPlan } from "../server/lib/planner.js";

const formulaic = `
It is important to note that corporate governance is fundamentally important to organisational performance. Moreover, governance mechanisms significantly influence accountability and transparency, thereby highlighting their critical role in modern organisations. Furthermore, governance structures significantly influence strategic decision-making, thereby underscoring their central importance to organisational outcomes. Additionally, governance arrangements significantly influence stakeholder confidence, thereby reflecting their wider relevance to organisational sustainability. These findings suggest that governance is important. These findings indicate that governance is important. These findings demonstrate that governance is important.

Smith (2022) found that board monitoring improved disclosure quality. Jones (2023) found that board monitoring reduced reporting delays. Adeyemi (2024) found that board monitoring strengthened oversight. Bello (2025) found that board monitoring improved accountability. These findings suggest that board monitoring is important.

Moreover, digitalisation improves audit efficiency. Furthermore, digitalisation improves audit quality. Additionally, digitalisation improves client responsiveness. Consequently, digitalisation improves firm performance.
`;

const developing = `
Board monitoring matters because lenders do not observe managerial reporting choices directly. Stronger oversight can reduce that information gap, although the effect depends on whether independent directors possess the expertise and authority needed to challenge management. Smith (2022) reported an improvement in disclosure quality following stronger board monitoring. Jones (2023), working in a different institutional setting, found a smaller effect on reporting delay. The difference is useful rather than inconvenient: it suggests that monitoring may influence several dimensions of reporting without operating identically across contexts.

Digitalisation changes a different part of the audit process. Data-analytic tools can shorten routine testing, leaving more engagement time for judgement-intensive work. The operational gain does not automatically imply better audit quality, however, because poorly governed tools can simply accelerate weak procedures. For audit firms, the relevant question is therefore not whether technology is present, but how it is integrated with professional judgement and quality control.
`;

test("contrastive layer detects several recurrent machine-associated writing tendencies without claiming authorship", () => {
  const result = assessContrastiveLanguage(formulaic);
  assert.equal(result.authorship_inference, false);
  assert.equal(result.purpose, "revision_quality_only");
  assert.ok(result.signals.length >= 2);
  assert.ok(result.observed_surface_counts.participial_tail_count >= 3);
  assert.ok(result.observed_surface_counts.throat_clearing_count >= 1);
  assert.match(result.guardrails.join(" "), /Do not infer AI authorship/);
});

test("contrastive pressure is lower for prose whose progression follows the argument more naturally", () => {
  const machineLike = assessContrastiveLanguage(formulaic);
  const humanLike = assessContrastiveLanguage(developing);
  assert.ok(machineLike.contrastive_pressure > humanLike.contrastive_pressure);
});

test("contrastive signals reach the intervention planner as document-level rewrite guidance", () => {
  const diagnostics = diagnose(formulaic);
  assert.ok(diagnostics.contrastive_language);
  assert.ok(diagnostics.contrastive_language.signals.length >= 2);

  const plan = buildInterventionPlan(diagnostics, {
    rewriteIntensity: "auto",
    lengthPreference: "auto",
    naturalisation: "aggressive",
  });

  assert.ok(plan.contrastiveLanguageSignalCount >= 2);
  assert.ok(plan.documentGuidance.some((line) => line.includes("Contrastive language signal")));
});

test("contrastive guardrails prioritise preservation and human-corpus writing quality over detector optimisation", () => {
  const result = assessContrastiveLanguage(formulaic);
  const rules = result.guardrails.join(" ");
  assert.match(rules, /Do not change facts, citations, numeric values/);
  assert.match(rules, /Prefer the measured human academic family/);
  assert.match(rules, /detector-oriented optimisation/);
});
