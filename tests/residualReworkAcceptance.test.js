import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAcceptResidualCandidate } from "../server/lib/residualRework.js";

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

