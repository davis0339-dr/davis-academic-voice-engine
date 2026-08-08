// Phase 3: long-document background jobs with per-chunk progress,
// safe fallback, retries, quality gates and document-level preservation.

import { randomUUID } from "node:crypto";
import { buildDocumentMap } from "./documentMap.js";
import { chunkDocument } from "./chunker.js";
import { rewrite } from "./pipeline.js";
import { auditPreservation } from "./preservation.js";
import { inferSectionFromHeading } from "./sectionLanguageGuide.js";

const jobs = new Map();
const MAX_TRANSIENT_ATTEMPTS = 4;
const TRANSIENT_CODES = new Set([
  "NETWORK_TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_OVERLOADED",
  "PROVIDER_UNAVAILABLE",
]);
const PROVIDER_BLOCKING_CODES = new Set(["PROVIDER_BILLING_REQUIRED", "AUTH_FAILED", "NOT_CONFIGURED"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(code, attempt, retryAfterMs = null) {
  if (retryAfterMs && Number.isFinite(retryAfterMs)) return Math.min(retryAfterMs, 15000);
  const base = code === "PROVIDER_OVERLOADED" ? 2000 : code === "RATE_LIMITED" ? 2500 : 1000;
  return Math.min(base * 2 ** (attempt - 1), 10000);
}

function normaliseHeading(text) {
  return String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function stripLeadingRepeatedHeading(text, heading) {
  if (!heading || !text) return text;
  const wanted = normaliseHeading(heading);
  let lines = text.split(/\r?\n/);
  let removed = false;

  while (lines.length) {
    while (lines.length && !lines[0].trim()) lines.shift();
    if (!lines.length || normaliseHeading(lines[0]) !== wanted) break;
    lines.shift();
    removed = true;
  }

  return removed ? lines.join("\n").replace(/^\s+/, "") : text;
}

function assembleChunkText(chunk) {
  const body =
    chunk.status === "done"
      ? chunk.revisedText
      : `[UNREVISED -- failed chunk; original text kept so nothing is silently dropped]\n${chunk.sourceText}`;
  const shouldAttachHeading = chunk.heading && chunk.reattachHeading !== false;
  return shouldAttachHeading ? `${chunk.heading}\n\n${body}` : body;
}

function finishChunkTiming(chunk) {
  chunk.completedAt = new Date().toISOString();
  if (chunk.startedAt) {
    chunk.durationMs = Math.max(0, Date.parse(chunk.completedAt) - Date.parse(chunk.startedAt));
  }
}

function finalizeIfComplete(job) {
  if (job.providerBlock) return;
  const allAttempted = job.chunks.every((c) => c.status === "done" || c.status === "failed");
  if (!allAttempted) return;

  const anyFailed = job.chunks.some((c) => c.status === "failed");
  const reassembledText = job.chunks.map(assembleChunkText).join("\n\n");
  const documentPreservation = auditPreservation(job.sourceText, reassembledText, job.documentMap.protectedSpans);

  job.reassembledText = reassembledText;
  job.documentPreservation = documentPreservation;
  job.status = anyFailed ? "completed_with_errors" : "completed";
  job.completedAt = new Date().toISOString();
}

async function processChunk(job, chunk) {
  chunk.status = "processing";
  chunk.error = null;
  chunk.attempts = chunk.attempts || 0;
  chunk.startedAt = new Date().toISOString();
  chunk.completedAt = null;
  chunk.durationMs = null;

  const inferredSection = inferSectionFromHeading(chunk.heading);
  const chunkStyleFilters = { ...(job.options.styleFilters || {}) };
  if (inferredSection) chunkStyleFilters.section = inferredSection;
  chunk.inferredSection = inferredSection || chunkStyleFilters.section || null;

  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt++) {
    chunk.attempts += 1;
    try {
      const result = await rewrite({
        sourceText: chunk.sourceText,
        styleFilters: chunkStyleFilters,
        rewriteIntensity: job.options.rewriteIntensity,
        grammarIntensity: job.options.grammarIntensity,
        lengthPreference: job.options.lengthPreference,
        naturalisation: job.options.naturalisation,
        precedingContext: chunk.precedingContextTail,
        documentGlossary: job.documentMap.glossary,
      });

      if (job.options.naturalisation === "aggressive" && result.transformation_quality && !result.transformation_quality.passed) {
        const err = new Error(
          `Aggressive rewrite failed the quality gate after corrective rewriting: ${result.transformation_quality.reasons.join(" ")}`
        );
        err.code = "QUALITY_GATE_FAILED";
        throw err;
      }

      const revisedText = stripLeadingRepeatedHeading(result.revised_text, chunk.heading);
      chunk.revisedText = revisedText;
      chunk.editSummary = result.edit_summary;
      chunk.preservation = auditPreservation(chunk.sourceText, revisedText);
      chunk.transformationQuality = result.transformation_quality || null;
      chunk.languageQuality = result.language_quality || null;
      chunk.status = "done";
      chunk.error = null;
      finishChunkTiming(chunk);
      return;
    } catch (err) {
      const code = err.code || err.healthState || "PROVIDER_ERROR";
      const transient = TRANSIENT_CODES.has(code);

      if (transient && attempt < MAX_TRANSIENT_ATTEMPTS) {
        const delay = retryDelayMs(code, attempt, err.retryAfterMs);
        chunk.error = {
          code,
          message: `${err.message}. Automatic retry ${attempt}/${MAX_TRANSIENT_ATTEMPTS - 1} in ${Math.round(delay / 1000)}s.`,
        };
        await sleep(delay);
        continue;
      }

      chunk.status = "failed";
      chunk.error = { code, message: err.message };
      finishChunkTiming(chunk);
      return;
    }
  }
}

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "processing";
  job.providerBlock = null;
  job.startedAt = job.startedAt || new Date().toISOString();

  for (const chunk of job.chunks) {
    if (chunk.status !== "queued") continue;
    await processChunk(job, chunk);
    if (chunk.error && PROVIDER_BLOCKING_CODES.has(chunk.error.code)) {
      job.status = chunk.error.code === "PROVIDER_BILLING_REQUIRED" ? "blocked_provider_billing" : "blocked_provider";
      job.providerBlock = {
        code: chunk.error.code,
        message: chunk.error.message,
        chunkIndex: chunk.index,
      };
      // Stop immediately. Do not burn through the remaining chunks with the
      // same non-retryable account/configuration failure. They stay queued and
      // can continue after the provider issue is fixed and Retry is clicked.
      return;
    }
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
    startedAt: null,
    completedAt: null,
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
      transformationQuality: null,
      languageQuality: null,
      inferredSection: inferSectionFromHeading(c.heading),
      error: null,
      attempts: 0,
      startedAt: null,
      completedAt: null,
      durationMs: null,
    })),
    reassembledText: null,
    documentPreservation: null,
    providerBlock: null,
  };
  jobs.set(job.id, job);

  processJob(job.id).catch((err) => {
    job.status = "failed";
    job.fatalError = err.message;
    job.completedAt = new Date().toISOString();
  });

  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function retryChunk(jobId, chunkIndex) {
  const job = jobs.get(jobId);
  if (!job) return { error: "JOB_NOT_FOUND" };
  const chunk = job.chunks.find((c) => c.index === chunkIndex);
  if (!chunk) return { error: "CHUNK_NOT_FOUND" };

  chunk.status = "queued";
  chunk.error = null;
  chunk.transformationQuality = null;
  chunk.languageQuality = null;
  chunk.startedAt = null;
  chunk.completedAt = null;
  chunk.durationMs = null;
  job.status = "processing";
  job.completedAt = null;
  job.reassembledText = null;
  job.documentPreservation = null;
  job.providerBlock = null;

  // Resume the normal job loop so a provider-blocked job continues with the
  // failed chunk and then all still-queued chunks after credits/configuration
  // are restored. The HTTP request returns immediately.
  processJob(jobId).catch((err) => {
    job.status = "failed";
    job.fatalError = err.message;
    job.completedAt = new Date().toISOString();
  });

  return { job };
}

export function summarizeJob(job) {
  const chunkCount = job.chunks.length;
  const doneCount = job.chunks.filter((c) => c.status === "done").length;
  const failedCount = job.chunks.filter((c) => c.status === "failed").length;
  const processingCount = job.chunks.filter((c) => c.status === "processing").length;
  const completedDurations = job.chunks.map((c) => c.durationMs).filter((n) => Number.isFinite(n) && n > 0);
  const averageChunkDurationMs = completedDurations.length
    ? Math.round(completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length)
    : null;
  const remainingCount = Math.max(0, chunkCount - doneCount - failedCount);
  const estimatedRemainingMs = averageChunkDurationMs ? averageChunkDurationMs * remainingCount : null;

  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    chunkMethod: job.chunkMethod,
    chunkPolicy: job.chunkPolicy,
    progress: { chunkCount, doneCount, failedCount, processingCount, averageChunkDurationMs, estimatedRemainingMs },
    documentMap: {
      title: job.documentMap.title,
      headingCount: job.documentMap.headings.length,
      glossary: job.documentMap.glossary,
      citationCount: job.documentMap.protectedSpans.citations.length,
    },
    chunks: job.chunks.map((c) => ({
      index: c.index,
      heading: c.heading,
      inferredSection: c.inferredSection,
      wordCount: c.wordCount,
      status: c.status,
      attempts: c.attempts,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      durationMs: c.durationMs,
      error: c.error,
      editSummary: c.editSummary,
      preservation: c.preservation,
      transformationQuality: c.transformationQuality,
      languageQuality: c.languageQuality,
    })),
    reassembledText: job.reassembledText,
    documentPreservation: job.documentPreservation,
    providerBlock: job.providerBlock || null,
    fatalError: job.fatalError || null,
  };
}
