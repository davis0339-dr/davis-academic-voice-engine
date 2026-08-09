// Translate user-facing rewrite controls into an execution policy.
// Diagnosis recommends the treatment; the author's explicit intensity determines
// the maximum intervention authority. Naturalisation controls how authorised work
// is expressed; it must not silently create paragraph/discourse authority.

const VALID_NATURALISATION = new Set(["off", "faithful", "aggressive", "authorial"]);
const VALID_INTENSITY = new Set(["auto", "minor", "moderate", "deep"]);

function texturePriority(authorialTexture) {
  return authorialTexture?.preservation_priority || null;
}

function explicitCeiling(intensity) {
  if (intensity === "minor") return "local_wording_and_micro_edit";
  if (intensity === "moderate") return "sentence_flow_and_selective_development";
  if (intensity === "deep") return "full_diagnosed_structural_authority";
  return "diagnostic_led_auto";
}

function effectiveNaturalisation(requested, intensity) {
  if (requested === "off") return "off";
  // The current aggressive planner still treats its flag as paragraph-level scope.
  // Until that implementation is fully diagnosis-scoped, only an explicit Deep
  // choice may activate aggressive execution. Moderate/Auto retain the requested
  // preference as metadata but execute the safer faithful treatment so naturalisation
  // cannot silently enlarge authorial authority.
  if (intensity !== "deep") return "faithful";
  if (requested === "authorial" || requested === "aggressive") return "aggressive";
  return "faithful";
}

export function resolveRewriteModePolicy({ rewriteIntensity, naturalisation, authorialTexture } = {}) {
  const requestedNaturalisation = VALID_NATURALISATION.has(naturalisation) ? naturalisation : "faithful";
  const requestedIntensity = VALID_INTENSITY.has(rewriteIntensity) ? rewriteIntensity : "auto";
  const priority = texturePriority(authorialTexture);
  const authorChoiceExplicit = requestedIntensity !== "auto";
  const ceiling = explicitCeiling(requestedIntensity);

  if (requestedIntensity === "minor") {
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: effectiveNaturalisation(requestedNaturalisation, "minor"),
      requested_intensity: "minor",
      effective_intensity: "minor",
      preservation_priority: priority || "not_assessed",
      preservation_basis: "surface_and_semantic_fidelity",
      surface_preservation_required: true,
      policy: requestedNaturalisation === "off" ? "minor_clarity_only" : "author_choice_minor_edit",
      author_choice_explicit: true,
      author_choice_ceiling: ceiling,
      author_choice_respected: true,
      diagnostic_may_recommend_deeper: true,
      universal_rewrite_authorised: false,
      adaptive_reconstruction: false,
      authorial_reconstruction: false,
      plan_execution_priority: "local_only",
      detector_targeting: false,
      depth_permission: "micro_edit_only",
      rationale: "The author explicitly selected Minor. Diagnose deeper problems and report them, but execute only local wording, grammar and clarity repairs. Do not resequence paragraphs, rebuild discourse, or convert the request into a full rewrite.",
    };
  }

  if (requestedIntensity === "moderate") {
    const effectiveNat = effectiveNaturalisation(requestedNaturalisation, "moderate");
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: effectiveNat,
      requested_intensity: "moderate",
      effective_intensity: "moderate",
      preservation_priority: priority || "not_assessed",
      preservation_basis: "surface_and_semantic_fidelity",
      surface_preservation_required: true,
      policy: requestedNaturalisation === "off" ? "moderate_clarity_only" : "author_choice_moderate_edit",
      author_choice_explicit: true,
      author_choice_ceiling: ceiling,
      author_choice_respected: true,
      diagnostic_may_recommend_deeper: true,
      universal_rewrite_authorised: false,
      adaptive_reconstruction: effectiveNat !== "off",
      authorial_reconstruction: false,
      plan_execution_priority: "sentence_flow_and_selective_development",
      detector_targeting: false,
      depth_permission: "moderate_diagnostic_ceiling",
      rationale: "The author explicitly selected Moderate. The engine may restructure sentences, repair flow and selectively develop diagnosed under-explained reasoning, but may not silently convert the run into wholesale discourse reconstruction or paragraph resequencing. A requested Aggressive/Authorial preference is retained as the user's preference but is executed faithfully at this ceiling until aggressive paragraph treatment is fully diagnosis-scoped.",
    };
  }

  if (requestedNaturalisation === "authorial" && requestedIntensity === "deep") {
    return {
      requested_naturalisation: "authorial",
      effective_naturalisation: "aggressive",
      requested_intensity: "deep",
      effective_intensity: "deep",
      preservation_priority: priority || "not_assessed",
      preservation_basis: "semantic_evidential_fidelity",
      surface_preservation_required: false,
      policy: "deep_authorial_reconstruction",
      author_choice_explicit: true,
      author_choice_ceiling: ceiling,
      author_choice_respected: true,
      diagnostic_may_recommend_deeper: false,
      universal_rewrite_authorised: false,
      adaptive_reconstruction: true,
      authorial_reconstruction: true,
      plan_execution_priority: "material",
      opening_register_priority: "first_two_prose_paragraphs",
      detector_targeting: false,
      depth_permission: "deep_where_diagnosed",
      rationale: "Deep Authorial Reconstruction is an explicit request for structural redevelopment. Preserve argument, evidence, citations, numbers, methods, variables, qualifications, epistemic strength and technical meaning, but do not freeze source sentence wording or paragraph packaging where reconstruction is diagnosed.",
    };
  }

  if (requestedIntensity === "auto") {
    const effectiveNat = effectiveNaturalisation(requestedNaturalisation, "auto");
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: effectiveNat,
      requested_intensity: "auto",
      effective_intensity: "auto",
      preservation_priority: priority || "not_assessed",
      preservation_basis: "surface_and_semantic_fidelity",
      surface_preservation_required: true,
      policy: requestedNaturalisation === "off" ? "clarity_only" : "diagnostic_led_auto",
      author_choice_explicit: false,
      author_choice_ceiling: ceiling,
      author_choice_respected: true,
      diagnostic_may_recommend_deeper: true,
      universal_rewrite_authorised: false,
      adaptive_reconstruction: effectiveNat !== "off",
      authorial_reconstruction: false,
      plan_execution_priority: "diagnostic_led",
      detector_targeting: false,
      depth_permission: "as_diagnosed",
      rationale: "Auto keeps diagnosis in control of intervention depth. Existing authorial texture affects preservation priority without becoming a blanket keep rule. Aggressive treatment is not allowed to create structural authority by itself; the current Auto execution remains faithful while diagnosis chooses the needed intervention.",
    };
  }

  const effectiveNat = effectiveNaturalisation(requestedNaturalisation, "deep");
  return {
    requested_naturalisation: requestedNaturalisation,
    effective_naturalisation: effectiveNat,
    requested_intensity: "deep",
    effective_intensity: "deep",
    preservation_priority: priority || "not_assessed",
    preservation_basis: "surface_and_semantic_fidelity",
    surface_preservation_required: true,
    policy: requestedNaturalisation === "off" ? "deep_clarity_authority" : "deep_diagnostic_authority",
    author_choice_explicit: authorChoiceExplicit,
    author_choice_ceiling: ceiling,
    author_choice_respected: true,
    diagnostic_may_recommend_deeper: false,
    universal_rewrite_authorised: false,
    adaptive_reconstruction: effectiveNat !== "off",
    authorial_reconstruction: false,
    plan_execution_priority: "diagnosed_deep",
    detector_targeting: false,
    depth_permission: "deep_where_diagnosed",
    rationale: "Deep grants broad structural authority where diagnosis supports it. It is permission, not a requirement to rewrite every clean sentence or paragraph, and preservation safeguards remain active. Naturalisation changes how authorised work is expressed, not how much of the document must change.",
  };
}
