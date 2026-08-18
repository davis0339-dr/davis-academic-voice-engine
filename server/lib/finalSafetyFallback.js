import { extractProtectedSpans } from "./protect.js";
import { auditPreservation } from "./preservation.js";
import { assessTransformationQuality } from "./transformationQuality.js";
import { assessIterativeRegularisation } from "./iterativeRewriteGuard.js";

function planUnitCount(result) {
  return Object.values(result?.intervention_plan_summary || {})
    .reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function retainSourceAfterPreservationFailure({ sourceText, result, rewriteLineage } = {}) {
  const source = String(sourceText || "");
  const protectedSpans = extractProtectedSpans(source);
  const units = planUnitCount(result);

  return {
    ...result,
    revised_text: source,
    attempted_edit_summary: result?.edit_summary || null,
    rejected_preservation_candidate: {
      preservation: result?.preservation || null,
      edit_summary: result?.edit_summary || null,
      revised_text_included: false,
      note: "The unsafe candidate text is intentionally omitted from the final response payload so it cannot be mistaken for an approved revision.",
    },
    edit_summary: {
      kept: units,
      micro_edits: 0,
      sentence_restructures: 0,
      split_or_merge: 0,
      paragraph_reorders: 0,
      flags_for_author: [
        "The generated revision failed factual or evidential preservation after recovery. The source was returned unchanged and is explicitly marked as a non-edit result.",
      ],
    },
    transformation_quality: assessTransformationQuality(source, source, "off", { protectedSpans }),
    iterative_rewrite_quality: assessIterativeRegularisation({
      sourceText: source,
      candidateText: source,
      rewriteLineage,
    }),
    preservation: auditPreservation(source, source, protectedSpans),
    safety_fallback: {
      source_retained: true,
      successful_revision: false,
      reason_code: "PRESERVATION_FAILURE_AFTER_RECOVERY",
      reason: "The generated candidate still failed factual or evidential preservation after the recovery attempt. Returning the unchanged source is a transparent non-edit result, not a successful revision.",
    },
  };
}
