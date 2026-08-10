import { test } from "node:test";
import assert from "node:assert/strict";
import { assessAuthorialTexture } from "../server/lib/authorialTexture.js";

function diagnosticsFor(paragraphs = []) {
  return {
    discourse_architecture: { signals: [] },
    qualitative_human_discourse: { signals: [] },
    contrastive_language: { signals: [] },
    rhetorical_scaffolding: [],
    cohesion: [],
    paragraph_patterns: [],
    structural_monotony: [],
    generic_phrasing: [],
    text_structure: {
      blocks: paragraphs.map((text, blockIndex) => ({
        type: "paragraph",
        blockIndex,
        wordCount: (String(text).match(/\S+/g) || []).length,
      })),
    },
  };
}

const cadence = { available: true, range_position: "within_observed_range", threshold_flagged: false };
const family = { available: true, family_alignment_score: 0.84 };

test("v2 does not use scholarly trace or citation density as an authorial-texture component", () => {
  const text = [
    "Prior research identifies governance as an important influence on financing outcomes (Smith, 2022).",
    "Further evidence links monitoring arrangements with debt pricing (Jones, 2023).",
    "The present discussion distinguishes those associations from causal claims (Adeyemi, 2024).",
  ].join(" ");
  const result = assessAuthorialTexture({
    text,
    diagnostics: diagnosticsFor([text]),
    cadenceDeviation: cadence,
    languageDeviation: family,
  });

  assert.equal(result.version, "authorial-texture-v2.0");
  assert.ok(result.surface_quality);
  assert.ok(result.authorial_texture);
  assert.ok(result.machine_pattern_regularity);
  assert.ok(result.semantic_preservation);
  assert.ok(result.expressive_preservation);
  assert.equal(Object.hasOwn(result.authorial_texture.components, "scholarly_trace"), false);
  assert.match(result.surface_quality.note, /not evidence of authorial texture/i);
  assert.match(result.note, /citation density.*do not independently/i);
});

test("polished but mechanically regular prose can remain high quality without receiving a blanket expressive-preservation rule", () => {
  const paragraphs = [
    "Furthermore, prior research shows that governance affects financing outcomes. Furthermore, prior research shows that board structure affects monitoring quality. Furthermore, prior research shows that reporting quality affects lender confidence.",
    "Furthermore, prior research shows that leverage affects borrowing conditions. Furthermore, prior research shows that firm size affects credit assessment. Furthermore, prior research shows that profitability affects debt pricing.",
    "Furthermore, prior research shows that liquidity affects financial flexibility. Furthermore, prior research shows that asset structure affects creditor protection. Furthermore, prior research shows that market conditions affect financing costs.",
  ];
  const text = paragraphs.join("\n\n");
  const result = assessAuthorialTexture({
    text,
    diagnostics: diagnosticsFor(paragraphs),
    cadenceDeviation: cadence,
    languageDeviation: family,
  });

  assert.equal(result.surface_quality.label, "high");
  assert.ok(result.machine_pattern_regularity.score >= 0.42, `expected moderate/high regularity, got ${result.machine_pattern_regularity.score}`);
  assert.notEqual(result.expressive_preservation.priority, "high");
});

test("semantic preservation remains high independently of expressive preservation", () => {
  const text = "The model estimates ROA for 2015-2024 using panel regression and reports a 5% significance threshold (Smith, 2022).";
  const result = assessAuthorialTexture({
    text,
    diagnostics: diagnosticsFor([text]),
    cadenceDeviation: cadence,
    languageDeviation: family,
  });

  assert.ok(["high", "very_high"].includes(result.semantic_preservation.priority));
  assert.equal(result.semantic_preservation.basis, "proposition_evidence_argument_integrity");
  assert.equal(result.expressive_preservation.basis, "authorial_texture_strength_minus_machine_pattern_regularisation");
});
