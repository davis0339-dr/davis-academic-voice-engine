import { Router } from "express";
import { analyse } from "../lib/pipeline.js";
import { assessSourceBeforeRewrite } from "../lib/sourceAssessment.js";
import { resolveRewriteModePolicy } from "../lib/rewriteModePolicy.js";
import { deriveInterventionAuthority } from "../lib/interventionAuthority.js";
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
    const sourceAssessment = assessSourceBeforeRewrite({ text, styleFilters: styleFilters || {} });
    const modePolicy = resolveRewriteModePolicy({
      rewriteIntensity,
      naturalisation,
      authorialTexture: sourceAssessment.authorial_texture,
    });

    const result = analyse({
      sourceText: text,
      styleFilters: styleFilters || {},
      rewriteIntensity: modePolicy.effective_intensity,
      grammarIntensity,
      lengthPreference,
      naturalisation: modePolicy.effective_naturalisation,
    });

    const authority = deriveInterventionAuthority({
      planSummary: result.plan?.summary,
      authorialTexture: sourceAssessment.authorial_texture,
      requestedIntensity: modePolicy.requested_intensity,
      requestedNaturalisation: modePolicy.requested_naturalisation,
      effectiveIntent: result.plan?.intent?.effective,
    });

    const discourseRegularityForensics = sourceAssessment.diagnostics?.discourse_regularity_forensics || null;
    const machineLanguageForensics = sourceAssessment.diagnostics?.machine_language_forensics || null;

    res.json({
      ...result,
      authorial_texture: sourceAssessment.authorial_texture,
      discourse_regularity_forensics: discourseRegularityForensics,
      machine_language_forensics: machineLanguageForensics,
      intervention_authority: authority,
      rewrite_mode_policy: modePolicy,
      source_assessment: {
        authorial_texture: sourceAssessment.authorial_texture,
        discourse_regularity_forensics: discourseRegularityForensics,
        machine_language_forensics: machineLanguageForensics,
        cadence_deviation: sourceAssessment.cadence_deviation,
        measured_language_deviation: sourceAssessment.measured_language_deviation,
        note: "Pre-generation assessment separates surface quality, authorial texture and cross-paragraph discourse regularity. It constrains rewrite breadth without claiming to establish authorship.",
      },
    });
  } catch (err) {
    res.status(500).json({ error: "ANALYSIS_FAILED", message: err.message });
  }
});
