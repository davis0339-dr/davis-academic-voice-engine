import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyse } from "../server/lib/pipeline.js";
import { buildSystemPrompt, MANDATORY_REVISION_GUARDRAILS } from "../server/lib/promptContract.js";
import { DEEP_AUTHORIAL_PROTOCOL } from "../server/lib/diagnosisScopedPlanner.js";
import { buildRhetoricalLedger } from "../server/lib/rhetoricalPreservation.js";
import { buildResidualSystemPrompt } from "../server/lib/residualRework.js";
import { repairPrompt } from "../server/lib/preservationRepair.js";

const sourceText = fs.readFileSync(
  new URL("./fixtures/rhetorical-preservation/audit-firm-architecture.txt", import.meta.url),
  "utf8"
);

function deepPrompt() {
  const analysis = analyse({
    sourceText,
    styleFilters: { region: "West Africa" },
    rewriteIntensity: "deep",
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
    rhetoricalLedger: buildRhetoricalLedger(sourceText),
    precedingContext: "The preceding section established the profession's changing organisational form.",
    followingContext: "The next section turns from international evidence to the study's empirical gap.",
    humanCadence: analysis.diagnostics.cadence_deviation?.family,
    naturalisation: "aggressive",
    revisionPurpose: "collaborative",
  });
  return { analysis, prompt };
}

test("the final Deep prompt retains every invariant after source diagnostics are compacted", () => {
  const { analysis, prompt } = deepPrompt();
  assert.ok(analysis.plan.documentGuidance.length > 18, "fixture must exercise the former truncation path");
  for (const guardrail of MANDATORY_REVISION_GUARDRAILS) {
    assert.ok(prompt.includes(guardrail), `final prompt dropped mandatory guardrail: ${guardrail.slice(0, 70)}`);
  }
  for (const rule of DEEP_AUTHORIAL_PROTOCOL) {
    assert.ok(prompt.includes(rule), `final prompt dropped Deep protocol rule: ${rule.slice(0, 70)}`);
  }
  assert.match(prompt, /MANDATORY REVISION GUARDRAILS \(untruncated/);
  assert.match(prompt, /END MANDATORY REVISION GUARDRAILS/);
  assert.ok(prompt.length < 60000, `Deep prompt exceeded the bounded full-contract budget at ${prompt.length}`);
});

test("the final chunk prompt carries both incoming and outgoing intellectual context", () => {
  const { prompt } = deepPrompt();
  assert.match(prompt, /text immediately before it/);
  assert.match(prompt, /next source chunk begins with/i);
  assert.match(prompt, /outgoing transition, unresolved tension or forward link/i);
});

test("the rhetorical ledger maps propositions and logical force without embedding full source sentences", () => {
  const ledger = buildRhetoricalLedger(sourceText);
  const records = ledger.flatMap((paragraph) => paragraph.sentences);
  assert.ok(records.some((record) => record.propositionAnchors.length >= 4));
  assert.ok(records.some((record) => record.logicalRelations.length > 0));
  assert.ok(records.some((record) => record.epistemicQualifiers.length > 0));
  assert.ok(records.some((record) => record.citationAnchors.length > 0));
  assert.ok(ledger.every((paragraph) => paragraph.rhetoricalSequence.length === paragraph.sentences.length));
  assert.equal(JSON.stringify(ledger).includes("Audit-firm performance therefore provides a more appropriate point of departure"), false);
});

test("secondary repair passes cannot discard the common preservation contract", () => {
  const prompts = [buildResidualSystemPrompt(), repairPrompt()];
  for (const prompt of prompts) {
    for (const guardrail of MANDATORY_REVISION_GUARDRAILS) {
      assert.ok(prompt.includes(guardrail), `secondary pass dropped guardrail: ${guardrail.slice(0, 70)}`);
    }
  }
});
