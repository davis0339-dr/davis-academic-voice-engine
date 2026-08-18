import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyse } from "../server/lib/pipeline.js";
import { buildSystemPrompt } from "../server/lib/promptContract.js";

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
    humanCadence: analysis.diagnostics.cadence_deviation?.family,
    naturalisation: "aggressive",
    revisionPurpose: "collaborative",
  });

  assert.ok(prompt.length < 45000, `prompt remained too large at ${prompt.length} characters`);
  assert.doesNotMatch(prompt, /"sentence"\s*:/);
  assert.match(prompt, /REGIONAL AND NON-NATIVE ACADEMIC VOICE/);
  assert.match(prompt, /Do not manufacture errors/);
});
