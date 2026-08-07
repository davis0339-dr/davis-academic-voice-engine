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
import { assessCadenceDeviation } from "./cadenceDeviation.js";
import { getBuildInfo } from "./buildInfo.js";

export function analyse({ sourceText, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference }) {
  const protectedSpans = extractProtectedSpans(sourceText);
  const diagnostics = diagnose(sourceText);
  const plan = buildInterventionPlan(diagnostics, { rewriteIntensity, lengthPreference });
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

// Deterministic surface-tell sanitiser. Some formatting rules are too
// important to leave to the model's discretion -- the em-dash ban is the
// clearest example: it is a top machine-writing tell, the product owner
// explicitly dislikes it, and the model intermittently reintroduces it
// despite the prompt instruction. So we guarantee it in code rather than
// hope. This only touches punctuation the model produced; it never edits
// protected spans (citations/numbers/quotes contain no em-dashes), so the
// preservation audit still runs on the sanitised text and stays valid.
export function sanitiseProse(text) {
  let out = text;
  // Em-dash / spaced en-dash used as a clause connector -> comma. Handles
  // "word—word", "word —word", "word— word", "word — word" uniformly.
  out = out.replace(/\s*[—–]\s*/g, ", ");
  // Collapse any ", ," produced when an em-dash sat next to existing comma.
  out = out.replace(/,\s*,/g, ",");
  // Guard against a stray leading/trailing comma introduced at an edge.
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

export async function rewrite({
  sourceText,
  styleFilters,
  rewriteIntensity,
  grammarIntensity,
  lengthPreference,
  // User-facing control: how hard to naturalise toward the human corpus
  // cadence, and how much wording latitude to take. "off" | "faithful"
  // (default) | "aggressive". See NATURALISATION_FIDELITY in promptContract.js.
  naturalisation,
  // Optional, used only by the long-document job pipeline (Phase 3,
  // server/lib/jobStore.js) so a chunk's revision flows naturally from the
  // chunk before it and stays terminology-consistent with the rest of the
  // document. Never used by /api/rewrite's single-paragraph path. Neither
  // field is protected-span-checked or preservation-audited -- they are
  // context for the model, not part of the text being revised.
  precedingContext,
  documentGlossary,
}) {
  const analysis = analyse({ sourceText, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference });

  // The naturalisation target: the real measured sentence-length range and
  // variation (SD) of the resolved human corpus family. Passing this makes
  // the rewrite aim for the human distribution's burstiness rather than
  // producing smooth, uniform prose -- the honest mechanism behind any
  // reduction in machine-writing signal. Pulled from the same cadence
  // deviation assessment already computed in analyse().
  const humanCadence = analysis.diagnostics.cadence_deviation?.family || null;

  const systemPrompt = buildSystemPrompt({
    styleProfile: analysis.style_profile_used.effective,
    protectedSpans: analysis.protectedSpans,
    plan: analysis.plan,
    grammarIntensity: grammarIntensity || "standard",
    precedingContext,
    documentGlossary,
    humanCadence,
    naturalisation,
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

  // Guarantee the em-dash ban deterministically, whatever the model did.
  parsed.revised_text = sanitiseProse(parsed.revised_text);

  const preservation = auditPreservation(sourceText, parsed.revised_text, analysis.protectedSpans);

  const naturalisationLevel = NATURALISATION_LEVELS.has(naturalisation) ? naturalisation : "faithful";

  return {
    revised_text: parsed.revised_text,
    style_profile_used: analysis.style_profile_used,
    edit_summary: parsed.edit_summary,
    intervention_plan_summary: analysis.plan.summary,
    preservation,
    diagnostics: analysis.diagnostics,
    model_notes: parsed.diagnostics_notes || "",
    // Verifiable proof of what this specific request actually ran, so the
    // running app can prove its own behaviour instead of asking the user
    // to trust a chat transcript or a git log they can't see live.
    naturalisation_applied: {
      level: naturalisationLevel,
      em_dash_ban: true, // sanitiseProse runs unconditionally, all levels
      cadence_targeting: naturalisationLevel !== "off",
      syntactic_diversity: naturalisationLevel !== "off",
      texture_exemplar: naturalisationLevel === "aggressive",
      human_family_measured_sources: humanCadence?.measuredSources ?? 0,
    },
    build: getBuildInfo(),
  };
}

const NATURALISATION_LEVELS = new Set(["off", "faithful", "aggressive"]);
