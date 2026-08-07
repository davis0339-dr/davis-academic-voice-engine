import { Router } from "express";
import { analyse } from "../lib/pipeline.js";
import { SINGLE_EDITOR_WORD_LIMIT, enforceWordLimit } from "../config/limits.js";

export const analyseRouter = Router();

analyseRouter.post("/analyse", (req, res) => {
  const { text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation } = req.body || {};

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string." });
  }

  try {
    enforceWordLimit(text, SINGLE_EDITOR_WORD_LIMIT, "Single-text editor");
  } catch (err) {
    return res.status(413).json({
      error: err.code,
      message: `${err.message} Use Long Document for larger material.`,
      wordCount: err.wordCount,
      wordLimit: err.wordLimit,
    });
  }

  try {
    const result = analyse({
      sourceText: text,
      styleFilters: styleFilters || {},
      rewriteIntensity,
      grammarIntensity,
      lengthPreference,
      naturalisation,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "ANALYSIS_FAILED", message: err.message });
  }
});
