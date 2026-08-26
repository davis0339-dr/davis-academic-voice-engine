import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessAuthorialAnchor,
  authorialAnchorPromptBlock,
  AUTHORIAL_ANCHOR_MAX_WORDS,
  AUTHORIAL_ANCHOR_MIN_WORDS,
} from "../server/lib/authorialAnchor.js";

function sampleWords(count) {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ") + ".";
}

test("authorial calibration requires a bounded substantive sample", () => {
  assert.equal(assessAuthorialAnchor("").reason, "not_supplied");
  assert.equal(assessAuthorialAnchor(sampleWords(AUTHORIAL_ANCHOR_MIN_WORDS - 1)).sufficient, false);
  assert.equal(assessAuthorialAnchor(sampleWords(AUTHORIAL_ANCHOR_MIN_WORDS)).sufficient, true);
  assert.equal(assessAuthorialAnchor(sampleWords(AUTHORIAL_ANCHOR_MAX_WORDS + 1)).reason, "sample_too_long");
});

test("authorial calibration is an expression-only contract with no content transfer", () => {
  const sample = Array.from({ length: 24 }, (_, index) => `The researcher explains proposition ${index + 1} with a deliberately uneven amount of supporting detail and qualification.`).join(" ");
  const block = authorialAnchorPromptBlock(sample);
  assert.match(block, /RESEARCHER-AUTHORED CALIBRATION SAMPLE/);
  assert.match(block, /never copy, paraphrase or import a fact, claim, example, citation/i);
  assert.match(block, /MINIMAL-AUTHORIAL-CORRECTION RULE/);
  assert.match(block, /Correct clear grammar without optimising every acceptable sentence/i);
  assert.match(block, /Measured calibration profile/);
  assert.doesNotMatch(block, /undefined/);
  assert.equal(authorialAnchorPromptBlock(sampleWords(20)), "");
});
