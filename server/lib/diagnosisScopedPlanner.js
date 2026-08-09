// Scope-safe wrapper around intent-discourse-v4.
// The v4 planner remains the diagnostic engine, but rewrite authority, style and
// length preferences are no longer allowed to manufacture intervention scope.
// Deep is a ceiling. Aggressive changes HOW an already-authorised operation is
// expressed. Expand develops diagnosed reasoning rather than every clean sentence.

import { buildInterventionPlan as buildV4Plan } from "./planner.js";

export function buildDiagnosisScopedPlan(diagnostics, options = {}) {
  const requestedNaturalisation = String(options.naturalisation || "faithful").toLowerCase();
  const requestedLength = String(options.lengthPreference || "auto").toLowerCase();
  const requestedIntensity = String(options.rewriteIntensity || "auto").toLowerCase();

  // Minor and Moderate remain explicit author ceilings in v4. Deep, however,
  // must not manufacture work merely because broad authority was granted, so its
  // diagnostic scope is resolved through Auto. If the source actually warrants
  // discourse reconstruction, Auto will still diagnose it and Deep permits it.
  const diagnosticIntensity = requestedIntensity === "deep" ? "auto" : requestedIntensity;

  const plan = buildV4Plan(diagnostics, {
    ...options,
    rewriteIntensity: diagnosticIntensity,
    naturalisation: requestedNaturalisation === "off" ? "off" : "faithful",
    lengthPreference: requestedLength === "concise" ? "concise" : "maintain",
  });

  plan.intensity = requestedIntensity;
  plan.diagnosticIntensity = diagnosticIntensity;
  plan.naturalisation = requestedNaturalisation;
  plan.lengthPreference = requestedLength;
  plan.scopePolicyVersion = "diagnosis-scoped-naturalisation-v2";
  plan.scopePrinciples = [
    "Diagnosis creates intervention scope; user controls only cap or style that scope.",
    "Aggressive is a treatment style, not a rewrite-scope generator.",
    "Deep is an authority ceiling, not an instruction to edit clean sentences or reconstruct every paragraph.",
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
      requestedIntensity === "deep"
        ? "Deep authority was resolved through diagnostic scope rather than treated as a compulsory edit level. Clean material may remain unchanged."
        : null,
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
