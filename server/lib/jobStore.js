// Long-document background jobs with whole-document understanding, per-chunk
// diagnosis-guided execution, preservation, transformation-coverage recovery,
// and final cross-chunk regularisation safeguards.

import { randomUUID } from "node:crypto";
import { buildDocumentMap } from "./documentMap.js";
import { chunkDocument } from "./chunker.js";
import { rewrite } from "./pipeline.js";
import { auditPreservation } from "./preservation.js";
import { repairPreservationCandidate } from "./preservationRepair.js";
import { inferSectionFromHeading } from "./sectionLanguageGuide.js";
import { auditLongDocumentStructure } from "./longDocumentStructure.js";
import {
  buildWholeDocumentBlueprint,
  compactBlueprintForChunk,
  deriveLongDocumentChunkPolicy,
  auditTransformationCoverage,
  auditWholeDocumentRegularity,
  coverageRecoveryContext,
  globalRepairContext,
} from "./longDocumentIntelligence.js";
import { buildLengthContract, DEFAULT_EXPAND_MIN_ADDITION_WORDS, lengthContractSatisfied, manuscriptWordCount } from "./lengthContract.js";

const jobs = new Map();
const MAX_TRANSIENT_ATTEMPTS = 4;
const MAX_GLOBAL_REPAIR_CHUNKS = 6;
const TRANSIENT_CODES = new Set([
  "NETWORK_TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_OVERLOADED",
  "PROVIDER_UNAVAILABLE",
]);
const PROVIDER_BLOCKING_CODES = new Set(["PROVIDER_BILLING_REQUIRED", "AUTH_FAILED", "NOT_CONFIGURED"]);

function intEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

const MAX_ACTIVE_JOBS = intEnv("MAX_ACTIVE_LONGDOC_JOBS", 2, 1, 10);
const MAX_STORED_JOBS = intEnv("MAX_STORED_LONGDOC_JOBS", 24, 4, 200);
const MAX_COVERAGE_RECOVERY_CHUNKS = intEnv("MAX_LONGDOC_COVERAGE_RECOVERY_CHUNKS", 16, 4, 30);
const JOB_TTL_MS = intEnv("LONGDOC_JOB_TTL_MINUTES", 120, 15, 1440) * 60 * 1000;
const COMPLETED_JOB_TTL_MS = intEnv("COMPLETED_JOB_TTL_MINUTES", 30, 5, 240) * 60 * 1000;

export function allocateLongDocumentExpansion(chunks = [], totalAdditionWords = DEFAULT_EXPAND_MIN_ADDITION_WORDS) {
  const eligible = chunks.filter((chunk) => chunk?.rewriteMode !== "passthrough" && manuscriptWordCount(chunk?.sourceText || "") > 0);
  const totalWords = eligible.reduce((sum, chunk) => sum + manuscriptWordCount(chunk.sourceText), 0);
  const target = Math.max(0, Math.round(Number(totalAdditionWords) || 0));
  if (!eligible.length || !totalWords || !target) return new Map();
  const rows = eligible.map((chunk) => {
    const exact = target * (manuscriptWordCount(chunk.sourceText) / totalWords);
    return { index: chunk.index, floor: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = target - rows.reduce((sum, row) => sum + row.floor, 0);
  for (const row of [...rows].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (remainder <= 0) break;
    row.floor += 1;
    remainder -= 1;
  }
  return new Map(rows.map((row) => [row.index, row.floor]));
}

function isActive(job) {
  return job && (job.status === "queued" || job.status === "processing");
}

function activeJobCount(excludeJobId = null) {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.id !== excludeJobId && isActive(job)) count += 1;
  }
  return count;
}

function pruneJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (isActive(job)) continue;
    const terminalAt = Date.parse(job.completedAt || job.createdAt || 0);
    const ttl = job.completedAt ? COMPLETED_JOB_TTL_MS : JOB_TTL_MS;
    if (!Number.isFinite(terminalAt) || now - terminalAt >= ttl) jobs.delete(id);
  }

  if (jobs.size <= MAX_STORED_JOBS) return;
  const removable = [...jobs.values()]
    .filter((job) => !isActive(job))
    .sort((a, b) => Date.parse(a.completedAt || a.createdAt || 0) - Date.parse(b.completedAt || b.createdAt || 0));
  while (jobs.size > MAX_STORED_JOBS && removable.length) {
    const job = removable.shift();
    jobs.delete(job.id);
  }
}

const pruneTimer = setInterval(pruneJobs, 5 * 60 * 1000);
pruneTimer.unref?.();

function capacityError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

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
  const body = chunk.status === "done"
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

function completePassthroughChunk(chunk) {
  chunk.status = "done";
  chunk.error = null;
  chunk.startedAt = chunk.startedAt || new Date().toISOString();
  chunk.revisedText = chunk.sourceText;
  chunk.editSummary = {
    kept: 1,
    micro_edits: 0,
    sentence_restructures: 0,
    split_or_merge: 0,
    paragraph_reorders: 0,
    flags_for_author: [],
  };
  chunk.preservation = auditPreservation(chunk.sourceText, chunk.sourceText);
  chunk.transformationQuality = {
    level: "passthrough",
    passed: true,
    enforced: false,
    reasons: [],
    note: "Formal academic structure preserved verbatim; no LLM rewrite was attempted.",
  };
  chunk.languageQuality = null;
  chunk.executionPolicy = {
    requested: null,
    effective: null,
    explanation: "Formal structure is protected and passed through verbatim.",
  };
  finishChunkTiming(chunk);
}

function previousRevisedTail(job, chunk, maxChars = 500) {
  const position = job.chunks.findIndex((item) => item.index === chunk.index);
  if (position <= 0) return "";
  const previous = job.chunks[position - 1];
  const text = previous?.revisedText || previous?.sourceText || "";
  return String(text).slice(-maxChars).trim();
}

async function processChunk(job, chunk, { globalRepair = false, coverageRecovery = false } = {}) {
  chunk.status = "processing";
  chunk.error = null;
  chunk.attempts = chunk.attempts || 0;
  chunk.startedAt = new Date().toISOString();
  chunk.completedAt = null;
  chunk.durationMs = null;

  if (chunk.rewriteMode === "passthrough") {
    completePassthroughChunk(chunk);
    return;
  }

  const inferredSection = inferSectionFromHeading(chunk.heading);
  const chunkStyleFilters = { ...(job.options.styleFilters || {}) };
  if (inferredSection) chunkStyleFilters.section = inferredSection;
  chunk.inferredSection = inferredSection || chunkStyleFilters.section || null;

  const policy = deriveLongDocumentChunkPolicy({
    sourceText: chunk.sourceText,
    requestedIntensity: job.options.rewriteIntensity,
    requestedNaturalisation: job.options.naturalisation,
    requestedLengthPreference: job.options.lengthPreference,
  });
  chunk.executionPolicy = policy;
  const expansionAllocation = allocateLongDocumentExpansion(job.chunks);
  const effectiveLengthPreference = job.options.lengthPreference === "expand"
    ? "expand"
    : (globalRepair || coverageRecovery) ? "maintain" : policy.effective.lengthPreference;
  const chunkMinimumExpansionWords = effectiveLengthPreference === "expand"
    ? (expansionAllocation.get(chunk.index) || 0)
    : undefined;

  const baseDocumentContext = coverageRecovery
    ? coverageRecoveryContext(job.wholeDocumentBlueprint, job.transformationCoverage, chunk)
    : globalRepair
      ? globalRepairContext(job.wholeDocumentBlueprint, job.wholeDocumentAudit, chunk)
      : compactBlueprintForChunk(job.wholeDocumentBlueprint, chunk);

  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt++) {
    chunk.attempts += 1;
    try {
      let result = await rewrite({
        sourceText: chunk.sourceText,
        styleFilters: chunkStyleFilters,
        rewriteIntensity: coverageRecovery ? "deep" : policy.effective.intensity,
        grammarIntensity: job.options.grammarIntensity,
        lengthPreference: effectiveLengthPreference,
        naturalisation: coverageRecovery ? "aggressive" : globalRepair ? "faithful" : policy.effective.naturalisation,
        precedingContext: previousRevisedTail(job, chunk) || chunk.precedingContextTail,
        followingContext: chunk.followingContextHead,
        documentGlossary: job.documentMap.glossary,
        documentContext: baseDocumentContext,
        minimumExpansionWords: chunkMinimumExpansionWords,
      });

      if (result.preservation?.rhetorical_semantic_ok === false || result.preservation?.new_factual_claims_detected) {
        result = await repairPreservationCandidate({
          sourceText: chunk.sourceText,
          candidateResult: result,
          revisionPurpose: "fidelity",
          lengthPreference: effectiveLengthPreference,
          minimumExpansionWords: chunkMinimumExpansionWords,
        });
        if (!result.preservation_repair?.passed) {
          const repairError = new Error("The long-document preservation repair failed its preservation or length contract.");
          repairError.code = "PRESERVATION_REPAIR_REJECTED";
          throw repairError;
        }
        chunk.rhetoricalPreservationRepairApplied = true;
      }

      const revisedText = stripLeadingRepeatedHeading(result.revised_text, chunk.heading);
      chunk.revisedText = revisedText;
      chunk.editSummary = result.edit_summary;
      chunk.preservation = result.preservation || auditPreservation(chunk.sourceText, revisedText, undefined, {
        lengthPreference: effectiveLengthPreference,
      });
      chunk.transformationQuality = result.transformation_quality || null;
      chunk.qualityReviewRequired = Boolean(result.transformation_quality?.enforced && !result.transformation_quality?.passed);
      chunk.languageQuality = result.language_quality || null;
      chunk.interventionIntent = result.intervention_intent || null;
      chunk.plannerScopePolicyVersion = result.planner_scope_policy_version || null;
      chunk.status = "done";
      chunk.error = null;
      if (globalRepair) chunk.globalRepairApplied = true;
      if (coverageRecovery) chunk.coverageRecoveryApplied = true;
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

      if ((globalRepair || coverageRecovery) && chunk.revisedText) {
        chunk.status = "done";
        if (globalRepair) chunk.globalRepairError = { code, message: err.message };
        if (coverageRecovery) chunk.coverageRecoveryError = { code, message: err.message };
        finishChunkTiming(chunk);
        return;
      }

      chunk.status = "failed";
      chunk.error = { code, message: err.message };
      finishChunkTiming(chunk);
      return;
    }
  }
}

function assembleAndAudit(job) {
  const reassembledText = job.chunks.map(assembleChunkText).join("\n\n");
  job.reassembledText = reassembledText;
  job.documentLengthContract = buildLengthContract({
    sourceText: job.sourceText,
    preference: job.options.lengthPreference,
    minimumExpansionWords: DEFAULT_EXPAND_MIN_ADDITION_WORDS,
  });
  job.documentLengthContract.satisfied = lengthContractSatisfied(reassembledText, job.documentLengthContract);
  job.documentLengthContract.candidate_words = manuscriptWordCount(reassembledText);
  job.documentLengthContract.actual_addition_words = manuscriptWordCount(reassembledText) - manuscriptWordCount(job.sourceText);
  job.documentPreservation = auditPreservation(job.sourceText, reassembledText, job.documentMap.protectedSpans, {
    lengthPreference: job.options.lengthPreference,
  });
  job.transformationCoverage = auditTransformationCoverage({
    sourceText: job.sourceText,
    revisedText: reassembledText,
    chunks: job.chunks,
    requestedIntensity: job.options.rewriteIntensity,
    requestedNaturalisation: job.options.naturalisation,
  });
  job.wholeDocumentAudit = auditWholeDocumentRegularity({
    sourceText: job.sourceText,
    revisedText: reassembledText,
    chunks: job.chunks,
  });
  job.structureAudit = auditLongDocumentStructure(job.sourceText, reassembledText);
}

async function recoverTransformationCoverage(job) {
  const audit = job.transformationCoverage;
  job.coverageRepair = { attempted: false, targetChunkIndices: [], repairedChunkIndices: [] };
  if (!audit?.enforced || audit.passed || !audit.target_chunk_indices.length) return;

  const dynamicLimit = Math.min(
    MAX_COVERAGE_RECOVERY_CHUNKS,
    Math.max(4, Math.ceil(job.chunks.filter((c) => c.rewriteMode !== "passthrough").length * 0.6))
  );
  job.coverageRepair.attempted = true;
  job.coverageRepair.targetChunkIndices = audit.target_chunk_indices.slice(0, dynamicLimit);
  job.phase = "transformation_coverage_recovery";

  for (const index of job.coverageRepair.targetChunkIndices) {
    const chunk = job.chunks.find((item) => item.index === index);
    if (!chunk || chunk.status !== "done" || chunk.rewriteMode === "passthrough") continue;
    await processChunk(job, chunk, { coverageRecovery: true });
    if (chunk.coverageRecoveryApplied) job.coverageRepair.repairedChunkIndices.push(index);
  }
  assembleAndAudit(job);
}

async function repairWholeDocumentRegularity(job) {
  job.globalRepair = { attempted: false, targetChunkIndices: [], repairedChunkIndices: [] };
  if (job.wholeDocumentAudit?.passed || !job.wholeDocumentAudit?.target_chunk_indices?.length) return;

  job.globalRepair.attempted = true;
  job.globalRepair.targetChunkIndices = job.wholeDocumentAudit.target_chunk_indices.slice(0, MAX_GLOBAL_REPAIR_CHUNKS);
  job.phase = "selective_global_repair";

  for (const index of job.globalRepair.targetChunkIndices) {
    const chunk = job.chunks.find((item) => item.index === index);
    if (!chunk || chunk.status !== "done" || chunk.rewriteMode === "passthrough") continue;
    await processChunk(job, chunk, { globalRepair: true });
    if (chunk.globalRepairApplied) job.globalRepair.repairedChunkIndices.push(index);
  }
  assembleAndAudit(job);
}

async function finalizeJob(job) {
  if (job.providerBlock) return;
  const allAttempted = job.chunks.every((c) => c.status === "done" || c.status === "failed");
  if (!allAttempted) return;

  assembleAndAudit(job);

  const anyFailed = job.chunks.some((c) => c.status === "failed");
  if (anyFailed) {
    // Keep the transparent preview and failed-chunk markers, but do not spend
    // additional provider calls polishing an incomplete document.
    job.coverageRepair = { attempted: false, skipped: "failed_chunks_remain", targetChunkIndices: [], repairedChunkIndices: [] };
    job.globalRepair = { attempted: false, skipped: "failed_chunks_remain", targetChunkIndices: [], repairedChunkIndices: [] };
    job.candidateStatus = "incomplete";
    job.status = "completed_with_errors";
    job.phase = "incomplete_failed_chunks";
    job.completedAt = new Date().toISOString();
    return;
  }

  // The previous implementation only repaired regularity. That could produce a
  // superficially safer candidate while 80%+ of substantive paragraphs remained
  // untouched. Recover selected-mode execution first, then audit/repair any new
  // cross-chunk regularity created by the deeper reconstruction.
  await recoverTransformationCoverage(job);
  await repairWholeDocumentRegularity(job);

  const coveragePassed = job.transformationCoverage?.passed !== false;
  const regularityPassed = job.wholeDocumentAudit?.passed !== false;
  const preservationPassed = job.documentPreservation?.rhetorical_semantic_ok !== false && !job.documentPreservation?.new_factual_claims_detected;
  const structurePassed = job.structureAudit?.passed !== false;
  const chunkQualityPassed = job.chunks.every((chunk) => !chunk.qualityReviewRequired || chunk.transformationQuality?.passed === true);
  const lengthContractPassed = job.documentLengthContract?.satisfied !== false;
  job.candidateStatus = coveragePassed && regularityPassed && preservationPassed && structurePassed && chunkQualityPassed && lengthContractPassed ? "accepted" : "review_required";
  job.status = "completed";
  job.phase = job.candidateStatus === "accepted" ? "complete" : "complete_review_required";
  job.completedAt = new Date().toISOString();
}

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "processing";
  job.providerBlock = null;
  job.startedAt = job.startedAt || new Date().toISOString();

  if (!job.wholeDocumentBlueprint) {
    job.phase = "whole_document_understanding";
    job.wholeDocumentBlueprint = await buildWholeDocumentBlueprint({
      fullText: job.sourceText,
      documentMap: job.documentMap,
    });
  }

  job.phase = "chunk_revision";
  for (const chunk of job.chunks) {
    if (chunk.status !== "queued") continue;
    await processChunk(job, chunk);
    if (chunk.error && PROVIDER_BLOCKING_CODES.has(chunk.error.code)) {
      job.status = "failed";
      job.providerBlock = {
        code: chunk.error.code,
        message: chunk.error.message,
        chunkIndex: chunk.index,
      };
      job.completedAt = new Date().toISOString();
      return;
    }
  }
  job.phase = "whole_document_audit";
  await finalizeJob(job);
}

export function createJob({ text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation }) {
  pruneJobs();
  if (activeJobCount() >= MAX_ACTIVE_JOBS) {
    throw capacityError("JOB_CONCURRENCY_LIMIT", `Long Document is already processing the safe maximum of ${MAX_ACTIVE_JOBS} concurrent job(s). Retry after an active job finishes.`);
  }
  if (jobs.size >= MAX_STORED_JOBS) {
    throw capacityError("JOB_STORE_FULL", "The temporary long-document job store is full. Retry after older jobs expire.");
  }

  const documentMap = buildDocumentMap(text);
  const { method, chunks, targetWords, hardMaxWords } = chunkDocument(text, documentMap);

  const job = {
    id: randomUUID(),
    status: "queued",
    phase: "queued",
    candidateStatus: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    sourceText: text,
    documentMap,
    wholeDocumentBlueprint: null,
    wholeDocumentAudit: null,
    structureAudit: null,
    transformationCoverage: null,
    documentLengthContract: null,
    coverageRepair: null,
    globalRepair: null,
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
      qualityReviewRequired: false,
      languageQuality: null,
      interventionIntent: null,
      executionPolicy: null,
      plannerScopePolicyVersion: null,
      coverageRecoveryApplied: false,
      coverageRecoveryError: null,
      globalRepairApplied: false,
      globalRepairError: null,
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
  pruneJobs();
  return jobs.get(jobId) || null;
}

export function retryChunk(jobId, chunkIndex) {
  pruneJobs();
  const job = jobs.get(jobId);
  if (!job) return { error: "JOB_NOT_FOUND" };
  const chunk = job.chunks.find((c) => c.index === chunkIndex);
  if (!chunk) return { error: "CHUNK_NOT_FOUND" };
  if (!isActive(job) && activeJobCount(jobId) >= MAX_ACTIVE_JOBS) return { error: "JOB_CONCURRENCY_LIMIT" };

  chunk.status = "queued";
  chunk.error = null;
  chunk.transformationQuality = null;
  chunk.qualityReviewRequired = false;
  chunk.languageQuality = null;
  chunk.coverageRecoveryApplied = false;
  chunk.coverageRecoveryError = null;
  chunk.globalRepairApplied = false;
  chunk.globalRepairError = null;
  chunk.startedAt = null;
  chunk.completedAt = null;
  chunk.durationMs = null;
  job.status = "processing";
  job.phase = "chunk_retry";
  job.completedAt = null;
  job.reassembledText = null;
  job.documentPreservation = null;
  job.transformationCoverage = null;
  job.documentLengthContract = null;
  job.coverageRepair = null;
  job.wholeDocumentAudit = null;
  job.structureAudit = null;
  job.globalRepair = null;
  job.providerBlock = null;

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
  const passthroughCount = job.chunks.filter((c) => c.rewriteMode === "passthrough").length;
  const completedDurations = job.chunks.map((c) => c.durationMs).filter((n) => Number.isFinite(n) && n > 0);
  const averageChunkDurationMs = completedDurations.length
    ? Math.round(completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length)
    : null;
  const remainingCount = Math.max(0, chunkCount - doneCount - failedCount);
  const estimatedRemainingMs = averageChunkDurationMs ? averageChunkDurationMs * remainingCount : null;

  const blueprint = job.wholeDocumentBlueprint
    ? {
        version: job.wholeDocumentBlueprint.version,
        generated_by: job.wholeDocumentBlueprint.generated_by,
        document_goal: job.wholeDocumentBlueprint.document_goal,
        argument_arc: (job.wholeDocumentBlueprint.argument_arc || []).map((item) => ({
          heading: item.heading,
          role: item.role,
          downstream_dependency: item.downstream_dependency,
        })),
        evidence_needs: job.wholeDocumentBlueprint.evidence_needs || [],
        planning_warning: job.wholeDocumentBlueprint.planning_warning || null,
      }
    : null;

  return {
    id: job.id,
    status: job.status,
    phase: job.phase || null,
    candidateStatus: job.candidateStatus || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    expiresAfterMinutes: job.completedAt ? Math.round(COMPLETED_JOB_TTL_MS / 60000) : Math.round(JOB_TTL_MS / 60000),
    requestedOptions: {
      rewriteIntensity: job.options.rewriteIntensity || "auto",
      grammarIntensity: job.options.grammarIntensity || "standard",
      lengthPreference: job.options.lengthPreference || "auto",
      naturalisation: job.options.naturalisation || "faithful",
    },
    chunkMethod: job.chunkMethod,
    chunkPolicy: job.chunkPolicy,
    progress: { chunkCount, doneCount, failedCount, processingCount, passthroughCount, averageChunkDurationMs, estimatedRemainingMs },
    documentMap: {
      title: job.documentMap.title,
      headingCount: job.documentMap.headings.length,
      glossary: job.documentMap.glossary,
      citationCount: job.documentMap.protectedSpans.citations.length,
      wordCount: job.documentMap.wordCount,
    },
    wholeDocumentBlueprint: blueprint,
    transformationCoverage: job.transformationCoverage,
    documentLengthContract: job.documentLengthContract,
    coverageRepair: job.coverageRepair,
    wholeDocumentAudit: job.wholeDocumentAudit,
    structureAudit: job.structureAudit,
    globalRepair: job.globalRepair,
    chunks: job.chunks.map((c) => ({
      index: c.index,
      heading: c.heading,
      inferredSection: c.inferredSection,
      rewriteMode: c.rewriteMode || "rewrite",
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
      qualityReviewRequired: Boolean(c.qualityReviewRequired),
      languageQuality: c.languageQuality,
      interventionIntent: c.interventionIntent,
      executionPolicy: c.executionPolicy,
      plannerScopePolicyVersion: c.plannerScopePolicyVersion,
      coverageRecoveryApplied: c.coverageRecoveryApplied,
      coverageRecoveryError: c.coverageRecoveryError,
      globalRepairApplied: c.globalRepairApplied,
      globalRepairError: c.globalRepairError,
    })),
    reassembledText: job.reassembledText,
    documentPreservation: job.documentPreservation,
    providerBlock: job.providerBlock || null,
    fatalError: job.fatalError || null,
  };
}

