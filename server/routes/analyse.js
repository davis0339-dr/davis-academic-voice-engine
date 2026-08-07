import { Router } from "express";
import { analyse } from "../lib/pipeline.js";

export const analyseRouter = Router();

analyseRouter.post("/analyse", (req, res) => {
  const { text, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference } = req.body || {};

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`text` is required and must be a non-empty string." });
  }

  try {
    const result = analyse({
      sourceText: text,
      styleFilters: styleFilters || {},
      rewriteIntensity,
      grammarIntensity,
      lengthPreference,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "ANALYSIS_FAILED", message: err.message });
  }
});
