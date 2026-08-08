export const AUTHORIAL_EXECUTION_RECOVERY_LIMIT = 2;

export function shouldAttemptAuthorialExecutionRecovery({
  modePolicy,
  compliance,
  sourceRetainedForSafety = false,
  overExecutionRecoveryUsed = false,
} = {}) {
  return Boolean(
    modePolicy?.authorial_reconstruction &&
    !sourceRetainedForSafety &&
    !overExecutionRecoveryUsed &&
    compliance?.preservation_ok &&
    compliance?.under_executed &&
    !compliance?.over_executed
  );
}

export function executionRecoveryAttemptSummary({ attempt, compliance, selected = false } = {}) {
  return {
    attempt: Number(attempt) || 0,
    selected: Boolean(selected),
    execution_status: compliance?.execution_status || null,
    execution_score: Number.isFinite(Number(compliance?.execution_score)) ? Number(compliance.execution_score) : null,
    preservation_ok: compliance?.preservation_ok ?? null,
    under_execution_codes: Array.isArray(compliance?.under_execution_codes) ? compliance.under_execution_codes : [],
    changed_sentence_ratio: Number.isFinite(Number(compliance?.changed_sentence_ratio)) ? Number(compliance.changed_sentence_ratio) : null,
    structural_coverage: Number.isFinite(Number(compliance?.structural_coverage)) ? Number(compliance.structural_coverage) : null,
  };
}
