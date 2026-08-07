// Detector QA provider adapter for GPTZero. This exists ONLY for
// observational product QA (Section 15.3/15.4 of the build handoff) --
// it is never called from server/lib/pipeline.js, and nothing in this
// codebase feeds its output back into generation. See server/lib/detectorQA.js
// for the hard boundary that enforces that separation.
//
// IMPORTANT: Turnitin has no public developer API. It is an
// institutionally-licensed product integrated directly into LMS platforms
// (Canvas, Moodle, etc.) with no general third-party access route. This
// build does not, and cannot honestly, offer a "Turnitin" adapter --
// faking one would violate Section 18.2's "no fake production functions"
// rule. GPTZero is the one detector this build can genuinely reach,
// because it publishes a documented API.

const GPTZERO_API_URL = "https://api.gptzero.me/v2/predict/text";

export const DetectorHealthState = Object.freeze({
  READY: "READY",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  AUTH_FAILED: "AUTH_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  PROVIDER_ERROR: "PROVIDER_ERROR",
});

function getConfig() {
  const apiKey = process.env.GPTZERO_API_KEY;
  const timeoutMs = Number(process.env.DETECTOR_TIMEOUT_MS || 20000);
  return { apiKey, timeoutMs };
}

export function isConfigured() {
  const { apiKey } = getConfig();
  return Boolean(apiKey && apiKey.trim().length > 0);
}

// Deliberately defensive: GPTZero's response schema has changed over time
// and this build has not been able to verify the exact current shape
// against a live account. Rather than assert a rigid shape and risk
// silently misreporting a score, this pulls out whichever recognisable
// fields are present, keeps the full raw payload alongside them, and sets
// parseWarning when it can't find what it expected -- so a schema drift
// shows up as a visible warning, not a wrong number presented as fact.
export function normalizeGptZeroResponse(raw) {
  const doc = raw && Array.isArray(raw.documents) && raw.documents.length > 0 ? raw.documents[0] : null;

  if (!doc) {
    return {
      provider: "gptzero",
      parseWarning: "Response did not contain a recognizable `documents[0]` entry; showing raw response only.",
      summary: null,
      raw,
    };
  }

  const classProbabilities = doc.class_probabilities || doc.classProbabilities || null;
  const predictedClass = doc.predicted_class || doc.predictedClass || null;
  const completelyGeneratedProb = doc.completely_generated_prob ?? doc.completelyGeneratedProb ?? null;
  const averageGeneratedProb = doc.average_generated_prob ?? doc.averageGeneratedProb ?? null;

  const foundAnyField = [classProbabilities, predictedClass, completelyGeneratedProb, averageGeneratedProb].some(
    (v) => v !== null && v !== undefined
  );

  return {
    provider: "gptzero",
    parseWarning: foundAnyField
      ? null
      : "Recognized documents[0] but none of the expected score fields were present; API shape may have changed. Showing raw response.",
    summary: {
      predictedClass,
      classProbabilities,
      completelyGeneratedProb,
      averageGeneratedProb,
    },
    raw,
  };
}

async function callGptZero(text) {
  const { apiKey, timeoutMs } = getConfig();
  if (!apiKey) {
    const err = new Error("GPTZero not configured");
    err.healthState = DetectorHealthState.NOT_CONFIGURED;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(GPTZERO_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ document: text }),
      signal: controller.signal,
    });
  } catch (networkErr) {
    clearTimeout(timer);
    const err = new Error(
      networkErr.name === "AbortError" ? "GPTZero request timed out" : `Network error calling GPTZero: ${networkErr.message}`
    );
    err.healthState = DetectorHealthState.NETWORK_TIMEOUT;
    throw err;
  }
  clearTimeout(timer);

  if (response.status === 401 || response.status === 403) {
    const err = new Error("GPTZero rejected the API key");
    err.healthState = DetectorHealthState.AUTH_FAILED;
    throw err;
  }
  if (response.status === 429) {
    const err = new Error("GPTZero rate-limited this request");
    err.healthState = DetectorHealthState.RATE_LIMITED;
    throw err;
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const err = new Error(`GPTZero error ${response.status}: ${bodyText.slice(0, 500)}`);
    err.healthState = DetectorHealthState.PROVIDER_ERROR;
    throw err;
  }

  return response.json();
}

async function checkHealth() {
  if (!isConfigured()) {
    return { state: DetectorHealthState.NOT_CONFIGURED, message: "GPTZERO_API_KEY is not set." };
  }
  try {
    await callGptZero("This is a short connectivity check.");
    return { state: DetectorHealthState.READY, message: "GPTZero reachable and authenticated." };
  } catch (err) {
    return { state: err.healthState || DetectorHealthState.PROVIDER_ERROR, message: err.message };
  }
}

async function scanText(text) {
  const raw = await callGptZero(text);
  return normalizeGptZeroResponse(raw);
}

export const gptZeroProvider = {
  id: "gptzero",
  label: "GPTZero",
  isConfigured,
  checkHealth,
  scanText,
};
