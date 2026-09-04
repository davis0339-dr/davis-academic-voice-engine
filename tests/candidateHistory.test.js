import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateHistoryFor,
  candidateHistoryPromptBlock,
  clearCandidateHistoryForTests,
  isHistoricalDuplicate,
  rememberCandidate,
} from "../server/lib/candidateHistory.js";

const options = {
  sourceText: "A source paragraph about governance and debt cost.",
  rewriteIntensity: "deep",
  naturalisation: "aggressive",
  lengthPreference: "auto",
};

test("same-source candidate history blocks exact historical repetition and supplies compact avoidance evidence", () => {
  clearCandidateHistoryForTests();
  const firstHistory = candidateHistoryFor(options);
  const candidate = "Lenders evaluate governance differently.\n\nBoard structure affects the information available to creditors.";
  rememberCandidate(candidate, firstHistory);

  const nextHistory = candidateHistoryFor(options);
  assert.equal(nextHistory.candidates.length, 1);
  assert.equal(isHistoricalDuplicate(candidate, nextHistory), true);
  assert.equal(isHistoricalDuplicate("A materially different reconstruction.", nextHistory), false);
  const block = candidateHistoryPromptBlock(nextHistory);
  assert.match(block, /PRIOR CANDIDATE NON-REPETITION EVIDENCE/);
  assert.match(block, /lenders evaluate governance differently/);
  assert.ok(block.length < 2000, "history guidance must remain compact");
});

test("history is scoped by source and mode rather than leaking across manuscripts", () => {
  clearCandidateHistoryForTests();
  const history = candidateHistoryFor(options);
  rememberCandidate("One candidate.", history);
  assert.equal(candidateHistoryFor({ ...options, sourceText: "A different manuscript." }).candidates.length, 0);
  assert.equal(candidateHistoryFor({ ...options, rewriteIntensity: "moderate" }).candidates.length, 0);
});
