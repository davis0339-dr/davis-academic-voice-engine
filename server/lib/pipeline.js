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
  if (typeof parsed.revised_text !== "string" || parsed.revised_text.length === 0) errors.push("revised_text missing or empty");
  if (!parsed.edit_summary || typeof parsed.edit_summary !== "object") {
    errors.push("edit_summary missing");
  } else {
    for (const key of ["kept", "micro_edits", "sentence_restructures", "split_or_merge", "paragraph_reorders"]) {
      if (typeof parsed.edit_summary[key] !== "number") errors.push(`edit_summary.${key} missing or not a number`);
    }
    if (!Array.isArray(parsed.edit_summary.flags_for_author)) errors.push("edit_summary.flags_for_author missing or not an array");
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
  const issueLines = (quality.reasons || []).map((reason) => `- ${reason}`).join("\n");
  return [
    "",
    "--- AGGRESSIVE REWRITE QUALITY CORRECTION ---",
    "The previous attempt failed the product's rewrite-depth and academic-register quality gate.",
    issueLines || "- The previous attempt did not meet the required quality profile.",
    "Rewrite again from the ORIGINAL source below, not from the previous attempt.",
    "Keep the substantive transformation, but repair any overcorrection. Do not solve structural similarity by chopping the prose into strings of very short sentences.",
    "Use sustained postgraduate academic prose: formal but readable, with mostly medium and long sentences and occasional short emphasis. Merge neighbouring short statements where they express one analytical idea.",
    "Do not introduce second-person address, contractions, idioms, journalistic phrasing, slang, or conversational metaphors.",
    "Reconstruct syntax rather than merely swapping vocabulary: vary clause order, grammatical subject, sentence boundaries and paragraph flow, while preserving the argument and the broad-to-narrow academic progression.",
    "No complete source sentence should survive verbatim unless it is a protected quotation or cannot be safely changed without altering a protected claim.",
    "Preserve every citation, number, quotation, technical term and factual relationship exactly. Do not add any fact or citation.",
  ].join("\n");
}

function finalRescueBlock(quality) {
  const issueLines = (quality.reasons || []).map((reason) => `- ${reason}`).join("\n");
  return [
    "",
    "--- FINAL ACADEMIC CADENCE RESCUE ---",
    "A second rewrite is already substantially different from the source but still fails one or more quality checks.",
    issueLines || "- Residual cadence/register problems remain.",
    "The user message for this pass contains both the ORIGINAL SOURCE and the CURRENT CANDIDATE REVISION.",
    "Repair the CURRENT CANDIDATE rather than reverting to the source wording. Use the original only as the factual and citation-preservation authority.",
    "If phrase overlap remains high, change information packaging and clause architecture while retaining all technical meaning: vary which idea carries the grammatical subject, move qualification clauses, combine or separate evidence and interpretation differently, and rebuild transitions.",
    "If the prose is choppy, merge adjacent short sentences that belong to the same analytical unit. A normal thesis paragraph should contain a mixture of roughly 15-35 word sentences, some longer analytical sentences, and only occasional genuinely short sentences for emphasis.",
    "Maintain a postgraduate academic register throughout. No second-person address, contractions, colloquialisms, slogans, journalistic shorthand, or casual metaphors.",
    "Do not simply restore long source sentences. The objective is structurally fresh but academically sustained prose.",
    "Every citation, number, quotation, acronym, technical term and factual relationship from the original must remain correct and no new factual content may be introduced.",
  ].join("\n");
}

function qualityScore(q) {
  const shortPenalty = Math.max(0, (q.short_sentence_ratio || 0) - 0.27);
  const registerPenalty = (q.direct_address_introduced || 0) * 0.2 + (q.formality_risks_introduced || 0) * 0.15;
  const cadencePenalty = Math.max(0, 14 - (q.mean_sentence_length || 14)) / 14;
  return q.five_gram_overlap + q.unchanged_sentence_ratio + shortPenalty + registerPenalty + cadencePenalty;
}

function qualityOptions(analysis, humanCadence) {
  return {
    humanCadence,
    protectedSpans: analysis.protectedSpans,
  };
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
  const qOptions = qualityOptions(analysis, humanCadence);

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
  let transformationQuality = assessTransformationQuality(sourceText, parsed.revised_text, naturalisationLevel, qOptions);
  let qualityRetryUsed = false;
  let rescueRetryUsed = false;
  let firstAttemptQuality = null;
  let preRescueQuality = null;

  if (naturalisationLevel === "aggressive" && !transformationQuality.passed) {
    firstAttemptQuality = transformationQuality;
    const corrected = await runModelPass({
      systemPrompt: systemPrompt + qualityCorrectionBlock(transformationQuality),
      sourceText,
    });
    const correctedQuality = assessTransformationQuality(sourceText, corrected.revised_text, naturalisationLevel, qOptions);
    qualityRetryUsed = true;

    const correctedIsBetter = correctedQuality.passed || qualityScore(correctedQuality) < qualityScore(transformationQuality);
    if (correctedIsBetter) {
      parsed = corrected;
      transformationQuality = correctedQuality;
    }
  }

  // One final repair pass is reserved for the real-world failure mode seen
  // in long thesis sections: the text is different enough, but the model has
  // achieved that difference by over-segmenting or by retaining too much
  // unprotected phrase structure. The rescue pass edits the best candidate
  // while keeping the original alongside it as the factual authority.
  if (naturalisationLevel === "aggressive" && !transformationQuality.passed) {
    preRescueQuality = transformationQuality;
    const candidateText = parsed.revised_text;
    const rescuePayload = [
      "ORIGINAL SOURCE (factual/citation authority):",
      sourceText,
      "",
      "CURRENT CANDIDATE REVISION (repair this prose; do not merely copy the source):",
      candidateText,
    ].join("\n");

    const rescued = await runModelPass({
      systemPrompt: systemPrompt + finalRescueBlock(transformationQuality),
      sourceText: rescuePayload,
    });
    const rescuedQuality = assessTransformationQuality(sourceText, rescued.revised_text, naturalisationLevel, qOptions);
    rescueRetryUsed = true;

    if (rescuedQuality.passed || qualityScore(rescuedQuality) < qualityScore(transformationQuality)) {
      parsed = rescued;
      transformationQuality = rescuedQuality;
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
      rescue_retry_used: rescueRetryUsed,
      first_attempt: firstAttemptQuality,
      pre_rescue_attempt: preRescueQuality,
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
      academic_register_gate: naturalisationLevel === "aggressive",
      protected_span_adjusted_overlap: naturalisationLevel === "aggressive",
      final_academic_rescue: naturalisationLevel === "aggressive",
      human_family_measured_sources: humanCadence?.measuredSources ?? 0,
    },
    build: getBuildInfo(),
  };
}
