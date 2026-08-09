// Diagnosis-aware wrapper around intent-discourse-v4.
// Diagnosis chooses WHAT kind of intervention a passage needs. The researcher-selected
// mode determines HOW MUCH authority the engine has to execute that intervention.
// This distinction prevents both failure modes we have observed: shallow local polishing
// when Deep/Authorial was explicitly requested, and indiscriminate rewriting when Minor
// or Moderate was requested.

import { buildInterventionPlan as buildV4Plan } from "./planner.js";

export function buildDiagnosisScopedPlan(diagnostics, options = {}) {
  const requestedNaturalisation = String(options.naturalisation || "faithful").toLowerCase();
  const requestedLength = String(options.lengthPreference || "auto").toLowerCase();
  const requestedIntensity = String(options.rewriteIntensity || "auto").toLowerCase();
  const authorialAuthority = requestedIntensity === "deep" && ["aggressive", "authorial"].includes(requestedNaturalisation);

  // Minor/Moderate remain ceilings. Auto remains diagnostic. Deep is different:
  // when the researcher explicitly combines Deep with Aggressive/Authorial, the
  // planner must receive that authority instead of silently downgrading it to Auto
  // + Faithful. The v4 planner still diagnoses paragraph operations and protects
  // headings, quotations, evidence-bearing content and technical material.
  const diagnosticIntensity = requestedIntensity;
  const plannerNaturalisation = requestedNaturalisation === "off"
    ? "off"
    : authorialAuthority
      ? "aggressive"
      : requestedNaturalisation === "aggressive" && requestedIntensity !== "minor"
        ? "aggressive"
        : "faithful";

  const plan = buildV4Plan(diagnostics, {
    ...options,
    rewriteIntensity: diagnosticIntensity,
    naturalisation: plannerNaturalisation,
    // Expansion is still evidence/argument driven. Deep Authorial may reconstruct
    // clean prose, but Expand does not become a quota to lengthen every sentence.
    lengthPreference: requestedLength === "concise" ? "concise" : requestedLength === "expand" ? "expand" : "maintain",
  });

  plan.intensity = requestedIntensity;
  plan.diagnosticIntensity = diagnosticIntensity;
  plan.naturalisation = requestedNaturalisation;
  plan.lengthPreference = requestedLength;
  plan.authorialAuthorityActive = authorialAuthority;
  plan.scopePolicyVersion = "diagnosis-guided-authority-v3";
  plan.scopePrinciples = [
    "Diagnosis selects the rhetorical/argument operation; the researcher-selected mode supplies the intervention authority.",
    "Minor remains local and restrained; Moderate remains selective; Deep permits structural redevelopment.",
    "Deep + Aggressive/Authorial authorises paragraph-level discourse reconstruction even where individual sentences are technically clean, while preserving research meaning, evidence and formal artefacts.",
    "A Deep/Authorial request must not be silently collapsed into Faithful local polishing merely because an isolated chunk looks grammatically acceptable.",
    "Expand develops diagnosed reasoning, evidence, qualification, context, measurement or gap work; it is not a word-growth quota.",
    "Keep decisions remain legitimate for quotations, headings, equations, technical labels and genuinely author-specific passages; they are not a blanket licence to leave most substantive prose untouched in a Deep/Authorial job.",
  ];
  plan.documentGuidance = [
    ...(plan.documentGuidance || []),
    ...plan.scopePrinciples,
  ];
  plan.intent = {
    ...plan.intent,
    rationale: [
      ...(plan.intent?.rationale || []),
      authorialAuthority
        ? "Deep Authorial authority is active: preserve the research, not the source sentence architecture. Diagnosis determines the operation, but it no longer suppresses broad authorised reconstruction to Faithful polishing."
        : requestedIntensity === "deep"
          ? "Deep structural authority is active, but the selected naturalisation level remains restrained unless the researcher also chose Aggressive/Authorial treatment."
          : null,
      requestedNaturalisation === "aggressive" && requestedIntensity !== "minor"
        ? "Aggressive treatment is allowed to execute paragraph-level reconstruction within the selected intensity ceiling."
        : null,
      requestedLength === "expand"
        ? "Expand is permission to develop diagnosed intellectual work from available content/evidence; no global word-growth quota is created."
        : null,
    ].filter(Boolean),
  };
  return plan;
}
