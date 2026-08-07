// Phase 3 (Section 19.4 / Section 14): long-document background jobs with
// per-chunk progress, safe fallback, retry and document-level preservation.

import { randomUUID } from "node:crypto";
import { buildDocumentMap } from "./documentMap.js";
import { chunkDocument } from "./chunker.js";
import { rewrite } from "./pipeline.js";
import { auditPreservation } from "./preservation.js";

const jobs = new Map();
const MAX_TRANSIENT_ATTEMPTS = 2;
const TRANSIENT_CODES = new Set(["NETWORK_TIMEOUT", "RATE_LIMITED"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  chunk.attempts = chunk.attempts || 0;

  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt++) {
    chunk.attempts += 1;
    try {
      const result = await rewrite({
        sourceText: chunk.sourceText,
        styleFilters: job.options.styleFilters,
        rewriteIntensity: job.options.rewriteIntensity,
        grammarIntensity: job.options.grammarIntensity,
        lengthPreference: job.options.lengthPreference,
        naturalisation: job.options.naturalisation,
        precedingContext: chunk.precedingContextTail,
        documentGlossary: job.documentMap.glossary,
      });
      chunk.revisedText = result.revised_text;
      chunk.editSummary = result.edit_summary;
      chunk.preservation = result.preservation;
      chunk.status = "done";
      chunk.error = null;
      return;
    } catch (err) {
      const code = err.code || err.healthState || "PROVIDER_ERROR";
      const transient = TRANSIENT_CODES.has(code);

      if (transient && attempt < MAX_TRANSIENT_ATTEMPTS) {
        chunk.error = {
          code,
          message: `${err.message}. Automatic retry ${attempt}/${MAX_TRANSIENT_ATTEMPTS - 1} pending.`,
        };
        await sleep(code === "RATE_LIMITED" ? 2000 : 750);
        continue;
      }

      chunk.status = "failed";
      chunk.error = { code, message: err.message };
      return;
    }
  }
}

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "processing";

  // Sequential processing deliberately limits provider pressure and keeps
  // document-order context deterministic.
  for (const chunk of job.chunks) {
    if (chunk.status === "queued") await processChunk(job, chunk);
  }
  finalizeIfComplete(job);
}

export function createJob({ text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation }) {
  const documentMap = buildDocumentMap(text);
  const { method, chunks, targetWords, hardMaxWords } = chunkDocument(text, documentMap);

  const job = {
    id: randomUUID(),
    status: "queued",
    createdAt: new Date().toISOString(),
    sourceText: text,
    documentMap,
    chunkMethod: method,
    chunkPolicy: { targetWords, hardMaxWords },
    options: { styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation },
    chunks: chunks.map((c) => ({
      ...c,
      status: "queued",
      revisedText: null,
      editSummary: null,
      preservation: null,
      error: null,
      attempts: 0,
    })),
    reassembledText: null,
    documentPreservation: null,
  };
  jobs.set(job.id, job);

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
  chunk.error = null;
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
    chunkPolicy: job.chunkPolicy,
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
      attempts: c.attempts,
      error: c.error,
      editSummary: c.editSummary,
      preservation: c.preservation,
    })),
    reassembledText: job.reassembledText,
    documentPreservation: job.documentPreservation,
    fatalError: job.fatalError || null,
  };
}
