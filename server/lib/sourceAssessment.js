// Pre-generation source assessment. This runs before rewrite-mode resolution so
// existing authorial texture can constrain intervention breadth rather than
// being discovered only after the model has already rewritten the document.

import { diagnose } from "./diagnostics.js";
import { assessCadenceDeviation } from "./cadenceDeviation.js";
import { measureLanguageFingerprint } from "./languageFingerprint.js";
import { assessLanguageDeviation } from "./languageFamilyEngine.js";
import { resolveProfile } from "./styleProfileStore.js";
import { assessAuthorialTexture } from "./authorialTexture.js";

export function assessSourceBeforeRewrite({ text, styleFilters } = {}) {
  const diagnostics = diagnose(text || "");
  const cadenceDeviation = assessCadenceDeviation(text || "", styleFilters || {});
  const profileResolution = resolveProfile(styleFilters || {});
  const measuredLanguageFamily = profileResolution.measured_language_family || null;
  const fingerprint = measureLanguageFingerprint(text || "");
  const languageDeviation = assessLanguageDeviation(fingerprint, measuredLanguageFamily);
  const authorialTexture = assessAuthorialTexture({
    text,
    diagnostics,
    cadenceDeviation,
    languageDeviation,
  });

  return {
    authorial_texture: authorialTexture,
    diagnostics,
    cadence_deviation: cadenceDeviation,
    language_fingerprint: fingerprint,
    measured_language_deviation: languageDeviation,
    measured_language_family: measuredLanguageFamily,
    profile_resolution: profileResolution,
  };
}
