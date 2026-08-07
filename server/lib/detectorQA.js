// Detector QA orchestrator -- Section 15.4 of the build handoff:
//
//   "External detector results can still be recorded during product QA so
//   the team can understand how different systems respond to the
//   revisions. Treat those results as observations, not guarantees."
//
// and Section 5:
//
//   "A detector result may be shown as evaluation information; it must
//   not secretly become a target that the generator loops against until
//   a desired score is obtained."
//
// HARD BOUNDARY: nothing in this file is imported by server/lib/pipeline.js,
// server/routes/rewrite.js, or server/routes/analyse.js. A scan only ever
// runs when a client explicitly calls POST /api/detector-scan as its own
// separate action. There is no code path from "generate a revision" to
// "check a detector" to "regenerate" anywhere in this codebase. If a future
// change adds one, it violates this section's whole reason for existing.

import { gptZeroProvider } from "./detectorProviders/gptzero.js";

// Registry of providers this build can genuinely reach. Turnitin is
// deliberately absent -- see the comment in detectorProviders/gptzero.js.
// Add another entry here only when a real, documented, key-based API
// exists for it (e.g. Originality.ai, Copyleaks) -- never a stub.
const PROVIDERS = [gptZeroProvider];

export const DISCLAIMER =
  "These are raw outputs from a third-party classifier (GPTZero), shown for your own product QA. " +
  "They are not proof of who wrote a text, not guaranteed to match Turnitin or any other tool (Turnitin has no public API this build can call), " +
  "and are never fed back into the rewrite engine to regenerate text toward a score. Detector QA is a separate, manually-triggered action.";

export async function listDetectorHealth() {
  const results = await Promise.all(
    PROVIDERS.map(async (p) => ({ id: p.id, label: p.label, ...(await p.checkHealth()) }))
  );
  return results;
}

export async function scanWithAllConfigured(text) {
  const configured = PROVIDERS.filter((p) => p.isConfigured());
  const notConfigured = PROVIDERS.filter((p) => !p.isConfigured());

  const results = await Promise.all(
    configured.map(async (p) => {
      try {
        const result = await p.scanText(text);
        return { id: p.id, label: p.label, state: "READY", ...result };
      } catch (err) {
        return { id: p.id, label: p.label, state: err.healthState || "PROVIDER_ERROR", error: err.message };
      }
    })
  );

  const skipped = notConfigured.map((p) => ({
    id: p.id,
    label: p.label,
    state: "NOT_CONFIGURED",
    message: `${p.label} is not configured on this server.`,
  }));

  return { results: [...results, ...skipped], disclaimer: DISCLAIMER };
}
