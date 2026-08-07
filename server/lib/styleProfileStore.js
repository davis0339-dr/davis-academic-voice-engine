// Section 7 (evidence-backed multidimensional style engine) + Section 10.2
// (runtime profile representation). Implements the hierarchical fallback
// mandate from Section 7.2: a narrow style claim (e.g. a specific
// university) must never be invented from convenience; if the requested
// combination isn't independently evidenced yet, the runtime backs off to
// a broader supported family and SAYS SO.
//
// Only two families are marked "supported" in Phase 1 -- see the
// _provenance_note in styleProfiles.json for why. This is deliberate: the
// build handoff explicitly forbids pretending a threshold has been
// calibrated when it hasn't (Section 10.2, closing line).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "styleProfiles.json"), "utf8")
);

function filtersEqual(a, b) {
  const aKeys = Object.keys(a || {});
  const bKeys = Object.keys(b || {});
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

function nonEmptyFilters(filters) {
  return Object.fromEntries(Object.entries(filters || {}).filter(([, v]) => v));
}

export function listSelectableDimensions() {
  return STORE.selectable_dimensions;
}

export function listProfiles() {
  return STORE.profiles.map((p) => ({
    profile_id: p.profile_id,
    label: p.label,
    filters: p.filters,
    evidence: p.evidence,
  }));
}

export function resolveProfile(requestedFilters) {
  const requested = nonEmptyFilters(requestedFilters);

  const exact = STORE.profiles.find((p) => filtersEqual(p.filters, requested));
  if (exact) {
    return {
      requested,
      effective: exact,
      fallback_applied: false,
      evidence_strength: exact.evidence.strength,
      message: `Requested profile matches an evidence-backed family directly: ${exact.label} (${exact.evidence.independent_source_count} independent sources).`,
    };
  }

  // Fallback ladder: prefer the thesis/dissertation family when the
  // request is thesis-shaped (or document_type unset), otherwise the
  // global default. This mirrors the worked example in Section 7.2.
  const wantsThesis = !requested.document_type || requested.document_type === "thesis";
  const fallbackProfile = wantsThesis
    ? STORE.profiles.find((p) => p.profile_id === "thesis-dissertation")
    : STORE.profiles.find((p) => p.profile_id === "global-default");

  const requestedDescription =
    Object.keys(requested).length > 0
      ? Object.entries(requested)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")
      : "(no filters specified)";

  return {
    requested,
    effective: fallbackProfile,
    fallback_applied: true,
    evidence_strength: fallbackProfile.evidence.strength,
    message: `Requested profile: ${requestedDescription}. Evidence too sparse for a profile at this granularity -- no independently-evidenced cell exists yet for it. Using broader supported family: ${fallbackProfile.label} (${fallbackProfile.evidence.independent_source_count} independent sources).`,
  };
}
