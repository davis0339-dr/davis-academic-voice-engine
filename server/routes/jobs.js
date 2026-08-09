import { Router } from "express";
import { createJob, getJob, retryChunk, summarizeJob } from "../lib/jobStore.js";
import { llmProvider } from "../lib/llmProvider.js";
import { LONG_DOCUMENT_WORD_LIMIT, enforceWordLimit } from "../config/limits.js";

export const jobsRouter = Router();

jobsRouter.post("/jobs", (req, res) => {
  const { text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation } = req.body || {};

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string.", requestId: req.requestId });
  }
  try {
    enforceWordLimit(text, LONG_DOCUMENT_WORD_LIMIT, "Long Document");
  } catch (err) {
    return res.status(413).json({
      error: err.code,
      message: `${err.message} The current in-memory beta is benchmarked for chapter-scale jobs rather than an unlimited whole-thesis upload.`,
      wordCount: err.wordCount,
      wordLimit: err.wordLimit,
      requestId: req.requestId,
    });
  }
  if (!llmProvider.isConfigured()) {
    return res.status(503).json({
      error: "NOT_CONFIGURED",
      message: "The language-model provider is not configured on this server yet. Set ANTHROPIC_API_KEY server-side and retry.",
      requestId: req.requestId,
    });
  }

  try {
    // Preserve the user's selected controls as authority ceilings. The Long
    // Document intelligence layer now decides chunk-by-chunk whether Aggressive
    // treatment or Expand is actually warranted by diagnosis. Authorial no
    // longer silently becomes Aggressive across every chunk.
    const job = createJob({
      text,
      styleFilters: styleFilters || {},
      rewriteIntensity,
      grammarIntensity,
      lengthPreference,
      naturalisation,
    });
    res.status(202).json({ ...summarizeJob(job), requestedNaturalisation: naturalisation || "faithful", requestId: req.requestId });
  } catch (err) {
    if (err.code === "JOB_CONCURRENCY_LIMIT" || err.code === "JOB_STORE_FULL") {
      res.setHeader("Retry-After", "15");
      return res.status(503).json({ error: err.code, message: err.message, requestId: req.requestId });
    }
    throw err;
  }
});

jobsRouter.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND", message: `No job with id ${req.params.id}.`, requestId: req.requestId });
  res.json({ ...summarizeJob(job), requestId: req.requestId });
});

jobsRouter.post("/jobs/:id/chunks/:index/retry", (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index > 10000) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "chunk index must be a non-negative integer.", requestId: req.requestId });
  }
  const result = retryChunk(req.params.id, index);
  if (result.error === "JOB_NOT_FOUND") return res.status(404).json({ error: result.error, requestId: req.requestId });
  if (result.error === "CHUNK_NOT_FOUND") return res.status(404).json({ error: result.error, requestId: req.requestId });
  if (result.error === "JOB_CONCURRENCY_LIMIT") {
    res.setHeader("Retry-After", "15");
    return res.status(503).json({ error: result.error, message: "Long Document is at its safe concurrency limit. Retry shortly.", requestId: req.requestId });
  }
  res.status(202).json({ ...summarizeJob(result.job), requestId: req.requestId });
});
