import { test } from "node:test";
import assert from "node:assert/strict";
import { createJob, getJob, summarizeJob } from "../server/lib/jobStore.js";

const DOC = `Title\n\n1 Introduction\n\nSome introductory text about firms (Smith, 2020).\n\n2 Conclusion\n\nA short concluding paragraph with 42% and 187 firms.\n`;

function waitForStop(jobId, timeoutMs = 5000) {
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

test("a job with no provider configuration stops after the first blocking error instead of failing every queued chunk", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const job = createJob({ text: DOC, styleFilters: {}, rewriteIntensity: "auto", grammarIntensity: "standard", lengthPreference: "auto" });
    const stopped = await waitForStop(job.id);

    assert.equal(stopped.status, "failed");
    assert.equal(stopped.providerBlock?.code, "NOT_CONFIGURED");
    assert.equal(stopped.chunks.filter((c) => c.status === "failed").length, 1);
    assert.ok(stopped.chunks.some((c) => c.status === "queued"));
    assert.equal(stopped.reassembledText, null);
    assert.equal(stopped.documentPreservation, null);
  } finally {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  }
});

test("a provider-blocked job does not fabricate fallback markers or a misleading document-level preservation audit", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const job = createJob({ text: DOC, styleFilters: {}, rewriteIntensity: "auto", grammarIntensity: "standard", lengthPreference: "auto" });
    const stopped = await waitForStop(job.id);

    assert.equal(stopped.reassembledText, null);
    assert.equal(stopped.documentPreservation, null);
    assert.equal(stopped.providerBlock?.code, "NOT_CONFIGURED");
  } finally {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  }
});

test("summarizeJob exposes one blocking failure while preserving remaining chunks as queued", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const job = createJob({ text: DOC, styleFilters: {}, rewriteIntensity: "auto", grammarIntensity: "standard", lengthPreference: "auto" });
    await waitForStop(job.id);
    const summary = summarizeJob(getJob(job.id));
    assert.equal(summary.progress.chunkCount, summary.chunks.length);
    assert.equal(summary.progress.failedCount, 1);
    assert.equal(summary.providerBlock?.code, "NOT_CONFIGURED");
    assert.ok(summary.chunks.some((c) => c.status === "queued"));
  } finally {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  }
});

test("getJob returns null for an unknown id instead of throwing", () => {
  assert.equal(getJob("not-a-real-id"), null);
});
