import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyse } from "../server/lib/pipeline.js";
import { buildSystemPrompt, MANDATORY_REVISION_GUARDRAILS } from "../server/lib/promptContract.js";

test("the governance benchmark uses a compact plan rather than repeating every source sentence", () => {
  const sourceText = fs.readFileSync(new URL("./fixtures/collaborative-revision/corporate-governance-cost-of-debt-machine-draft.txt", import.meta.url), "utf8");
  const analysis = analyse({
    sourceText,
    styleFilters: { region: "West Africa" },
    rewriteIntensity: "moderate",
    grammarIntensity: "standard",
    lengthPreference: "similar",
    naturalisation: "aggressive",
  });
  const prompt = buildSystemPrompt({
    styleProfile: analysis.style_profile_used.effective,
    protectedSpans: analysis.protectedSpans,
    plan: analysis.plan,
    grammarIntensity: "standard",
    lengthPreference: "similar",
    rhetoricalLedger: [],
    humanCadence: analysis.diagnostics.cadence_deviation?.family,
    naturalisation: "aggressive",
    revisionPurpose: "collaborative",
  });

  // Compact source diagnostics may be budgeted, but invariant preservation
  // rules are never traded away to satisfy an arbitrary character threshold.
  assert.ok(prompt.length < 52000, `prompt remained too large at ${prompt.length} characters`);
  assert.doesNotMatch(prompt, /"sentence"\s*:/);
  assert.match(prompt, /REGIONAL AND NON-NATIVE ACADEMIC VOICE/);
  assert.match(prompt, /Do not manufacture errors/);
  assert.match(prompt, /AUTHORITATIVE LENGTH CONTRACT: maintain/);
  assert.match(prompt, /RHETORICAL\/SEMANTIC PRESERVATION/);
  for (const guardrail of MANDATORY_REVISION_GUARDRAILS) {
    assert.ok(prompt.includes(guardrail), `final prompt dropped mandatory guardrail: ${guardrail.slice(0, 60)}`);
  }
});

