import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { assessAuthorialTexture } from "../server/lib/authorialTexture.js";
import { resolveRewriteModePolicy } from "../server/lib/rewriteModePolicy.js";
import { parseTextStructure } from "../server/lib/textStructure.js";

test("strong academic quality does not automatically become high expressive preservation", () => {
  const text = [
    "Emerging markets face institutional constraints that can limit the direct transfer of governance arrangements developed elsewhere. The problem is not simply financial because governance practice also depends on the institutional setting in which firms operate (Hakim, 1997).",
    "A different issue concerns corporate identity. Product and service quality can be difficult to observe directly, particularly in knowledge-based industries, and stakeholder perceptions therefore become relevant to how firms are positioned in the marketplace.",
    "The methodology distinguishes research design from research methods. Research design concerns the purpose and intellectual strategy of the inquiry, whereas research methods concern the procedures through which the study is implemented (McBurney, 1998).",
    "Policy research provides knowledge for action. Theoretical research, by comparison, provides knowledge that assists explanation, although the two approaches need not be mutually exclusive (Majchrzak, 1984).",
  ].join("\n\n");
  const diagnostics = diagnose(text);
  const result = assessAuthorialTexture({
    text,
    diagnostics,
    cadenceDeviation: { available: true, range_position: "within_observed_range", threshold_flagged: false },
    languageDeviation: { available: true, family_alignment_score: 0.88 },
  });

  assert.ok(result.surface_quality.score >= 0.8);
  assert.equal(result.surface_quality.label, "high");
  assert.equal(result.semantic_preservation.priority, "very_high");
  assert.ok(["low", "medium", "high"].includes(result.expressive_preservation.priority));
  assert.equal(result.preservation_priority, result.expressive_preservation.priority);
  assert.notEqual(result.recommended_breadth, undefined);
  assert.match(result.note, /does not establish/i);
  assert.match(result.note, /clarity|grammar/i);
});

test("strong texture does not silently replace an explicit Deep choice with Auto", () => {
  const policy = resolveRewriteModePolicy({
    rewriteIntensity: "deep",
    naturalisation: "aggressive",
    authorialTexture: { preservation_priority: "high" },
  });
  assert.equal(policy.requested_intensity, "deep");
  assert.equal(policy.effective_intensity, "deep");
  assert.equal(policy.effective_naturalisation, "aggressive");
  assert.equal(policy.depth_permission, "deep_where_diagnosed");
  assert.equal(policy.policy, "deep_diagnostic_authority");
  assert.equal(policy.universal_rewrite_authorised, false);
});

test("isolated page numbers are classified as page artifacts rather than prose headings", () => {
  const structure = parseTextStructure("INTRODUCTION\n\nA paragraph of substantive text appears here.\n\n13\n\nOBJECTIVES OF THE STUDY");
  assert.equal(structure.page_artifact_count, 1);
  assert.ok(structure.blocks.some((block) => block.type === "page_artifact" && block.text === "13"));
});
