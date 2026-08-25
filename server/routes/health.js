import { Router } from "express";
import { llmProvider } from "../lib/llmProvider.js";
import { getBuildInfo } from "../lib/buildInfo.js";
import {
  SINGLE_EDITOR_WORD_LIMIT,
  SINGLE_REFINEMENT_WORD_LIMIT,
  LONG_DOCUMENT_WORD_LIMIT,
  UPLOAD_FILE_SIZE_LIMIT_BYTES,
} from "../config/limits.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: process.uptime(),
    build: getBuildInfo(),
    llm: llmProvider.configurationHealth(),
    capabilities: {
      singleEditorWordLimit: SINGLE_EDITOR_WORD_LIMIT,
      singleRefinementWordLimit: SINGLE_REFINEMENT_WORD_LIMIT,
      longDocumentWordLimit: LONG_DOCUMENT_WORD_LIMIT,
      uploadFileSizeLimitBytes: UPLOAD_FILE_SIZE_LIMIT_BYTES,
      uploadFormats: ["txt", "md", "docx", "pdf", "csv", "xlsx"],
      evidenceWorkspaceSourceLimit: 8,
      evidenceWorkspaceSourceTextCapCharacters: 40000,
      researcherStudio: true,
      argumentIntegrityCheck: true,
      liveThirdPartyDetectors: false,
      longDocumentPersistence: "in_memory",
    },
  });
});

// Startup status must be cheap. By default this endpoint reports configuration
// only and does not make an external Anthropic request. A live probe remains
// available explicitly at /api/health/llm?probe=1 for diagnostics.
healthRouter.get("/health/llm", async (req, res) => {
  if (String(req.query?.probe || "") !== "1") {
    return res.json(llmProvider.configurationHealth());
  }

  const result = await llmProvider.checkHealth();
  const httpStatus = ["READY", "NOT_CONFIGURED"].includes(result.state) ? 200 : 502;
  return res.status(httpStatus).json(result);
});
