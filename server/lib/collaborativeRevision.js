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

export function ensureCollaborativeReviewInputs({ sourceText, revisionPurpose, modelInputs } = {}) {
  if (normalizeRevisionPurpose(revisionPurpose) !== "collaborative") return [];
  const supplied = Array.isArray(modelInputs) ? modelInputs.slice(0, 8) : [];
  if (supplied.length) return supplied;

  const source = String(sourceText || "");
  const fallback = [];
  const hasCitation = /\([^()\n]{1,180}(?:19|20)\d{2}[a-z]?[^()\n]{0,80}\)|\b[A-Z][A-Za-z'’.-]+\s*\((?:19|20)\d{2}[a-z]?\)/.test(source);
  const hasCheckableNumber = /(?:[$£€₦]\s?\d|\b\d+(?:\.\d+)?%|\b(?:19|20)\d{2}\b)/.test(source);
  const isPlannedMixedMethods = /\bmixed[ -]methods?\b/i.test(source) && /\b(?:will|proposed|prospectus|purpose of this|aims? to|seeks? to)\b/i.test(source);
  const assertsLiteratureGap = /\b(?:(?:[A-Za-z][A-Za-z.-]*\s+){0,4}evidence\s+(?:remains|is)\s+(?:limited|scarce)|lack(?:s|ed|ing)? (?:integrated|contemporary|direct)?\s*evidence|research gap|remaining (?:problem|gap)|absence of (?:evidence|research)|has not been (?:examined|established|tested))\b/i.test(source);

  if (hasCitation && hasCheckableNumber) {
    fallback.push({
      id: "fallback-evidence-verification",
      kind: "evidence",
      location: "Dated quantitative and market-context claims",
      proposal: "Verify the manuscript's numerical claims, dates and market-coverage statements against the cited primary sources before submission.",
      reason: "These claims are checkable and may be time-sensitive; fluent wording does not establish that the values, periods or source interpretations remain accurate.",
      status: "verification_required",
      researcher_question: "Which primary-source records have you checked for each reported figure and date?",
      evidence_needed: "The cited primary tables, releases or datasets, including the relevant observation date and unit definition.",
    });
  }

  if (isPlannedMixedMethods) {
    fallback.push({
      id: "fallback-mixed-methods-design",
      kind: "researcher_question",
      location: "Mixed-methods design and integration plan",
      proposal: "Confirm the researcher-owned rationale for using an explanatory sequential mixed-methods design and the rule connecting quantitative results to interview sampling and questions.",
      reason: "The design is stated, but its intellectual justification and integration decisions must come from the researcher rather than from stylistic revision.",
      status: "researcher_confirmation_required",
      researcher_question: "Which quantitative findings will trigger qualitative follow-up, and how will those findings determine whom you interview and what you ask?",
      evidence_needed: "Researcher-confirmed design rationale and, where required, an appropriate mixed-methods methodological source.",
    });
  }

  if (assertsLiteratureGap) {
    fallback.push({
      id: "fallback-literature-gap-verification",
      kind: "evidence",
      location: "Claimed literature gap or lack of contemporary evidence",
      proposal: "Verify the literature-gap claim through a current, documented search rather than presenting limited or fragmented evidence as an established absence.",
      reason: "A gap statement is an evidential conclusion and needs a transparent basis, particularly when it defines the study's contribution.",
      status: "verification_required",
      researcher_question: "What search period, databases, keywords and inclusion boundaries support this literature-gap claim?",
      evidence_needed: "A current search record and directly relevant studies showing what is known, inconsistent or genuinely unexamined.",
    });
  }

  return fallback.slice(0, 8);
}

export function buildCollaborativeRevisionPromptBlock(revisionPurpose) {
  if (normalizeRevisionPurpose(revisionPurpose) === "fidelity") {
    return `--- REVISION PURPOSE: FIDELITY EDITOR ---
Revise only the intellectual content licensed by the source and supplied context. Do not propose or add new ideas, evidence, mechanisms, counterarguments, contextual claims or interpretations. additional_inputs must be an empty array.`;
  }

  return `--- REVISION PURPOSE: COLLABORATIVE REVISION ---
The submitted draft may be mixed-origin or machine-assisted. Do not infer authorship from fluency or style. Preserve the researcher's apparent intellectual position, evidence use, qualifications, boundaries and technical meaning, but do not preserve mechanical wording or formulaic structure merely because it is present.

The revised_text remains source-licensed prose. Never insert proposed material into revised_text. When the manuscript would materially benefit from an idea, evidence, mechanism, qualification, counterargument, clarification or greater depth that is not already licensed by the supplied material, record it in additional_inputs instead.

Each additional input must identify where it applies, what is proposed, why it matters, and whether it requires researcher confirmation or external verification. Phrase researcher_question as a direct, economical question when the researcher's own reasoning is needed. Describe evidence_needed without fabricating a citation, source, finding or fact. Return no more than eight high-value additions. Do not use additional_inputs for ordinary wording edits already handled in revised_text. Do not return an empty array merely because the prose is fluent: explicitly review dated quantitative claims, proposal-stage design choices and asserted literature gaps when they are present.`;
}
