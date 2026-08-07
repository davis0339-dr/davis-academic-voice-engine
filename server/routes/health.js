import { Router } from "express";
import { llmProvider } from "../lib/llmProvider.js";
import { getBuildInfo } from "../lib/buildInfo.js";
import {
  SINGLE_EDITOR_WORD_LIMIT,
  LONG_DOCUMENT_WORD_LIMIT,
  UPLOAD_FILE_SIZE_LIMIT_BYTES,
} from "../config/limits.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: process.uptime(),
    build: getBuildInfo(),
    capabilities: {
      singleEditorWordLimit: SINGLE_EDITOR_WORD_LIMIT,
      longDocumentWordLimit: LONG_DOCUMENT_WORD_LIMIT,
      uploadFileSizeLimitBytes: UPLOAD_FILE_SIZE_LIMIT_BYTES,
      uploadFormats: ["txt", "md", "docx", "pdf"],
      longDocumentPersistence: "in_memory",
    },
  });
});

// Section 19.3: fail fast, small enumerated state set, no indefinite spinner.
healthRouter.get("/health/llm", async (_req, res) => {
  const result = await llmProvider.checkHealth();
  const httpStatus = result.state === "READY" ? 200 : result.state === "NOT_CONFIGURED" ? 200 : 502;
  res.status(httpStatus).json(result);
});
