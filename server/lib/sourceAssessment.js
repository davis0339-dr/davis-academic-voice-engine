// Pre-generation source assessment. This runs before rewrite-mode resolution so
// existing authorial texture can constrain intervention breadth rather than
// being discovered only after the model has already rewritten the document.

import { diagnose } from "./diagnostics.js";
import { assessCadenceDeviation } from "./cadenceDeviation.js";
import { measureLanguageFingerprint } from "./languageFingerprint.js";
import { assessLanguageDeviation } from "./languageFamilyEngine.js";
import { resolveProfile } from "./styleProfileStore.js";
import { assessAuthorialTexture } from "./authorialTexture.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function regularityLabel(score) {
  return score >= 0.66 ? "high" : score >= 0.34 ? "moderate" : "low";
}

function calibrateTextureWithDiscourseForensics(textureAssessment, forensics) {
  if (!textureAssessment || !forensics?.available) return textureAssessment;

  const baseRegularity = Number(textureAssessment.machine_pattern_regularity?.score || 0);
  const forensicRegularity = Number(forensics.score || 0);
  const machineLanguageRegularity = Number(textureAssessment.machine_pattern_regularity?.components?.modern_machine_language_pressure || 0);
  let calibratedRegularity = Math.max(baseRegularity, forensicRegularity, machineLanguageRegularity);
  if (machineLanguageRegularity >= 0.34 && forensicRegularity >= 0.34) calibratedRegularity = Math.max(calibratedRegularity, 0.68);
  if (calibratedRegularity <= baseRegularity + 0.001) {
    return {
      ...textureAssessment,
      discourse_regularisation_calibrated: false,
    };
  }

  const positiveEvidence = Number(
    textureAssessment.authorial_texture?.positive_evidence_score ??
    (Number(textureAssessment.score || 0) + baseRegularity * 0.42)
  );
  const calibratedTextureScore = clamp01(positiveEvidence - calibratedRegularity * 0.42);
  const textureLabel = calibratedTextureScore >= 0.68 ? "strong" : calibratedTextureScore >= 0.48 ? "mixed" : "weak";
  const legacyLabel = textureLabel === "strong" ? "strong_existing_texture" : textureLabel === "mixed" ? "mixed_existing_texture" : "weak_or_synthetic_texture";
  const expressivePriority = calibratedTextureScore >= 0.68 && calibratedRegularity <= 0.34
    ? "high"
    : calibratedTextureScore >= 0.48 && calibratedRegularity <= 0.66
      ? "medium"
      : "low";

  return {
    ...textureAssessment,
    score: Number(calibratedTextureScore.toFixed(3)),
    label: legacyLabel,
    preservation_priority: expressivePriority,
    recommended_breadth: expressivePriority === "high" ? "targeted" : expressivePriority === "medium" ? "selective" : "broad_if_diagnosed",
    authorial_texture: {
      ...(textureAssessment.authorial_texture || {}),
      score: Number(calibratedTextureScore.toFixed(3)),
      label: textureLabel,
      regularity_penalty: Number((calibratedRegularity * 0.42).toFixed(3)),
    },
    machine_pattern_regularity: {
      ...(textureAssessment.machine_pattern_regularity || {}),
      score: Number(calibratedRegularity.toFixed(3)),
      label: regularityLabel(calibratedRegularity),
      components: {
        ...(textureAssessment.machine_pattern_regularity?.components || {}),
        cross_paragraph_forensic_regularisation: Number(forensicRegularity.toFixed(3)),
      },
      evidence: {
        ...(textureAssessment.machine_pattern_regularity?.evidence || {}),
        discourse_regularity_forensics: forensics,
      },
      signals: [...new Set([
        ...(textureAssessment.machine_pattern_regularity?.signals || []),
        ...(forensics.signals || []).map((signal) => signal.forensic_id || signal.issue || signal.id).filter(Boolean),
      ])],
    },
    expressive_preservation: {
      priority: expressivePriority,
      basis: "authorial_texture_strength_minus_calibrated_cross_paragraph_regularisation",
    },
    discourse_regularisation_calibrated: true,
    calibration_note: "Cross-paragraph forensic regularity can reduce expressive preservation even when grammar, clarity and academic coherence are strong. Semantic preservation remains independent.",
  };
}

export function assessSourceBeforeRewrite({ text, styleFilters } = {}) {
  const diagnostics = diagnose(text || "");
  const cadenceDeviation = assessCadenceDeviation(text || "", styleFilters || {});
  const profileResolution = resolveProfile(styleFilters || {});
  const measuredLanguageFamily = profileResolution.measured_language_family || null;
  const fingerprint = measureLanguageFingerprint(text || "");
  const languageDeviation = assessLanguageDeviation(fingerprint, measuredLanguageFamily);
  const discourseRegularityForensics = diagnostics?.discourse_regularity_forensics || null;
  const rawTextureAssessment = assessAuthorialTexture({
    text,
    diagnostics,
    cadenceDeviation,
    languageDeviation,
  });
  const textureAssessment = calibrateTextureWithDiscourseForensics(rawTextureAssessment, discourseRegularityForensics);
  const authorialTexture = {
    ...textureAssessment,
    discourse_regularity_forensics: discourseRegularityForensics,
  };

  return {
    authorial_texture: authorialTexture,
    discourse_regularity_forensics: discourseRegularityForensics,
    diagnostics,
    cadence_deviation: cadenceDeviation,
    language_fingerprint: fingerprint,
    measured_language_deviation: languageDeviation,
    measured_language_family: measuredLanguageFamily,
    profile_resolution: profileResolution,
  };
}
