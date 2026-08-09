import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync(new URL("../public/rewriteVerdict.js", import.meta.url), "utf8");

test("candidate verdict surfaces lexical and structural regularisation as a separate dimension", () => {
  assert.match(ui, /Lexical \/ structural drift/);
  assert.match(ui, /iterative_rewrite_quality/);
  assert.match(ui, /rewrite-chain-regularisation-risk/);
  assert.match(ui, /single-pass-formalisation-risk/);
  assert.match(ui, /nominalisation Δ/);
  assert.match(ui, /long-word Δ/);
});

test("a blocking regularisation result is not displayed as an accepted final candidate", () => {
  assert.match(ui, /review-required-regularisation-risk/);
  assert.match(ui, /Candidate not cleared as successful in the UI/);
});

test("Deep surgical fallback is described as a safe fallback rather than successful reconstruction", () => {
  assert.match(ui, /deep_plan_superseded_by_surgical_fallback/);
  assert.match(ui, /did not fulfil the requested Deep structural intervention/);
});
