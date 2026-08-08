import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGptZeroResponse } from "../server/lib/detectorProviders/gptzero.js";
import { scanWithAllConfigured, listDetectorHealth, DISCLAIMER } from "../server/lib/detectorQA.js";

test("normalizeGptZeroResponse extracts known fields without fabricating missing ones", () => {
  const raw = {
    documents: [
      {
        predicted_class: "human",
        class_probabilities: { human: 0.8, mixed: 0.15, ai: 0.05 },
        completely_generated_prob: 0.05,
        average_generated_prob: 0.1,
      },
    ],
  };
  const result = normalizeGptZeroResponse(raw);
  assert.equal(result.parseWarning, null);
  assert.equal(result.summary.predictedClass, "human");
  assert.equal(result.summary.completelyGeneratedProb, 0.05);
  assert.deepEqual(result.raw, raw);
});

test("normalizeGptZeroResponse flags an unrecognized shape instead of guessing", () => {
  const raw = { something_else_entirely: true };
  const result = normalizeGptZeroResponse(raw);
  assert.match(result.parseWarning, /did not contain/);
  assert.equal(result.summary, null);
});

test("normalizeGptZeroResponse flags a documents[0] with none of the expected score fields", () => {
  const raw = { documents: [{ unexpected_field: 1 }] };
  const result = normalizeGptZeroResponse(raw);
  assert.match(result.parseWarning, /API shape may have changed/);
});

test("listDetectorHealth reports NOT_CONFIGURED when provider credentials are absent, without a network call", async () => {
  const originalGpt = process.env.GPTZERO_API_KEY;
  const originalCopyleaksEmail = process.env.COPYLEAKS_EMAIL;
  const originalCopyleaksKey = process.env.COPYLEAKS_API_KEY;
  delete process.env.GPTZERO_API_KEY;
  delete process.env.COPYLEAKS_EMAIL;
  delete process.env.COPYLEAKS_API_KEY;
  try {
    const health = await listDetectorHealth();
    assert.ok(health.some((h) => h.id === "gptzero" && h.state === "NOT_CONFIGURED"));
    assert.ok(health.some((h) => h.id === "copyleaks" && h.state === "NOT_CONFIGURED"));
  } finally {
    if (originalGpt !== undefined) process.env.GPTZERO_API_KEY = originalGpt;
    if (originalCopyleaksEmail !== undefined) process.env.COPYLEAKS_EMAIL = originalCopyleaksEmail;
    if (originalCopyleaksKey !== undefined) process.env.COPYLEAKS_API_KEY = originalCopyleaksKey;
  }
});

test("scanWithAllConfigured returns NOT_CONFIGURED entries and never fabricates detector scores", async () => {
  const originalGpt = process.env.GPTZERO_API_KEY;
  const originalCopyleaksEmail = process.env.COPYLEAKS_EMAIL;
  const originalCopyleaksKey = process.env.COPYLEAKS_API_KEY;
  delete process.env.GPTZERO_API_KEY;
  delete process.env.COPYLEAKS_EMAIL;
  delete process.env.COPYLEAKS_API_KEY;
  try {
    const { results, observations, disclaimer } = await scanWithAllConfigured("some sample text");
    assert.equal(disclaimer, DISCLAIMER);
    assert.ok(results.every((r) => r.state === "NOT_CONFIGURED"));
    assert.deepEqual(observations, []);
    assert.ok(!results.some((r) => "summary" in r && r.summary !== undefined && r.state !== "READY"));
  } finally {
    if (originalGpt !== undefined) process.env.GPTZERO_API_KEY = originalGpt;
    if (originalCopyleaksEmail !== undefined) process.env.COPYLEAKS_EMAIL = originalCopyleaksEmail;
    if (originalCopyleaksKey !== undefined) process.env.COPYLEAKS_API_KEY = originalCopyleaksKey;
  }
});

test("the disclaimer frames detector outputs as research observations and keeps disagreement visible", () => {
  assert.match(DISCLAIMER, /classifier observations/i);
  assert.match(DISCLAIMER, /not proof of authorship/i);
  assert.match(DISCLAIMER, /disagreement/i);
});
