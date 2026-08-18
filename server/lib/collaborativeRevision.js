const REVISION_PURPOSES = new Set(["fidelity", "collaborative"]);
const ADDITION_KINDS = new Set([
  "idea",
  "evidence",
  "depth",
  "clarification",
  "mechanism",
  "qualification",
  "counterargument",
  "researcher_question",
]);
const ADDITION_STATUSES = new Set(["researcher_confirmation_required", "verification_required"]);

function cleanString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeRevisionPurpose(value) {
  return REVISION_PURPOSES.has(value) ? value : "fidelity";
}

export function normalizeAdditionalInputs(value, revisionPurpose) {
  if (normalizeRevisionPurpose(revisionPurpose) !== "collaborative" || !Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((item, index) => {
      const kind = cleanString(item?.kind, 80).toLowerCase();
      const status = cleanString(item?.status, 80).toLowerCase();
      return {
        id: cleanString(item?.id, 80) || `additional-input-${index + 1}`,
        kind: ADDITION_KINDS.has(kind) ? kind : "researcher_question",
        location: cleanString(item?.location, 300),
        proposal: cleanString(item?.proposal, 1600),
        reason: cleanString(item?.reason, 1200),
        status: ADDITION_STATUSES.has(status) ? status : "researcher_confirmation_required",
        researcher_question: cleanString(item?.researcher_question, 1200),
        evidence_needed: cleanString(item?.evidence_needed, 1200),
      };
    })
    .filter((item) => item.proposal);
}

export function buildCollaborativeRevisionPromptBlock(revisionPurpose) {
  if (normalizeRevisionPurpose(revisionPurpose) === "fidelity") {
    return `--- REVISION PURPOSE: FIDELITY EDITOR ---
Revise only the intellectual content licensed by the source and supplied context. Do not propose or add new ideas, evidence, mechanisms, counterarguments, contextual claims or interpretations. additional_inputs must be an empty array.`;
  }

  return `--- REVISION PURPOSE: COLLABORATIVE REVISION ---
The submitted draft may be mixed-origin or machine-assisted. Do not infer authorship from fluency or style. Preserve the researcher's apparent intellectual position, evidence use, qualifications, boundaries and technical meaning, but do not preserve mechanical wording or formulaic structure merely because it is present.

The revised_text remains source-licensed prose. Never insert proposed material into revised_text. When the manuscript would materially benefit from an idea, evidence, mechanism, qualification, counterargument, clarification or greater depth that is not already licensed by the supplied material, record it in additional_inputs instead.

Each additional input must identify where it applies, what is proposed, why it matters, and whether it requires researcher confirmation or external verification. Phrase researcher_question as a direct, economical question when the researcher's own reasoning is needed. Describe evidence_needed without fabricating a citation, source, finding or fact. Return no more than eight high-value additions. Do not use additional_inputs for ordinary wording edits already handled in revised_text.`;
}
