import { test } from "node:test";
import assert from "node:assert/strict";
import "../public/revisionLengthOutcome.js";

const { revisionLengthOutcome } = globalThis.VoiceEngineRevisionLength;
const response = (source, candidate, mode = "expand") => ({
  length_contract: { mode, minimum_addition_words: 200, satisfied: candidate >= source + 200 },
  output_acceptance: { dimensions: { source_word_count: source, candidate_word_count: candidate }, reasons: [mode === "expand" ? "expand_length_contract_missed" : "deep_auto_developmental_compression"] },
  candidate_verdict: { final_status: "length_review_required" },
});

test("the screenshot regression is a 261-word loss and a 461-word expansion deficit, never an achieved increase", () => {
  const message = revisionLengthOutcome(response(1319, 1058));
  assert.match(message, /Expand failed/);
  assert.match(message, /shortened the source by 261 words/);
  assert.match(message, /461 more words are needed/);
  assert.doesNotMatch(message, /preservation-safe|achieved increase|Maintain|internally cleared/);
});

test("partial expansion reports the actual addition and remaining deficit", () => {
  const message = revisionLengthOutcome(response(1319, 1419));
  assert.match(message, /added 100 words/);
  assert.match(message, /100 more words are needed/);
});

test("Auto compression is not reported as a failed Expand selection", () => {
  const message = revisionLengthOutcome(response(1319, 1058, "auto"));
  assert.match(message, /no shortening being selected/);
  assert.doesNotMatch(message, /Expand|200/);
});

test("completed expansion reports a measured success only when internally accepted", () => {
  const data = response(1319, 1519);
  data.output_acceptance.reasons = [];
  data.candidate_verdict.final_status = "accepted";
  assert.match(revisionLengthOutcome(data), /Expand contract met: \+200 words/);
  data.candidate_verdict.final_status = "preservation_review_required";
  assert.match(revisionLengthOutcome(data), /returned for researcher review/);
  assert.doesNotMatch(revisionLengthOutcome(data), /Revision completed and internally cleared|contract met/);
});
