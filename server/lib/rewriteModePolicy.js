// User-facing rewrite settings are translated into an execution policy here.
// The strongest mode is permission to reconstruct deeply where diagnostics
// justify it; it is not a quota requiring every sentence or paragraph to change.
// Existing authorial texture can narrow breadth before generation begins.

const VALID_NATURALISATION = new Set(["off", "faithful", "aggressive"]);
const VALID_INTENSITY = new Set(["auto", "minor", "moderate", "deep"]);

function texturePriority(authorialTexture) {
  return authorialTexture?.preservation_priority || "medium";
}

function preservationAwareIntensity(requestedIntensity, authorialTexture) {
  const priority = texturePriority(authorialTexture);
  if (priority === "high") {
    // Auto already escalates genuinely flagged sentences/paragraphs to structural
    // operations. This preserves the user's permission for deep repair without
    // using Deep as a broad micro-edit command on clean sentences.
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
  const effectiveIntensity = preservationAwareIntensity(requestedIntensity, authorialTexture);

  if (requestedNaturalisation !== "aggressive") {
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: requestedNaturalisation,
      requested_intensity: requestedIntensity,
      effective_intensity: effectiveIntensity,
      preservation_priority: priority,
      policy: requestedNaturalisation === "off"
        ? "clarity_only"
        : priority === "high"
          ? "authorial_preservation_targeted"
          : "faithful_selective",
      universal_rewrite_authorised: false,
      adaptive_reconstruction: requestedNaturalisation !== "off",
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
    // Deliberately use the selective generation contract. The old aggressive
    // contract authorised wholesale restyling and could transform one synthetic
    // register into another. Deep reconstruction is driven by diagnostics and
    // residual checks instead.
    effective_naturalisation: "faithful",
    requested_intensity: requestedIntensity,
    effective_intensity: effectiveIntensity,
    preservation_priority: priority,
    policy: priority === "high" ? "authorial_preservation_targeted" : "adaptive_human_reconstruction",
    universal_rewrite_authorised: false,
    adaptive_reconstruction: true,
    depth_permission: requestedIntensity === "deep" || requestedNaturalisation === "aggressive"
      ? "deep_where_diagnosed"
      : "as_planned",
    rationale: priority === "high"
      ? "Aggressive/Deep is constrained by strong existing authorial texture: preserve clean sentences and paragraphs, but allow deep reconstruction inside genuinely defective passages."
      : "Aggressive mode means permission for deep, diagnostic-led reconstruction where needed, not compulsory rewriting of clean sentences or paragraphs.",
  };
}
