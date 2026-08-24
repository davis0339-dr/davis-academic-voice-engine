import { test } from "node:test";
import assert from "node:assert/strict";
import { rewrite } from "../server/lib/pipeline.js";
import { llmProvider, HealthState } from "../server/lib/llmProvider.js";
import { wordCount } from "../server/lib/sentences.js";

const source = `Corporate governance is important for the cost of debt because governance is important to creditors. This demonstrates the importance of governance for creditors. Board independence is important because independent boards monitor management. This further demonstrates the importance of board independence for creditors. Audit committee independence is important because audit committees monitor reporting. This demonstrates the importance of audit committees for creditors. Disclosure quality is important because disclosure reduces information problems. This further demonstrates the importance of disclosure for the cost of debt.`;

test("Deep uses one full-document pass and does not spend on repeated whole-document refinements", async () => {
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

    assert.equal(calls, 1, "Deep must not repeat the whole manuscript before targeted residual recovery");
    assert.equal(result.revised_text, source);
    assert.equal(result.transformation_quality.corrective_retry_used, false);
    assert.equal(result.transformation_quality.rescue_retry_used, false);
    assert.equal(result.transformation_quality.full_document_quality_recovery_allowed, false);
    assert.equal(result.transformation_quality.selective_residual_recovery_preferred, true);
  } finally {
    llmProvider.callAnthropic = originalCall;
  }
});

test("Moderate + Aggressive uses one full-document pass and defers machine-pattern recovery to the selective residual stage", async () => {
  const originalCall = llmProvider.callAnthropic;
  let calls = 0;
  llmProvider.callAnthropic = async () => {
    calls += 1;
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
      rewriteIntensity: "moderate",
      grammarIntensity: "standard",
      lengthPreference: "similar",
      naturalisation: "aggressive",
      revisionPurpose: "collaborative",
    });

    assert.equal(calls, 1, "Moderate must not repeat the entire manuscript prompt before selective recovery");
    assert.equal(result.transformation_quality.corrective_retry_used, false);
    assert.equal(result.transformation_quality.rescue_retry_used, false);
    assert.equal(result.transformation_quality.full_document_quality_recovery_allowed, false);
    assert.equal(result.transformation_quality.selective_residual_recovery_preferred, true);
  } finally {
    llmProvider.callAnthropic = originalCall;
  }
});

test("Expand completes a preservation-safe source-plus-200 contract before returning", async () => {
  const originalCall = llmProvider.callAnthropic;
  const expansionSource = "Corporate governance affects creditor assessment because board oversight shapes reporting reliability and risk control. The study examines board independence and debt cost among manufacturing firms.";
  const developedSentence = "The stated relationship warrants fuller explanation because creditor assessment connects oversight, reporting reliability, risk control, and debt cost within the manufacturing setting already identified by the study.";
  const expanded = `${expansionSource} ${Array.from({ length: 18 }, () => developedSentence).join(" ")}`;
  let calls = 0;
  llmProvider.callAnthropic = async () => {
    calls += 1;
    const revisedText = calls === 1 ? expansionSource : expanded;
    return {
      text: JSON.stringify({
        revised_text: revisedText,
        edit_summary: { kept: 0, micro_edits: 0, sentence_restructures: 2, split_or_merge: 0, paragraph_reorders: 0, flags_for_author: [] },
        additional_inputs: [],
      }),
      raw: { stop_reason: "end_turn" },
      usage: { input_tokens: 100, output_tokens: 100 },
    };
  };

  try {
    const result = await rewrite({
      sourceText: expansionSource,
      styleFilters: {},
      rewriteIntensity: "deep",
      grammarIntensity: "standard",
      lengthPreference: "expand",
      naturalisation: "aggressive",
      revisionPurpose: "fidelity",
    });
    assert.equal(calls, 2);
    assert.ok(wordCount(result.revised_text) >= wordCount(expansionSource) + 200);
    assert.equal(result.length_contract.satisfied, true);
    assert.equal(result.length_contract.recovery.attempted, true);
    assert.equal(result.length_contract.recovery.completed, true);
  } finally {
    llmProvider.callAnthropic = originalCall;
  }
});

test("Expand never labels an under-length candidate as completed after two recovery attempts", async () => {
  const originalCall = llmProvider.callAnthropic;
  let calls = 0;
  llmProvider.callAnthropic = async () => {
    calls += 1;
    return {
      text: JSON.stringify({
        revised_text: source,
        edit_summary: { kept: 8, micro_edits: 0, sentence_restructures: 0, split_or_merge: 0, paragraph_reorders: 0, flags_for_author: [] },
        additional_inputs: [],
      }),
      raw: { stop_reason: "end_turn" },
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  };

  try {
    await assert.rejects(
      rewrite({
        sourceText: source,
        styleFilters: {},
        rewriteIntensity: "deep",
        grammarIntensity: "standard",
        lengthPreference: "expand",
        naturalisation: "aggressive",
        revisionPurpose: "fidelity",
      }),
      (error) => error?.code === "EXPANSION_CONTRACT_UNMET"
    );
    assert.equal(calls, 3, "one primary pass plus two bounded development recoveries");
  } finally {
    llmProvider.callAnthropic = originalCall;
  }
});

