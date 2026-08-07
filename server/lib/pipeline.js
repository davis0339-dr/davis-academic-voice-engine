// Orchestrates Passes A-F end to end. This is the one production path
// used by both the demo and arbitrary user input -- Section 18.2 forbids a
// separate hard-coded demo path, and this module is the only place
// /api/rewrite and /api/analyse are allowed to call into.

import { extractProtectedSpans } from "./protect.js";
import { diagnose } from "./diagnostics.js";
import { buildInterventionPlan } from "./planner.js";
import { resolveProfile } from "./styleProfileStore.js";
import { buildSystemPrompt } from "./promptContract.js";
import { auditPreservation } from "./preservation.js";
import { llmProvider } from "./llmProvider.js";

export function analyse({ sourceText, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference }) {
  const protectedSpans = extractProtectedSpans(sourceText);
  const diagnostics = diagnose(sourceText);
  const plan = buildInterventionPlan(diagnostics, { rewriteIntensity, lengthPreference });
  const profileResolution = resolveProfile(styleFilters);

  return {
    protectedSpans,
    diagnostics: {
      generic_phrasing: diagnostics.generic_phrasing,
      structural_monotony: diagnostics.structural_monotony,
      cohesion: diagnostics.cohesion,
      evidence_alignment: diagnostics.evidence_alignment,
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

export async function rewrite({ sourceText, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference }) {
  const analysis = analyse({ sourceText, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference });

  const systemPrompt = buildSystemPrompt({
    styleProfile: analysis.style_profile_used.effective,
    protectedSpans: analysis.protectedSpans,
    plan: analysis.plan,
    grammarIntensity: grammarIntensity || "standard",
  });

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

  const preservation = auditPreservation(sourceText, parsed.revised_text, analysis.protectedSpans);

  return {
    revised_text: parsed.revised_text,
    style_profile_used: analysis.style_profile_used,
    edit_summary: parsed.edit_summary,
    intervention_plan_summary: analysis.plan.summary,
    preservation,
    diagnostics: analysis.diagnostics,
    model_notes: parsed.diagnostics_notes || "",
  };
}
