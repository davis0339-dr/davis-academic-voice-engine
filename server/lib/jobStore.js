// Phase 3 (Section 19.4 / Section 14): "for long documents, create a
// background job with progress rather than relying on one long HTTP
// request" + "allow retry of only a failed chunk rather than losing the
// whole job."
//
// LIMITATION, stated plainly: this is an in-memory, single-process job
// store. It does not survive a server restart and does not work across
// multiple server instances. A real deployment needs a persistent queue
// (Section 18.1 lists "Background job worker/queue" as its own service
// boundary for exactly this reason) -- that's Phase 7 infrastructure, out
// of scope here. What Phase 3 delivers is the actual chunking/reassembly/
// consistency logic, which a real queue would call the same way.

import { randomUUID } from "node:crypto";
import { buildDocumentMap } from "./documentMap.js";
import { chunkDocument } from "./chunker.js";
import { rewrite } from "./pipeline.js";
import { auditPreservation } from "./preservation.js";

const jobs = new Map();

function assembleChunkText(chunk) {
  const body =
    chunk.status === "done"
      ? chunk.revisedText
      : `[UNREVISED -- chunk ${chunk.index} ${chunk.status}, original text kept so nothing is silently dropped]\n${chunk.sourceText}`;
  return chunk.heading ? `${chunk.heading}\n\n${body}` : body;
}

function finalizeIfComplete(job) {
  const allAttempted = job.chunks.every((c) => c.status === "done" || c.status === "failed");
  if (!allAttempted) return;

  const anyFailed = job.chunks.some((c) => c.status === "failed");
  const reassembledText = job.chunks.map(assembleChunkText).join("\n\n");
  const documentPreservation = auditPreservation(job.sourceText, reassembledText, job.documentMap.protectedSpans);

  job.reassembledText = reassembledText;
  job.documentPreservation = documentPreservation;
  job.status = anyFailed ? "completed_with_errors" : "completed";
}

async function processChunk(job, chunk) {
  chunk.status = "processing";
  chunk.error = null;
  try {
    const result = await rewrite({
      sourceText: chunk.sourceText,
      styleFilters: job.options.styleFilters,
      rewriteIntensity: job.options.rewriteIntensity,
      grammarIntensity: job.options.grammarIntensity,
      lengthPreference: job.options.lengthPreference,
      precedingContext: chunk.precedingContextTail,
      documentGlossary: job.documentMap.glossary,
    });
    chunk.revisedText = result.revised_text;
    chunk.editSummary = result.edit_summary;
    chunk.preservation = result.preservation;
    chunk.status = "done";
  } catch (err) {
    chunk.status = "failed";
    chunk.error = { code: err.code || err.healthState || "PROVIDER_ERROR", message: err.message };
  }
}

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "processing";
  // Sequential on purpose: keeps this build's rate-limit behavior simple
  // and predictable. Bounded-concurrency chunk processing is a reasonable
  // future improvement, not required for Phase 3's acceptance gate.
  for (const chunk of job.chunks) {
    if (chunk.status === "queued") {
      await processChunk(job, chunk);
    }
  }
  finalizeIfComplete(job);
}

export function createJob({ text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference }) {
  const documentMap = buildDocumentMap(text);
  const { method, chunks } = chunkDocument(text, documentMap);

  const job = {
    id: randomUUID(),
    status: "queued",
    createdAt: new Date().toISOString(),
    sourceText: text,
    documentMap,
    chunkMethod: method,
    options: { styleFilters, rewriteIntensity, grammarIntensity, lengthPreference },
    chunks: chunks.map((c) => ({
      ...c,
      status: "queued",
      revisedText: null,
      editSummary: null,
      preservation: null,
      error: null,
    })),
    reassembledText: null,
    documentPreservation: null,
  };
  jobs.set(job.id, job);

  // Fire-and-forget: the HTTP request that created this job returns
  // immediately with the job id; progress is polled via GET /api/jobs/:id.
  processJob(job.id).catch((err) => {
    job.status = "failed";
    job.fatalError = err.message;
  });

  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export async function retryChunk(jobId, chunkIndex) {
  const job = jobs.get(jobId);
  if (!job) return { error: "JOB_NOT_FOUND" };
  const chunk = job.chunks.find((c) => c.index === chunkIndex);
  if (!chunk) return { error: "CHUNK_NOT_FOUND" };

  chunk.status = "queued";
  job.status = "processing";
  job.reassembledText = null;
  job.documentPreservation = null;
  await processChunk(job, chunk);
  finalizeIfComplete(job);
  return { job };
}

export function summarizeJob(job) {
  const chunkCount = job.chunks.length;
  const doneCount = job.chunks.filter((c) => c.status === "done").length;
  const failedCount = job.chunks.filter((c) => c.status === "failed").length;
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    chunkMethod: job.chunkMethod,
    progress: { chunkCount, doneCount, failedCount },
    documentMap: {
      title: job.documentMap.title,
      headingCount: job.documentMap.headings.length,
      glossary: job.documentMap.glossary,
      citationCount: job.documentMap.protectedSpans.citations.length,
    },
    chunks: job.chunks.map((c) => ({
      index: c.index,
      heading: c.heading,
      wordCount: c.wordCount,
      status: c.status,
      error: c.error,
      editSummary: c.editSummary,
      preservation: c.preservation,
    })),
    reassembledText: job.reassembledText,
    documentPreservation: job.documentPreservation,
    fatalError: job.fatalError || null,
  };
}
