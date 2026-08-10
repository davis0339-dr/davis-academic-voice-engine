// Translate user-facing rewrite controls into execution authority.
// Diagnosis recommends treatment; the author's explicit intensity sets the maximum
// intervention depth. Semantic preservation and expressive preservation are separate.

const VALID_NATURALISATION = new Set(["off", "faithful", "aggressive", "authorial"]);
const VALID_INTENSITY = new Set(["auto", "minor", "moderate", "deep"]);

function expressivePriority(authorialTexture) {
  return authorialTexture?.expressive_preservation?.priority || authorialTexture?.preservation_priority || null;
}

function semanticPriority(authorialTexture) {
  return authorialTexture?.semantic_preservation?.priority || "high";
}

function explicitCeiling(intensity) {
  if (intensity === "minor") return "local_wording_and_micro_edit";
  if (intensity === "moderate") return "sentence_flow_and_selective_development";
  if (intensity === "deep") return "full_diagnosed_structural_authority";
  return "diagnostic_led_auto";
}

function effectiveNaturalisation(requested, intensity) {
  if (requested === "off") return "off";
  // Naturalisation changes how authorised work is expressed; it must not enlarge
  // the structural ceiling. Minor therefore remains faithful/local. Moderate may
  // honour aggressive wording/sentence treatment while paragraph/discourse authority
  // remains capped elsewhere by the intervention policy. Deep may use full aggressive
  // or authorial execution where diagnosis supports it.
  if (intensity === "minor") return "faithful";
  if (requested === "authorial" || requested === "aggressive") return "aggressive";
  return "faithful";
}

function commonPreservation(authorialTexture) {
  return {
    semantic_preservation_priority: semanticPriority(authorialTexture),
    expressive_preservation_priority: expressivePriority(authorialTexture) || "not_assessed",
    preservation_priority: expressivePriority(authorialTexture) || "not_assessed",
  };
}

export function resolveRewriteModePolicy({ rewriteIntensity, naturalisation, authorialTexture } = {}) {
  const requestedNaturalisation = VALID_NATURALISATION.has(naturalisation) ? naturalisation : "faithful";
  const requestedIntensity = VALID_INTENSITY.has(rewriteIntensity) ? rewriteIntensity : "auto";
  const expressive = expressivePriority(authorialTexture);
  const authorChoiceExplicit = requestedIntensity !== "auto";
  const ceiling = explicitCeiling(requestedIntensity);
  const preservation = commonPreservation(authorialTexture);

  if (requestedIntensity === "minor") {
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: effectiveNaturalisation(requestedNaturalisation, "minor"),
      requested_intensity: "minor",
      effective_intensity: "minor",
      ...preservation,
      preservation_basis: "semantic_fidelity_plus_local_surface_preservation",
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
      rationale: "The author explicitly selected Minor. Diagnose deeper problems and report them, but execute only local wording, grammar and clarity repairs. Semantic meaning is protected and source expression is substantially preserved because the user chose a local-edit ceiling.",
    };
  }

  if (requestedIntensity === "moderate") {
    const effectiveNat = effectiveNaturalisation(requestedNaturalisation, "moderate");
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: effectiveNat,
      requested_intensity: "moderate",
      effective_intensity: "moderate",
      ...preservation,
      preservation_basis: "semantic_fidelity_plus_diagnosed_expressive_preservation",
      surface_preservation_required: expressive === "high",
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
      rationale: "The author explicitly selected Moderate. The engine may restructure sentences, repair flow and selectively develop diagnosed under-explained reasoning, but may not silently convert the run into wholesale discourse reconstruction or paragraph resequencing. Aggressive/Authorial treatment may alter authorised sentence-level expression, but it cannot enlarge the Moderate structural ceiling. High surface quality alone does not create an expressive-preservation veto.",
    };
  }

  if (requestedNaturalisation === "authorial" && requestedIntensity === "deep") {
    return {
      requested_naturalisation: "authorial",
      effective_naturalisation: "aggressive",
      requested_intensity: "deep",
      effective_intensity: "deep",
      ...preservation,
      preservation_basis: "semantic_evidential_fidelity_plus_diagnosed_authorial_preservation",
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
      rationale: "Deep Authorial Reconstruction is an explicit request for structural redevelopment. Preserve argument, evidence, citations, numbers, methods, variables, qualifications, epistemic strength and technical meaning. Preserve source expression only where genuine authorial texture warrants it; high academic polish alone does not freeze sentence wording or paragraph packaging.",
    };
  }

  if (requestedIntensity === "auto") {
    const effectiveNat = effectiveNaturalisation(requestedNaturalisation, "auto");
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: effectiveNat,
      requested_intensity: "auto",
      effective_intensity: "auto",
      ...preservation,
      preservation_basis: "semantic_fidelity_plus_diagnosed_expressive_preservation",
      surface_preservation_required: expressive === "high",
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
      rationale: "Auto leaves intervention depth to diagnosis. Surface quality, authorial texture, machine-pattern regularity and argumentative sufficiency remain separate. Semantic fidelity stays protected while expressive preservation depends on genuine authorial texture rather than polish alone.",
    };
  }

  const effectiveNat = effectiveNaturalisation(requestedNaturalisation, "deep");
  return {
    requested_naturalisation: requestedNaturalisation,
    effective_naturalisation: effectiveNat,
    requested_intensity: "deep",
    effective_intensity: "deep",
    ...preservation,
    preservation_basis: "semantic_fidelity_plus_diagnosed_expressive_preservation",
    surface_preservation_required: expressive === "high",
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
    rationale: "Deep grants broad structural authority where diagnosis supports it. It is permission, not a requirement to rewrite every clean sentence or paragraph. Semantic fidelity remains mandatory; expressive preservation is independently determined from genuine authorial texture and machine-pattern regularity. Naturalisation changes how authorised work is expressed, not how much of the document must change.",
  };
}
