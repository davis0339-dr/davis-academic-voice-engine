// Orchestrates Passes A-F end to end. This is the one production path
// used by both the demo and arbitrary user input.

import { extractProtectedSpans } from "./protect.js";
import { diagnose } from "./diagnostics.js";
import { buildInterventionPlan } from "./planner.js";
import { resolveProfile } from "./styleProfileStore.js";
import { buildSystemPrompt } from "./promptContract.js";
import { auditPreservation } from "./preservation.js";
import { llmProvider } from "./llmProvider.js";
import { assessCadenceDeviation } from "./cadenceDeviation.js";
import { assessTransformationQuality } from "./transformationQuality.js";
import { getBuildInfo } from "./buildInfo.js";

const NATURALISATION_LEVELS = new Set(["off", "faithful", "aggressive"]);

export function analyse({ sourceText, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation }) {
  const protectedSpans = extractProtectedSpans(sourceText);
  const diagnostics = diagnose(sourceText);
  const plan = buildInterventionPlan(diagnostics, { rewriteIntensity, lengthPreference, naturalisation });
  const profileResolution = resolveProfile(styleFilters);
  const cadenceDeviation = assessCadenceDeviation(sourceText, styleFilters);

  return {
    protectedSpans,
    diagnostics: {
      generic_phrasing: diagnostics.generic_phrasing,
      structural_monotony: diagnostics.structural_monotony,
      cohesion: diagnostics.cohesion,
      evidence_alignment: diagnostics.evidence_alignment,
      cadence_deviation: cadenceDeviation,
    },
    plan,
    style_profile_used: {
      requested: profileResolution.requested,
      effective: profileResolution.effective,
      fallback_applied: profileResolution.fallback_applied,
      evidence_strength: profileResolution.evidence_strength,
      message: profileResolution.message,
    },
  };
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

export function sanitiseProse(text) {
  let out = text;
  out = out.replace(/\s*[—–]\s*/g, ", ");
  out = out.replace(/,\s*,/g, ",");
  out = out.replace(/\s+,/g, ",").replace(/,\s*([.;:])/g, "$1");
  return out;
}

function validateShape(parsed) {
  const errors = [];
  if (typeof parsed.revised_text !== "string" || parsed.revised_text.length === 0) {
    errors.push("revised_text missing or empty");
  }
  if (!parsed.edit_summary || typeof parsed.edit_summary !== "object") {
    errors.push("edit_summary missing");
  } else {
    for (const key of ["kept", "micro_edits", "sentence_restructures", "split_or_merge", "paragraph_reorders"]) {
      if (typeof parsed.edit_summary[key] !== "number") {
        errors.push(`edit_summary.${key} missing or not a number`);
      }
    }
    if (!Array.isArray(parsed.edit_summary.flags_for_author)) {
      errors.push("edit_summary.flags_for_author missing or not an array");
    }
  }
  return errors;
}

async function runModelPass({ systemPrompt, sourceText }) {
  const llmResult = await llmProvider.callAnthropic({
    system: systemPrompt,
    messages: [{ role: "user", content: sourceText }],
    maxTokens: 4096,
  });

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(llmResult.text));
  } catch (e) {
    const err = new Error(`Model did not return valid JSON: ${e.message}`);
    err.rawResponse = llmResult.text;
    err.code = "INVALID_MODEL_RESPONSE";
    throw err;
  }

  const shapeErrors = validateShape(parsed);
  if (shapeErrors.length > 0) {
    const err = new Error(`Model response failed schema validation: ${shapeErrors.join("; ")}`);
    err.rawResponse = parsed;
    err.code = "SCHEMA_VALIDATION_FAILED";
    throw err;
  }

  parsed.revised_text = sanitiseProse(parsed.revised_text);
  return parsed;
}

function qualityCorrectionBlock(quality) {
  return [
    "",
    "--- AGGRESSIVE REWRITE QUALITY CORRECTION ---",
    "The prior attempt was still too close to the source to satisfy the user's selected aggressive rewrite mode.",
    `Measured five-word phrase overlap: ${(quality.five_gram_overlap * 100).toFixed(1)}%.`,
    `Measured verbatim-source-sentence retention: ${(quality.unchanged_sentence_ratio * 100).toFixed(1)}%.`,
    "Rewrite again from the ORIGINAL source below, not from the previous attempt.",
    "Reconstruct the syntax of every non-protected sentence. Change clause order, grammatical subject, sentence boundaries, and paragraph flow where useful. Do not merely substitute synonyms or split one long sentence into two while retaining the same wording.",
    "No complete source sentence should survive verbatim unless it is itself a protected quotation or cannot be safely changed without altering a protected claim. Preserve every citation, number, quotation, technical term and factual relationship exactly.",
    "Keep the prose academically defensible and natural. Do not invent information and do not manufacture errors.",
  ].join("\n");
}

function qualityScore(q) {
  return q.five_gram_overlap + q.unchanged_sentence_ratio;
}

export async function rewrite({
  sourceText,
  styleFilters,
  rewriteIntensity,
  grammarIntensity,
  lengthPreference,
  naturalisation,
  precedingContext,
  documentGlossary,
}) {
  const naturalisationLevel = NATURALISATION_LEVELS.has(naturalisation) ? naturalisation : "faithful";
  const analysis = analyse({
    sourceText,
    styleFilters,
    rewriteIntensity,
    grammarIntensity,
    lengthPreference,
    naturalisation: naturalisationLevel,
  });

  const humanCadence = analysis.diagnostics.cadence_deviation?.family || null;

  const systemPrompt = buildSystemPrompt({
    styleProfile: analysis.style_profile_used.effective,
    protectedSpans: analysis.protectedSpans,
    plan: analysis.plan,
    grammarIntensity: grammarIntensity || "standard",
    precedingContext,
    documentGlossary,
    humanCadence,
    naturalisation: naturalisationLevel,
  });

  let parsed = await runModelPass({ systemPrompt, sourceText });
  let transformationQuality = assessTransformationQuality(sourceText, parsed.revised_text, naturalisationLevel);
  let qualityRetryUsed = false;
  let firstAttemptQuality = null;

  // Aggressive mode has an explicit rewrite-depth acceptance gate. One
  // corrective model pass is allowed when the first answer is substantially
  // the same prose. We keep whichever pass is objectively further from the
  // source by the deterministic overlap audit; this is about rewrite depth,
  // not detector evasion.
  if (naturalisationLevel === "aggressive" && !transformationQuality.passed) {
    firstAttemptQuality = transformationQuality;
    const correctivePrompt = systemPrompt + qualityCorrectionBlock(transformationQuality);
    const corrected = await runModelPass({ systemPrompt: correctivePrompt, sourceText });
    const correctedQuality = assessTransformationQuality(sourceText, corrected.revised_text, naturalisationLevel);
    qualityRetryUsed = true;

    if (qualityScore(correctedQuality) <= qualityScore(transformationQuality)) {
      parsed = corrected;
      transformationQuality = correctedQuality;
    }
  }

  const preservation = auditPreservation(sourceText, parsed.revised_text, analysis.protectedSpans);

  return {
    revised_text: parsed.revised_text,
    style_profile_used: analysis.style_profile_used,
    edit_summary: parsed.edit_summary,
    intervention_plan_summary: analysis.plan.summary,
    preservation,
    transformation_quality: {
      ...transformationQuality,
      corrective_retry_used: qualityRetryUsed,
      first_attempt: firstAttemptQuality,
    },
    diagnostics: analysis.diagnostics,
    model_notes: parsed.diagnostics_notes || "",
    naturalisation_applied: {
      level: naturalisationLevel,
      em_dash_ban: true,
      cadence_targeting: naturalisationLevel !== "off",
      syntactic_diversity: naturalisationLevel !== "off",
      texture_exemplar: naturalisationLevel === "aggressive",
      aggressive_keep_override: naturalisationLevel === "aggressive",
      transformation_quality_gate: naturalisationLevel === "aggressive",
      human_family_measured_sources: humanCadence?.measuredSources ?? 0,
    },
    build: getBuildInfo(),
  };
}
