import { test } from "node:test";
import assert from "node:assert/strict";
import { rewrite } from "../server/lib/pipeline.js";
import { llmProvider, HealthState } from "../server/lib/llmProvider.js";

const source = `Corporate governance is important for the cost of debt because governance is important to creditors. This demonstrates the importance of governance for creditors. Board independence is important because independent boards monitor management. This further demonstrates the importance of board independence for creditors. Audit committee independence is important because audit committees monitor reporting. This demonstrates the importance of audit committees for creditors. Disclosure quality is important because disclosure reduces information problems. This further demonstrates the importance of disclosure for the cost of debt.`;

test("an optional quality-refinement timeout retains the completed candidate instead of restarting the whole rewrite", async () => {
  const originalCall = llmProvider.callAnthropic;
  let calls = 0;
  llmProvider.callAnthropic = async () => {
    calls += 1;
    if (calls > 1) {
      const error = new Error("optional refinement timed out");
      error.healthState = HealthState.NETWORK_TIMEOUT;
      throw error;
    }
    return {
      text: JSON.stringify({
        revised_text: source,
        edit_summary: {
          kept: 8,
          micro_edits: 0,
          sentence_restructures: 0,
          split_or_merge: 0,
          paragraph_reorders: 0,
          flags_for_author: [],
        },
        additional_inputs: [],
      }),
      raw: { stop_reason: "end_turn" },
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  };

  try {
    const result = await rewrite({
      sourceText: source,
      styleFilters: {},
      rewriteIntensity: "deep",
      grammarIntensity: "standard",
      lengthPreference: "similar",
      naturalisation: "aggressive",
      revisionPurpose: "collaborative",
    });

    assert.equal(calls, 2, "a failed optional refinement must not trigger another optional provider pass");
    assert.equal(result.revised_text, source);
    assert.equal(result.transformation_quality.corrective_retry_error.code, HealthState.NETWORK_TIMEOUT);
  } finally {
    llmProvider.callAnthropic = originalCall;
  }
});
