import { test } from "node:test";
import assert from "node:assert/strict";
import { createJob, getJob, summarizeJob } from "../server/lib/jobStore.js";

const DOC = `Title\n\n1 Introduction\n\nSome introductory text about firms (Smith, 2020).\n\n2 Conclusion\n\nA short concluding paragraph with 42% and 187 firms.\n`;

function waitForCompletion(jobId, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      const job = getJob(jobId);
      if (job.status === "completed" || job.status === "completed_with_errors" || job.status === "failed") {
        return resolve(job);
      }
      if (Date.now() - start > timeoutMs) return reject(new Error("timed out waiting for job"));
      setTimeout(poll, 20);
    };
    poll();
  });
}

test("a job created with no ANTHROPIC_API_KEY configured fails every chunk but still reassembles, losing nothing", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const job = createJob({ text: DOC, styleFilters: {}, rewriteIntensity: "auto", grammarIntensity: "standard", lengthPreference: "auto" });
    const finished = await waitForCompletion(job.id);

    assert.equal(finished.status, "completed_with_errors");
    assert.ok(finished.chunks.every((c) => c.status === "failed"));
    assert.ok(finished.chunks.every((c) => c.error && c.error.code === "NOT_CONFIGURED"));

    // Nothing silently dropped: every original protected span still appears
    // in the reassembled document, because failed chunks fall back to their
    // original source text rather than being omitted.
    for (const citation of finished.documentMap.protectedSpans.citations) {
      assert.ok(finished.reassembledText.includes(citation), `expected reassembled text to still contain ${citation}`);
    }
  } finally {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  }
});

test("summarizeJob exposes progress counts consistent with chunk statuses", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const job = createJob({ text: DOC, styleFilters: {}, rewriteIntensity: "auto", grammarIntensity: "standard", lengthPreference: "auto" });
    await waitForCompletion(job.id);
    const summary = summarizeJob(getJob(job.id));
    assert.equal(summary.progress.chunkCount, summary.chunks.length);
    assert.equal(summary.progress.failedCount, summary.chunks.length);
  } finally {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  }
});

test("getJob returns null for an unknown id instead of throwing", () => {
  assert.equal(getJob("not-a-real-id"), null);
});
