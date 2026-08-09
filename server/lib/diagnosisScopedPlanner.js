// Scope-safe wrapper around intent-discourse-v4.
// The v4 planner remains the diagnostic engine, but style/length preferences are
// no longer allowed to manufacture intervention scope. Aggressive changes HOW an
// already-authorised operation is expressed. Expand develops diagnosed reasoning;
// it does not turn every clean sentence into an expansion target.

import { buildInterventionPlan as buildV4Plan } from "./planner.js";

export function buildDiagnosisScopedPlan(diagnostics, options = {}) {
  const requestedNaturalisation = String(options.naturalisation || "faithful").toLowerCase();
  const requestedLength = String(options.lengthPreference || "auto").toLowerCase();

  // Diagnose intervention scope under neutral treatment settings. The underlying
  // intellectual/structural diagnosis still sees the user's rewrite intensity,
  // but Aggressive and Expand cannot create their own targets.
  const plan = buildV4Plan(diagnostics, {
    ...options,
    naturalisation: requestedNaturalisation === "off" ? "off" : "faithful",
    lengthPreference: requestedLength === "concise" ? "concise" : "maintain",
  });

  plan.naturalisation = requestedNaturalisation;
  plan.lengthPreference = requestedLength;
  plan.scopePolicyVersion = "diagnosis-scoped-naturalisation-v1";
  plan.scopePrinciples = [
    "Aggressive is a treatment style, not a rewrite-scope generator.",
    "Deep is an authority ceiling, not an instruction to reconstruct every paragraph.",
    "Expand develops diagnosed intellectual work; it does not require every clean sentence or paragraph to become longer.",
  ];
  plan.documentGuidance = [
    ...(plan.documentGuidance || []),
    ...plan.scopePrinciples,
  ];
  plan.intent = {
    ...plan.intent,
    rationale: [
      ...(plan.intent?.rationale || []),
      requestedNaturalisation === "aggressive" || requestedNaturalisation === "authorial"
        ? "Aggressive/Authorial treatment was intentionally prevented from enlarging diagnostic scope; it may only reshape material already selected for intervention."
        : null,
      requestedLength === "expand"
        ? "Expand was interpreted as permission to develop diagnosed reasoning, evidence, qualification, context, measurement or gap work; no global word-growth quota was created."
        : null,
    ].filter(Boolean),
  };
  return plan;
}
