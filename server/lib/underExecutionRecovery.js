export const AUTHORIAL_EXECUTION_RECOVERY_LIMIT = 2;

function underCodes(compliance) {
  return Array.isArray(compliance?.under_execution_codes) ? compliance.under_execution_codes : [];
}

function hasConcreteExecutionDefect(compliance) {
  const codes = underCodes(compliance);
  if (!codes.length) return Boolean(compliance?.under_executed);
  return codes.some((code) => code !== "VISIBLE_CHANGE_FLOOR");
}

export function shouldAttemptAuthorialExecutionRecovery({
  modePolicy,
  compliance,
  sourceRetainedForSafety = false,
  overExecutionRecoveryUsed = false,
} = {}) {
  return Boolean(
    modePolicy?.authorial_reconstruction &&
    modePolicy?.requested_intensity === "deep" &&
    !sourceRetainedForSafety &&
    !overExecutionRecoveryUsed &&
    compliance?.preservation_ok &&
    compliance?.under_executed &&
    !compliance?.over_executed &&
    hasConcreteExecutionDefect(compliance)
  );
}

export function executionRecoveryAttemptSummary({ attempt, compliance, selected = false } = {}) {
  return {
    attempt: Number(attempt) || 0,
    selected: Boolean(selected),
    execution_status: compliance?.execution_status || null,
    execution_score: Number.isFinite(Number(compliance?.execution_score)) ? Number(compliance.execution_score) : null,
    preservation_ok: compliance?.preservation_ok ?? null,
    under_execution_codes: underCodes(compliance),
    changed_sentence_ratio: Number.isFinite(Number(compliance?.changed_sentence_ratio)) ? Number(compliance.changed_sentence_ratio) : null,
    structural_coverage: Number.isFinite(Number(compliance?.structural_coverage)) ? Number(compliance.structural_coverage) : null,
  };
}

function pct(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "not measured";
}

export function buildAuthorialExecutionRecoveryDirective({ attempt = 1, compliance } = {}) {
  const c = compliance || {};
  const codes = underCodes(c);
  const reasons = Array.isArray(c.under_execution_reasons) ? c.under_execution_reasons : [];
  const planned = c.planned || {};

  return [
    "",
    "--- DEEP AUTHORIAL EXECUTION RECOVERY ---",
    `Recovery attempt ${Number(attempt) || 1}. The previous Deep Authorial candidate under-executed concrete diagnosed work. Do not treat a concrete execution failure as a safety-preserving success.`,
    "The ORIGINAL SOURCE below remains the factual authority. Preserve semantic and evidential fidelity: argument, claims, citations, quotations, numbers, variables, methods, technical terms, qualifications, epistemic strength, study stage and factual relationships.",
    "Those preservation constraints protect intellectual content; they do NOT require preserving source sentence wording, sentence boundaries, clause order or paragraph packaging when the supplied plan calls for reconstruction.",
    `Under-execution codes: ${codes.length ? codes.join(", ") : "unspecified"}.`,
    reasons.length ? `Observed execution defects:\n${reasons.map((reason) => `- ${reason}`).join("\n")}` : "Observed execution defects: the prior candidate did not materially realise the planned structural work.",
    `Planner scope snapshot: total=${Number(planned.total || 0)}, KEEP=${Number(planned.keep || 0)}, concrete substantive=${Number(planned.substantive || 0)}, DISCOURSE_REPACKAGE=${Number(planned.discourseRepackage || 0)}.`,
    `Previous execution measurements: intervention coverage=${pct(c.intervention_coverage)}, structural coverage=${pct(c.structural_coverage)}, visibly changed sentences=${pct(c.changed_sentence_ratio)}, minimum plausibility floor=${pct(c.minimum_changed_sentence_ratio)}.`,
    "Visible-change measurements are safeguards and diagnostic evidence, not rewrite quotas. Never perform another pass solely to raise the percentage of changed sentences.",
    "Repair the concrete execution defect. If discourse reconstruction is planned, rebuild reasoning presentation at paragraph level first, then restructure, split, merge or redistribute propositions only where warranted.",
    "Do not become reckless in response to this correction: no invented facts or citations, no changed result directions, no altered variables or methods, and no loss of meaningful scholarly qualifications.",
  ].join("\n");
}
