// User-facing rewrite settings are translated into an execution policy here.
// The strongest modes are permission to reconstruct deeply where diagnostics
// justify it; they are not quotas requiring every sentence or paragraph to change.
// Existing authorial texture can narrow ordinary modes before generation begins.

const VALID_NATURALISATION = new Set(["off", "faithful", "aggressive", "authorial"]);
const VALID_INTENSITY = new Set(["auto", "minor", "moderate", "deep"]);

function texturePriority(authorialTexture) {
  return authorialTexture?.preservation_priority || null;
}

function preservationAwareIntensity(requestedIntensity, authorialTexture) {
  const priority = texturePriority(authorialTexture);
  // Legacy/internal callers that do not supply a pre-generation texture result
  // keep their previous intensity behavior. Production analyse/rewrite routes do
  // supply the texture assessment before mode resolution.
  if (!priority) return requestedIntensity;
  if (priority === "high") {
    if (requestedIntensity === "deep" || requestedIntensity === "moderate") return "auto";
    return requestedIntensity;
  }
  if (priority === "medium" && requestedIntensity === "deep") return "moderate";
  return requestedIntensity;
}

export function resolveRewriteModePolicy({ rewriteIntensity, naturalisation, authorialTexture } = {}) {
  const requestedNaturalisation = VALID_NATURALISATION.has(naturalisation) ? naturalisation : "faithful";
  const requestedIntensity = VALID_INTENSITY.has(rewriteIntensity) ? rewriteIntensity : "auto";
  const priority = texturePriority(authorialTexture);

  // Deep Authorial Reconstruction is deliberately separate from the ordinary
  // Aggressive/Adaptive setting. It is an explicit user choice to permit
  // substantial paragraph- and sentence-level repackaging while retaining hard
  // factual, citation, methodological and structural fidelity. It therefore does
  // not silently collapse Deep -> Auto merely because the source already has
  // strong texture. The underlying aggressive generation machinery is reused so
  // the existing structural-quality gates remain active.
  if (requestedNaturalisation === "authorial") {
    return {
      requested_naturalisation: "authorial",
      effective_naturalisation: "aggressive",
      requested_intensity: requestedIntensity,
      effective_intensity: "deep",
      preservation_priority: priority || "not_assessed",
      policy: "deep_authorial_reconstruction",
      universal_rewrite_authorised: false,
      adaptive_reconstruction: true,
      authorial_reconstruction: true,
      opening_register_priority: "first_two_prose_paragraphs",
      detector_targeting: false,
      depth_permission: "deep_where_diagnosed",
      rationale: "Deep Authorial Reconstruction is an explicit request for stronger structural redevelopment. Strong existing texture still protects the writer's argument, evidence, citations, methods, variables and technical language, but it does not automatically downgrade the requested depth. The first two prose paragraphs receive special register scrutiny because they establish the section's voice and reasoning frame; this is a writing-quality priority, not a detector-optimisation rule.",
    };
  }

  const effectiveIntensity = preservationAwareIntensity(requestedIntensity, authorialTexture);

  if (requestedNaturalisation !== "aggressive") {
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: requestedNaturalisation,
      requested_intensity: requestedIntensity,
      effective_intensity: effectiveIntensity,
      preservation_priority: priority || "not_assessed",
      policy: requestedNaturalisation === "off"
        ? "clarity_only"
        : priority === "high"
          ? "authorial_preservation_targeted"
          : "faithful_selective",
      universal_rewrite_authorised: false,
      adaptive_reconstruction: requestedNaturalisation !== "off",
      authorial_reconstruction: false,
      detector_targeting: false,
      depth_permission: requestedIntensity === "deep" ? "deep_where_diagnosed" : "as_planned",
      rationale: requestedNaturalisation === "off"
        ? "Naturalisation is off; revise for clarity/correctness only."
        : priority === "high"
          ? "Strong existing authorial texture narrows rewrite breadth. Deep/Moderate remains permission for substantial repair where diagnostics identify a defect, while clean prose is preserved."
          : "Faithful mode preserves usable wording and escalates only where diagnostics justify intervention.",
    };
  }

  return {
    requested_naturalisation: "aggressive",
    effective_naturalisation: "faithful",
    requested_intensity: requestedIntensity,
    effective_intensity: effectiveIntensity,
    preservation_priority: priority || "not_assessed",
    policy: priority === "high" ? "authorial_preservation_targeted" : "adaptive_human_reconstruction",
    universal_rewrite_authorised: false,
    adaptive_reconstruction: true,
    authorial_reconstruction: false,
    detector_targeting: false,
    depth_permission: requestedIntensity === "deep" || requestedNaturalisation === "aggressive"
      ? "deep_where_diagnosed"
      : "as_planned",
    rationale: priority === "high"
      ? "Aggressive/Deep is constrained by strong existing authorial texture: preserve clean sentences and paragraphs, but allow deep reconstruction inside genuinely defective passages."
      : "Aggressive mode means permission for deep, diagnostic-led reconstruction where needed, not compulsory rewriting of clean sentences or paragraphs.",
  };
}
