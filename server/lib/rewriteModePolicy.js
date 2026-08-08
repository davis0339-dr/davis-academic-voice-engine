// Translate user-facing rewrite controls into an execution policy.
// Diagnosis recommends the treatment; the author's explicit intensity determines
// the maximum intervention authority. A stronger stylistic/naturalisation choice
// must never silently escalate a Minor or Moderate rewrite into full reconstruction.

const VALID_NATURALISATION = new Set(["off", "faithful", "aggressive", "authorial"]);
const VALID_INTENSITY = new Set(["auto", "minor", "moderate", "deep"]);

function texturePriority(authorialTexture) {
  return authorialTexture?.preservation_priority || null;
}

function explicitCeiling(intensity) {
  if (intensity === "minor") return "local_wording_and_micro_edit";
  if (intensity === "moderate") return "sentence_and_flow_repair";
  if (intensity === "deep") return "full_diagnosed_structural_authority";
  return "diagnostic_led_auto";
}

export function resolveRewriteModePolicy({ rewriteIntensity, naturalisation, authorialTexture } = {}) {
  const requestedNaturalisation = VALID_NATURALISATION.has(naturalisation) ? naturalisation : "faithful";
  const requestedIntensity = VALID_INTENSITY.has(rewriteIntensity) ? rewriteIntensity : "auto";
  const priority = texturePriority(authorialTexture);
  const authorChoiceExplicit = requestedIntensity !== "auto";
  const ceiling = explicitCeiling(requestedIntensity);

  // Minor is a hard authorial ceiling. Even Authorial/Aggressive naturalisation
  // becomes a faithful local-edit strategy because the writer explicitly asked
  // for tweaking rather than redevelopment.
  if (requestedIntensity === "minor") {
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: requestedNaturalisation === "off" ? "off" : "faithful",
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

  // Moderate is also an explicit ceiling. It permits sentence restructuring,
  // split/merge and flow repair, but not a hidden paragraph-level reconstruction.
  if (requestedIntensity === "moderate") {
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: requestedNaturalisation === "off" ? "off" : "faithful",
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
      adaptive_reconstruction: true,
      authorial_reconstruction: false,
      plan_execution_priority: "sentence_and_flow",
      detector_targeting: false,
      depth_permission: "sentence_level_where_diagnosed",
      rationale: "The author explicitly selected Moderate. The engine may restructure sentences and repair flow where diagnosed, while deeper discourse recommendations remain advisory rather than executable in this run.",
    };
  }

  // Deep Authorial Reconstruction remains an explicit opt-in to broad structural
  // redevelopment. Strong existing texture protects intellectual/evidential content,
  // not the current sentence skeletons.
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

  // Auto delegates intervention depth to diagnosis. Naturalisation changes the
  // stylistic treatment but must not itself create structural authority.
  if (requestedIntensity === "auto") {
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: requestedNaturalisation === "off" ? "off" : "faithful",
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
      adaptive_reconstruction: requestedNaturalisation !== "off",
      authorial_reconstruction: false,
      plan_execution_priority: "diagnostic_led",
      detector_targeting: false,
      depth_permission: "as_diagnosed",
      rationale: "Auto keeps diagnosis in control of intervention depth. Existing authorial texture affects preservation priority, but does not replace the diagnostic decision with a blanket rewrite or blanket keep rule.",
    };
  }

  // Deep without Authorial mode is still explicit permission for deep repair.
  // It is not a numeric change quota; the planner remains responsible for deciding
  // which passages actually need that authority.
  return {
    requested_naturalisation: requestedNaturalisation,
    effective_naturalisation: requestedNaturalisation === "aggressive" ? "aggressive" : requestedNaturalisation === "off" ? "off" : "faithful",
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
    adaptive_reconstruction: requestedNaturalisation !== "off",
    authorial_reconstruction: false,
    plan_execution_priority: "diagnosed_deep",
    detector_targeting: false,
    depth_permission: "deep_where_diagnosed",
    rationale: "Deep grants broad structural authority where diagnosis supports it. It is permission, not a requirement to rewrite every clean sentence or paragraph, and preservation safeguards remain active.",
  };
}
