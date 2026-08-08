import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { assessAuthorialTexture } from "../server/lib/authorialTexture.js";
import { resolveRewriteModePolicy } from "../server/lib/rewriteModePolicy.js";
import { parseTextStructure } from "../server/lib/textStructure.js";
import { buildInterventionPlan } from "../server/lib/authorialPlanner.js";

test("strong existing academic texture receives high preservation priority without claiming authorship", () => {
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

  assert.equal(result.preservation_priority, "high");
  assert.equal(result.recommended_breadth, "targeted");
  assert.match(result.note, /does not establish/i);
});

test("Deep plus Aggressive is narrowed to diagnostic-led auto breadth when preservation priority is high", () => {
  const policy = resolveRewriteModePolicy({
    rewriteIntensity: "deep",
    naturalisation: "aggressive",
    authorialTexture: { preservation_priority: "high" },
  });
  assert.equal(policy.requested_intensity, "deep");
  assert.equal(policy.effective_intensity, "auto");
  assert.equal(policy.effective_naturalisation, "faithful");
  assert.equal(policy.depth_permission, "deep_where_diagnosed");
  assert.equal(policy.policy, "authorial_preservation_targeted");
});

test("preservation-aware planner does not micro-edit every clean sentence merely because Deep was selected", () => {
  const text = [
    "The study distinguishes research design from research methods. Research design concerns the intellectual strategy of the inquiry.",
    "Research methods address the procedures through which the study is implemented. These procedures remain tied to the questions being examined.",
    "Evidence from earlier studies is used to develop the theoretical discussion. The empirical part then considers whether the proposed relationships are observable in practice.",
  ].join("\n\n");
  const diagnostics = diagnose(text);
  const plan = buildInterventionPlan(diagnostics, {
    rewriteIntensity: "deep",
    lengthPreference: "maintain",
    naturalisation: "aggressive",
    authorialTexture: { preservation_priority: "high", score: 0.82 },
  });
  const keep = Number(plan.summary.KEEP || 0);
  assert.ok(keep >= Math.ceil(plan.items.length / 2));
  assert.equal(plan.interventionAuthority.breadth, "targeted");
  assert.equal(plan.interventionAuthority.depth_permission, "deep_where_diagnosed");
});

test("isolated page numbers are classified as page artifacts rather than prose headings", () => {
  const structure = parseTextStructure("INTRODUCTION\n\nA paragraph of substantive text appears here.\n\n13\n\nOBJECTIVES OF THE STUDY");
  assert.equal(structure.page_artifact_count, 1);
  assert.ok(structure.blocks.some((block) => block.type === "page_artifact" && block.text === "13"));
});
