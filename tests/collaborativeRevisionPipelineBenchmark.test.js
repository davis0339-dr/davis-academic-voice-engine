import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rewrite } from "../server/lib/pipeline.js";

const sourceText = readFileSync(
  new URL("./fixtures/collaborative-revision/corporate-governance-cost-of-debt-machine-draft.txt", import.meta.url),
  "utf8"
).trim();

const proposedEvidence = "Add a recent multi-country estimate showing that stronger audit committees reduce loan spreads.";
const proposedMethod = "Use an external governance reform as an instrument for board independence.";

test("the 1,000-word mixed-origin benchmark keeps proposed contributions outside the revised manuscript", async () => {
  const wordCount = sourceText.split(/\s+/).length;
  assert.ok(wordCount >= 850 && wordCount <= 1150, `benchmark should be approximately 1,000 words; received ${wordCount}`);

  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousFetch = global.fetch;
  let capturedRequest;

  process.env.ANTHROPIC_API_KEY = "test-key-not-a-live-credential";
  global.fetch = async (_url, options) => {
    capturedRequest = JSON.parse(options.body);
    const providerPayload = {
      revised_text: sourceText,
      edit_summary: {
        kept: 11,
        micro_edits: 0,
        sentence_restructures: 0,
        split_or_merge: 0,
        paragraph_reorders: 0,
        flags_for_author: [],
      },
      additional_inputs: [
        {
          kind: "evidence",
          location: "Audit committee mechanism",
          proposal: proposedEvidence,
          reason: "The supplied draft explains a mechanism but provides no evidence for its empirical magnitude.",
          status: "verification_required",
          researcher_question: "Which setting and period should the evidence cover?",
          evidence_needed: "A directly relevant study or a result from the researcher's own analysis.",
        },
        {
          kind: "mechanism",
          location: "Causal interpretation",
          proposal: proposedMethod,
          reason: "The supplied draft recognises reverse causality but does not resolve it.",
          status: "researcher_confirmation_required",
          researcher_question: "Does the intended paper make a causal claim or an associational one?",
          evidence_needed: "Research-design justification and a defensible source of exogenous variation.",
        },
      ],
      diagnostics_notes: [],
    };

    return new Response(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(providerPayload) }],
      stop_reason: "end_turn",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await rewrite({
      sourceText,
      styleFilters: {},
      rewriteIntensity: "minor",
      grammarIntensity: "standard",
      lengthPreference: "same",
      naturalisation: "faithful",
      revisionPurpose: "collaborative",
    });

    assert.equal(result.revision_purpose, "collaborative");
    assert.equal(result.additional_inputs.length, 2);
    assert.equal(result.additional_inputs[0].status, "verification_required");
    assert.equal(result.additional_inputs[1].status, "researcher_confirmation_required");
    assert.ok(!result.revised_text.includes(proposedEvidence));
    assert.ok(!result.revised_text.includes(proposedMethod));
    assert.match(capturedRequest.system, /never insert proposed material into revised_text/i);
    assert.match(capturedRequest.system, /do not infer authorship/i);
    assert.match(capturedRequest.system, /do not (?:invent|fabricate)[^.]*citations/i);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});
