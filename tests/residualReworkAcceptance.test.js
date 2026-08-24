import { test } from "node:test";
import assert from "node:assert/strict";
import { prioritiseResidualBlockIndices, shouldAcceptResidualCandidate } from "../server/lib/residualRework.js";

test("completed-output near-copy and duplication targets receive the finite repair budget first", () => {
  assert.deepEqual(
    prioritiseResidualBlockIndices([9, 4, 8], [1, 2, 3, 4, 5], 4),
    [9, 4, 8, 1]
  );
});

test("selective residual recovery defaults to four blocks rather than rewriting most of a manuscript", async () => {
  const source = (await import("node:fs")).readFileSync(new URL("../server/lib/residualRework.js", import.meta.url), "utf8");
  assert.match(source, /maxBlocks = 4/);
  assert.doesNotMatch(source, /maxBlocks = 8/);
});

test("accepts a preservation-safe residual candidate when machine risk falls materially and the independent audit does not worsen", () => {
  const accepted = shouldAcceptResidualCandidate({
    preservationOk: true,
    noResidualRegression: true,
    beforeScore: 15,
    afterScore: 3,
    beforeAcceptance: { status: "review", score: 66 },
    afterAcceptance: { status: "review", score: 66 },
  });

  assert.equal(accepted, true);
});

test("does not accept cosmetic risk movement, factual drift, or a worse independent audit", () => {
  const base = {
    preservationOk: true,
    noResidualRegression: true,
    beforeScore: 15,
    afterScore: 14,
    beforeAcceptance: { status: "review", score: 66 },
    afterAcceptance: { status: "review", score: 66 },
  };

  assert.equal(shouldAcceptResidualCandidate(base), false);
  assert.equal(shouldAcceptResidualCandidate({ ...base, afterScore: 3, preservationOk: false }), false);
  assert.equal(shouldAcceptResidualCandidate({ ...base, afterScore: 3, afterAcceptance: { status: "review", score: 60 } }), false);
});

test("accepts a very large residual-risk reduction despite a two-point score tradeoff when every protected acceptance dimension remains stable", () => {
  const dimensions = {
    candidate_machine_pattern: 0.58,
    candidate_machine_language: 0.44,
    candidate_discourse_regularity: 0.51,
    source_dependence: 0.64,
    candidate_authorial_texture: 0.57,
  };
  const accepted = shouldAcceptResidualCandidate({
    preservationOk: true,
    noResidualRegression: true,
    beforeScore: 58,
    afterScore: 18,
    beforeAcceptance: { status: "review_required", score: 66, reasons: ["machine_language_residual"], hard_failures: [], dimensions },
    afterAcceptance: {
      status: "review_required",
      score: 64,
      reasons: ["machine_language_residual"],
      hard_failures: [],
      dimensions: { ...dimensions, candidate_machine_pattern: 0.55, candidate_machine_language: 0.41, candidate_discourse_regularity: 0.48, source_dependence: 0.66, candidate_authorial_texture: 0.54 },
    },
  });

  assert.equal(accepted, true);
});

test("large residual movement cannot conceal a new acceptance failure or material machine-language regression", () => {
  const before = {
    status: "review_required",
    score: 66,
    reasons: ["source_skeleton_dependence_high"],
    hard_failures: [],
    dimensions: { candidate_machine_pattern: 0.48, candidate_machine_language: 0.32, candidate_discourse_regularity: 0.40, source_dependence: 0.70, candidate_authorial_texture: 0.60 },
  };
  const after = {
    status: "review_required",
    score: 64,
    reasons: ["source_skeleton_dependence_high", "machine_language_regression"],
    hard_failures: [],
    dimensions: { ...before.dimensions, candidate_machine_language: 0.42 },
  };

  assert.equal(shouldAcceptResidualCandidate({ preservationOk: true, noResidualRegression: true, beforeScore: 58, afterScore: 18, beforeAcceptance: before, afterAcceptance: after }), false);
});

