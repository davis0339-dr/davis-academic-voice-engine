import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SINGLE_EDITOR_WORD_LIMIT,
  SINGLE_REFINEMENT_WORD_LIMIT,
  LONG_DOCUMENT_WORD_LIMIT,
  countWords,
  enforceWordLimit,
} from "../server/config/limits.js";

test("single editor and long document have explicit increasing capacity limits", () => {
  assert.equal(SINGLE_EDITOR_WORD_LIMIT, 1500);
  assert.equal(SINGLE_REFINEMENT_WORD_LIMIT, 3000);
  assert.ok(SINGLE_REFINEMENT_WORD_LIMIT > SINGLE_EDITOR_WORD_LIMIT);
  assert.ok(SINGLE_REFINEMENT_WORD_LIMIT >= SINGLE_EDITOR_WORD_LIMIT + 420);
  assert.equal(LONG_DOCUMENT_WORD_LIMIT, 12000);
  assert.ok(LONG_DOCUMENT_WORD_LIMIT > SINGLE_EDITOR_WORD_LIMIT);
});

test("word counter treats punctuation as separators without inflating count", () => {
  assert.equal(countWords("Audit quality, market share; and revenue growth."), 7);
});

test("word limit accepts text at the limit and rejects text above it", () => {
  const atLimit = Array.from({ length: 5 }, () => "audit").join(" ");
  assert.equal(enforceWordLimit(atLimit, 5, "Test editor"), 5);
  assert.throws(
    () => enforceWordLimit(`${atLimit} extra`, 5, "Test editor"),
    (err) => err.code === "WORD_LIMIT_EXCEEDED" && err.wordCount === 6 && err.wordLimit === 5
  );
});
