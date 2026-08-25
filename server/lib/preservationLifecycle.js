import { classifyPreservationRelease } from "./preservationRelease.js";

export function preservationAction(preservation = {}) {
  const release = classifyPreservationRelease(preservation);
  return {
    release,
    attempt_repair: release.repair_required,
    return_complete_candidate: true,
    accepted_without_review: release.cleared,
  };
}

export function selectPreservationRepairCandidate(originalResult, repairedResult) {
  const repair = repairedResult?.preservation_repair || {};
  const originalRelease = classifyPreservationRelease(originalResult?.preservation || {});
  const repairedRelease = classifyPreservationRelease(repairedResult?.preservation || {});
  const repairedClearsPreservation = repair.preservation_cleared === true && !repairedRelease.repair_required;

  if (repairedClearsPreservation) {
    return {
      result: repairedResult,
      selected: "repaired",
      preservation_cleared: true,
      length_contract_satisfied: repair.length_contract_satisfied !== false,
      review_required: repairedRelease.review_required || repair.length_contract_satisfied === false,
      release: repairedRelease,
    };
  }

  return {
    result: originalResult,
    selected: "original",
    preservation_cleared: !originalRelease.repair_required,
    length_contract_satisfied: originalResult?.length_contract?.satisfied !== false,
    review_required: true,
    release: originalRelease,
  };
}

export function preservationCandidateStatus({ compliance, outputAcceptance, sourceRetainedForSafety = false, preservationRelease } = {}) {
  if (sourceRetainedForSafety) return "no_safe_edit_available";
  if (preservationRelease?.review_required || !compliance?.preservation_ok) return "preservation_review_required";
  if (compliance?.under_executed || compliance?.execution_passed === false) return "execution_review_required";
  if ((outputAcceptance?.reasons || []).includes("expand_length_contract_missed")) return "length_review_required";
  return "accepted";
}
