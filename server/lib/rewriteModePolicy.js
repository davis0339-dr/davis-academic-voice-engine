// User-facing rewrite settings are translated into an execution policy here.
// The strongest mode is permission to reconstruct deeply where diagnostics
// justify it; it is not a quota requiring every sentence or paragraph to change.

const VALID_NATURALISATION = new Set(["off", "faithful", "aggressive"]);
const VALID_INTENSITY = new Set(["auto", "minor", "moderate", "deep"]);

export function resolveRewriteModePolicy({ rewriteIntensity, naturalisation } = {}) {
  const requestedNaturalisation = VALID_NATURALISATION.has(naturalisation) ? naturalisation : "faithful";
  const requestedIntensity = VALID_INTENSITY.has(rewriteIntensity) ? rewriteIntensity : "auto";

  if (requestedNaturalisation !== "aggressive") {
    return {
      requested_naturalisation: requestedNaturalisation,
      effective_naturalisation: requestedNaturalisation,
      requested_intensity: requestedIntensity,
      effective_intensity: requestedIntensity,
      policy: requestedNaturalisation === "off" ? "clarity_only" : "faithful_selective",
      universal_rewrite_authorised: false,
      adaptive_reconstruction: requestedNaturalisation !== "off",
      rationale: requestedNaturalisation === "off"
        ? "Naturalisation is off; revise for clarity/correctness only."
        : "Faithful mode preserves usable wording and escalates only where diagnostics justify intervention.",
    };
  }

  return {
    requested_naturalisation: "aggressive",
    // Deliberately use the selective generation contract. The old aggressive
    // contract authorised wholesale restyling and could transform one synthetic
    // register into another. Deep reconstruction is now driven by diagnostics,
    // paragraph actions and residual post-rewrite checks instead.
    effective_naturalisation: "faithful",
    requested_intensity: requestedIntensity,
    effective_intensity: requestedIntensity,
    policy: "adaptive_human_reconstruction",
    universal_rewrite_authorised: false,
    adaptive_reconstruction: true,
    rationale: "Aggressive mode now means permission for deep, diagnostic-led reconstruction where needed, not compulsory rewriting of clean sentences or paragraphs.",
  };
}
