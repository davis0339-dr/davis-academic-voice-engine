import { Router } from "express";
import { createJob, getJob, retryChunk, summarizeJob } from "../lib/jobStore.js";
import { llmProvider } from "../lib/llmProvider.js";

export const jobsRouter = Router();

jobsRouter.post("/jobs", (req, res) => {
  const { text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation } = req.body || {};

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string." });
  }
  if (!llmProvider.isConfigured()) {
    return res.status(503).json({
      error: "NOT_CONFIGURED",
      message: "The language-model provider is not configured on this server yet. Set ANTHROPIC_API_KEY server-side and retry.",
    });
  }

  const job = createJob({ text, styleFilters: styleFilters || {}, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation });
  res.status(202).json(summarizeJob(job));
});

jobsRouter.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND", message: `No job with id ${req.params.id}.` });
  res.json(summarizeJob(job));
});

jobsRouter.post("/jobs/:id/chunks/:index/retry", async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index)) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "chunk index must be an integer." });
  }
  const result = await retryChunk(req.params.id, index);
  if (result.error === "JOB_NOT_FOUND") return res.status(404).json({ error: result.error });
  if (result.error === "CHUNK_NOT_FOUND") return res.status(404).json({ error: result.error });
  res.json(summarizeJob(result.job));
});
