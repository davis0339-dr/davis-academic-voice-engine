import { test } from "node:test";
import assert from "node:assert/strict";
import { llmProvider } from "../server/lib/llmProvider.js";
import { repairPreservationCandidate } from "../server/lib/preservationRepair.js";

test("preservation repair fixes the completed candidate instead of regenerating from the source", async () => {
  const sourceText = "The proposed study will examine debt costs in 2023 (Chava et al., 2009).";
  const unsafeText = "The study examines debt costs.";
  const repairedText = "The proposed study will examine debt costs in 2023 (Chava et al., 2009).";
  const originalCall = llmProvider.callAnthropic;
  let userPayload = "";
  llmProvider.callAnthropic = async ({ messages }) => {
    userPayload = messages[0].content;
    return {
      text: JSON.stringify({ revised_text: repairedText }),
      raw: { stop_reason: "end_turn" },
      usage: { input_tokens: 100, output_tokens: 40 },
    };
  };

  const candidateResult = {
    revised_text: unsafeText,
    edit_summary: { kept: 0, micro_edits: 0, sentence_restructures: 1, split_or_merge: 0, paragraph_reorders: 0, flags_for_author: [] },
    additional_inputs: [{ id: "review-1", proposal: "Verify the debt measure." }],
    preservation: { numbers_ok: false, citations_ok: false, study_stage_ok: false, new_factual_claims_detected: true, warnings: [] },
  };

  try {
    const repaired = await repairPreservationCandidate({ sourceText, candidateResult });
    assert.match(userPayload, /ORIGINAL SOURCE/);
    assert.match(userPayload, /CURRENT CANDIDATE/);
    assert.match(userPayload, /The study examines debt costs\./);
    assert.equal(repaired.revised_text, repairedText);
    assert.equal(repaired.preservation.numbers_ok, true);
    assert.equal(repaired.preservation.citations_ok, true);
    assert.equal(repaired.preservation.study_stage_ok, true);
    assert.deepEqual(repaired.additional_inputs, candidateResult.additional_inputs);
    assert.equal(repaired.preservation_repair.attempted, true);
    assert.equal(repaired.preservation_repair.passed, true);
  } finally {
    llmProvider.callAnthropic = originalCall;
  }
});
