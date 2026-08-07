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
import { measureLanguageFingerprint } from "./languageFingerprint.js";
import { assessLanguageDeviation } from "./languageFamilyEngine.js";
import { getBuildInfo } from "./buildInfo.js";

const NATURALISATION_LEVELS = new Set(["off", "faithful", "aggressive"]);

function measuredGuidance(deviation, family) {
  return {
    measurement_version: family?.measurement_version || null,
    family_document_count: family?.measured_document_count || 0,
    family_evidence_strength: family?.evidence_strength || "pilot-insufficient",
    family_alignment_score: deviation?.family_alignment_score ?? null,
    high_priority_signals: (deviation?.signals || []).filter((s) => s.severity === "high"),
    other_signals: (deviation?.signals || []).filter((s) => s.severity !== "high"),
    recommendations: deviation?.recommendations || [],
    preserve_not_targeted: deviation?.preserve_not_targeted || [],
    instruction: "Use these corpus-derived signals selectively. Correct the measured structural/language problems that are actually present in this source; do not force every metric toward a median, and do not alter research voice, hedging, citation form, or technical terminology merely to match a frequency distribution.",
  };
}

export function analyse({ sourceText, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation }) {
  const protectedSpans = extractProtectedSpans(sourceText);
  const diagnostics = diagnose(sourceText);
  const plan = buildInterventionPlan(diagnostics, { rewriteIntensity, lengthPreference, naturalisation });
  const profileResolution = resolveProfile(styleFilters);
  const cadenceDeviation = assessCadenceDeviation(sourceText, styleFilters);
  const languageFingerprint = measureLanguageFingerprint(sourceText);
  const measuredLanguageFamily = profileResolution.measured_language_family || null;
  const languageDeviation = assessLanguageDeviation(languageFingerprint, measuredLanguageFamily);

  const effectiveStyleProfile = {
    ...profileResolution.effective,
    features: {
      ...profileResolution.effective.features,
      source_specific_measured_guidance: measuredGuidance(languageDeviation, measuredLanguageFamily),
    },
  };

  return {
    protectedSpans,
    diagnostics: {
      generic_phrasing: diagnostics.generic_phrasing,
      structural_monotony: diagnostics.structural_monotony,
      cohesion: diagnostics.cohesion,
      evidence_alignment: diagnostics.evidence_alignment,
      cadence_deviation: cadenceDeviation,
      language_fingerprint: languageFingerprint,
      measured_language_deviation: languageDeviation,
    },
    plan,
    measured_language_family: measuredLanguageFamily,
    style_profile_used: {
      requested: profileResolution.requested,
      effective: effectiveStyleProfile,
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

function nearSourceExamples(quality) {
  const examples = quality.near_source_examples || [];
  if (!examples.length) return "";
  return [
    "Examples of sentences still too structurally close to the source:",
    ...examples.map((item, i) => `${i + 1}. CURRENT: ${item.revised}\n   SOURCE: ${item.source}`),
  ].join("\n");
}

function qualityCorrectionBlock(quality) {
  const issueLines = (quality.reasons || []).map((reason) => `- ${reason}`).join("\n");
  return [
    "",
    "--- AGGRESSIVE REWRITE QUALITY CORRECTION ---",
    "The previous attempt failed the product's rewrite-depth and academic-register quality gate.",
    issueLines || "- The previous attempt did not meet the required quality profile.",
    nearSourceExamples(quality),
    "Rewrite again from the ORIGINAL source below, not from the previous attempt.",
    "Do not preserve a source sentence merely by changing punctuation, replacing one or two words, or splitting it into two sentences. If the same content words remain in roughly the same order, rebuild the sentence again.",
    "Change information packaging: vary which idea becomes the grammatical subject, move causes/conditions/qualifications to different positions, combine evidence and interpretation differently, and use genuinely different clause architecture.",
    "Keep the substantive transformation, but repair any overcorrection. Do not solve structural similarity by chopping the prose into strings of very short sentences.",
    "Use sustained postgraduate academic prose: formal but readable, with mostly medium and long sentences and occasional short emphasis. Merge neighbouring short statements where they express one analytical idea.",
    "Do not introduce second-person address, contractions, idioms, journalistic phrasing, slang, or conversational metaphors.",
    "Preserve the argument and broad-to-narrow academic progression, but not the source's sentence-by-sentence wording or clause sequence.",
    "No complete source sentence should survive verbatim unless it is a protected quotation or cannot be safely changed without altering a protected claim.",
    "Preserve every citation, number, quotation, technical term and factual relationship exactly. Do not add any fact or citation.",
  ].filter(Boolean).join("\n");
}

function finalRescueBlock(quality) {
  const issueLines = (quality.reasons || []).map((reason) => `- ${reason}`).join("\n");
  return [
    "",
    "--- FINAL ACADEMIC CADENCE AND STRUCTURE RESCUE ---",
    "A second rewrite still fails one or more quality checks.",
    issueLines || "- Residual cadence/register/structural problems remain.",
    nearSourceExamples(quality),
    "The user message for this pass contains both the ORIGINAL SOURCE and the CURRENT CANDIDATE REVISION.",
    "Repair the CURRENT CANDIDATE rather than reverting to source wording. Use the original only as the factual and citation-preservation authority.",
    "Where a candidate sentence still follows the source's content-word order, rebuild it from the underlying proposition: choose a different grammatical subject, alter clause order, redistribute information across neighbouring sentences, and reconstruct transitions. Do not preserve the sentence skeleton.",
    "If phrase overlap remains high, change information packaging and clause architecture while retaining all technical meaning.",
    "If the prose is choppy, merge adjacent short sentences that belong to the same analytical unit. A thesis paragraph should contain a mixture of medium and long sentences, some longer analytical sentences, and only occasional short sentences for emphasis.",
    "Maintain a postgraduate academic register throughout. No second-person address, contractions, colloquialisms, slogans, journalistic shorthand, or casual metaphors.",
    "Do not simply restore long source sentences. The objective is structurally fresh but academically sustained prose.",
    "Every citation, number, quotation, acronym, technical term and factual relationship from the original must remain correct and no new factual content may be introduced.",
  ].filter(Boolean).join("\n");
}

function qualityScore(q) {
  const shortPenalty = Math.max(0, (q.short_sentence_ratio || 0) - 0.27);
  const registerPenalty = (q.direct_address_introduced || 0) * 0.2 + (q.formality_risks_introduced || 0) * 0.15;
  const cadencePenalty = Math.max(0, 14 - (q.mean_sentence_length || 14)) / 14;
  const nearSourcePenalty = Math.max(0, (q.near_source_sentence_ratio || 0) - 0.30);
  return q.five_gram_overlap + q.unchanged_sentence_ratio + nearSourcePenalty + shortPenalty + registerPenalty + cadencePenalty;
}

function measuredLanguagePenalty(text, family) {
  if (!family) return 0;
  const fp = measureLanguageFingerprint(text);
  const deviation = assessLanguageDeviation(fp, family);
  if (!deviation.available || !Number.isFinite(deviation.family_alignment_score)) return 0;
  // Soft signal only: the pilot corpus should break ties between otherwise
  // similar failed candidates, never override preservation or rewrite-depth
  // gates and never force a passage to a single numeric style target.
  return (1 - deviation.family_alignment_score) * 0.25;
}

function candidateScore(q, text, family) {
  return qualityScore(q) + measuredLanguagePenalty(text, family);
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
  const measuredLanguageFamily = analysis.measured_language_family;

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

    const correctedIsBetter = correctedQuality.passed || candidateScore(correctedQuality, corrected.revised_text, measuredLanguageFamily) < candidateScore(transformationQuality, parsed.revised_text, measuredLanguageFamily);
    if (correctedIsBetter) {
      parsed = corrected;
      transformationQuality = correctedQuality;
    }
  }

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

    if (rescuedQuality.passed || candidateScore(rescuedQuality, rescued.revised_text, measuredLanguageFamily) < candidateScore(transformationQuality, parsed.revised_text, measuredLanguageFamily)) {
      parsed = rescued;
      transformationQuality = rescuedQuality;
    }
  }

  const preservation = auditPreservation(sourceText, parsed.revised_text, analysis.protectedSpans);
  const revisedLanguageFingerprint = measureLanguageFingerprint(parsed.revised_text);
  const revisedLanguageDeviation = assessLanguageDeviation(revisedLanguageFingerprint, measuredLanguageFamily);
  const sourceAlignment = analysis.diagnostics.measured_language_deviation?.family_alignment_score;
  const revisedAlignment = revisedLanguageDeviation?.family_alignment_score;
  const alignmentDelta = Number.isFinite(sourceAlignment) && Number.isFinite(revisedAlignment)
    ? Number((revisedAlignment - sourceAlignment).toFixed(3))
    : null;

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
    language_quality: {
      measurement_version: revisedLanguageFingerprint.measurement_version,
      family_measurement_version: measuredLanguageFamily?.measurement_version || null,
      family_document_count: measuredLanguageFamily?.measured_document_count || 0,
      source_fingerprint: analysis.diagnostics.language_fingerprint,
      source_deviation: analysis.diagnostics.measured_language_deviation,
      revised_fingerprint: revisedLanguageFingerprint,
      revised_deviation: revisedLanguageDeviation,
      family_alignment_delta: alignmentDelta,
      note: "Family alignment is a descriptive academic-language diagnostic from the measured pilot corpus, not an AI-authorship score and not a hard acceptance target.",
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
      near_source_sentence_gate: naturalisationLevel === "aggressive",
      measured_language_family_guidance: naturalisationLevel !== "off",
      measured_language_soft_candidate_selection: naturalisationLevel === "aggressive",
      final_academic_rescue: naturalisationLevel === "aggressive",
      human_family_measured_sources: humanCadence?.measuredSources ?? 0,
      measured_language_pilot_sources: measuredLanguageFamily?.measured_document_count ?? 0,
    },
    build: getBuildInfo(),
  };
}
