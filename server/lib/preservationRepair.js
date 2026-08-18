import { llmProvider } from "./llmProvider.js";
import { parseStructuredResponseText } from "./modelResponse.js";
import { extractProtectedSpans } from "./protect.js";
import { auditPreservation } from "./preservation.js";
import { modelOutputTokenBudget } from "./pipeline.js";

function repairPrompt() {
  return [
    "You are repairing factual and evidential preservation defects in an already completed academic revision.",
    "Work on the CURRENT CANDIDATE. Do not regenerate the document from the original and do not flatten its revised cadence or argument presentation.",
    "Use the ORIGINAL SOURCE only as the authority for meaning, citations, numbers, quotations, technical terms, qualifications, research stage and factual relationships.",
    "Repair rhetorical and semantic losses as well as factual defects. Restore missing topic/framing work, transitions, evidence interpretation, contrast, concession, synthesis, qualifications and scope conditions in fresh, natural wording rather than copying mechanically.",
    "Restore the source degree of modality, certainty, causality, magnitude, direction, comparison, generalisability and temporality. Do not replace a qualified relationship with a stronger simplified proposition.",
    "When evidence survived but its explanation of relevance was lost, reconstruct that interpretive function from the source. When a logical connector carried a balanced relationship, keep that relationship explicit even if sentence boundaries change.",
    "This is a TARGETED MINIMUM-CHANGE repair. Use the detailed defect report and edit only the candidate location needed to correct each listed defect. Candidate sentences and paragraphs not implicated by a listed defect must remain verbatim.",
    "Restore every missing or altered protected item in its logically correct location. Remove any claim, number or citation that the candidate introduced without source support.",
    "Preserve proposal/future orientation exactly when the source describes planned research. Do not convert a prospectus into a completed study.",
    "Do not add new evidence, mechanisms, interpretations or references. Do not undo legitimate sentence restructuring merely to increase lexical overlap with the source. Do not replace the candidate wholesale with the source; that is a failed repair.",
    "Return exactly one JSON object and nothing else: {\"revised_text\":\"the fully repaired candidate\"}",
  ].join("\n");
}

function repairPayload(sourceText, candidateResult, protectedSpans) {
  const rhetoricalReport = candidateResult?.preservation?.rhetorical_semantic_preservation || null;
  return [
    "PRESERVATION DEFECTS DETECTED:",
    JSON.stringify(candidateResult?.preservation?.warnings || [], null, 2),
    "",
    "DETAILED RHETORICAL/SEMANTIC DEFECT REPORT (supporting evidence; role-marker differences alone are not proof of loss):",
    JSON.stringify(rhetoricalReport, null, 2),
    "",
    "PROTECTED SOURCE MATERIAL:",
    JSON.stringify(protectedSpans, null, 2),
    "",
    "ORIGINAL SOURCE (authority for facts, meaning and research stage):",
    sourceText,
    "",
    "CURRENT CANDIDATE (repair this text; retain its defensible restructuring):",
    candidateResult?.revised_text || "",
  ].join("\n");
}

export async function repairPreservationCandidate({ sourceText, candidateResult, revisionPurpose = "fidelity", lengthPreference = "auto" } = {}) {
  const source = String(sourceText || "");
  const candidate = String(candidateResult?.revised_text || "");
  if (!source || !candidate) {
    const error = new Error("Preservation repair requires both the original source and a completed candidate.");
    error.code = "PRESERVATION_REPAIR_INPUT_REQUIRED";
    throw error;
  }

  const protectedSpans = extractProtectedSpans(source);
  const response = await llmProvider.callAnthropic({
    system: repairPrompt(),
    messages: [{ role: "user", content: repairPayload(source, candidateResult, protectedSpans) }],
    maxTokens: modelOutputTokenBudget(source, revisionPurpose),
  });

  if (response.raw?.stop_reason === "max_tokens") {
    const error = new Error("Preservation repair was truncated before the candidate was complete.");
    error.code = "PRESERVATION_REPAIR_TRUNCATED";
    throw error;
  }

  const parsed = parseStructuredResponseText(response.text);
  const revisedText = parsed.ok && typeof parsed.parsed?.revised_text === "string"
    ? parsed.parsed.revised_text.trim()
    : "";
  if (!revisedText) {
    const error = new Error("Preservation repair did not return a valid revised_text value.");
    error.code = "INVALID_PRESERVATION_REPAIR_RESPONSE";
    throw error;
  }

  const preservation = auditPreservation(source, revisedText, protectedSpans, { lengthPreference });
  const passed = Boolean(
    preservation.numbers_ok &&
    preservation.citations_ok &&
    preservation.technical_terms_ok &&
    preservation.quotes_ok &&
    preservation.study_stage_ok !== false &&
    preservation.researcher_voice_ok !== false &&
    preservation.document_structure_ok !== false &&
    preservation.rhetorical_semantic_ok !== false &&
    !preservation.new_factual_claims_detected
  );

  return {
    ...candidateResult,
    revised_text: revisedText,
    preservation,
    preservation_repair: {
      attempted: true,
      passed,
      source_regeneration_avoided: true,
      retained_candidate_metadata: true,
    },
  };
}

