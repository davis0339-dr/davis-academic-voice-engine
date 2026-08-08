// GPTZero provider adapter used by the Detector Research Lab.
// The adapter keeps the provider's probabilistic output and sentence highlighting
// available for comparative research; it does not convert a classifier score into
// proof of authorship. Raw responses remain visible for schema-audit purposes.

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

function normalizeSentenceRows(doc) {
  const candidates = [doc?.sentences, doc?.sentence_classifications, doc?.sentenceClassifications]
    .find((value) => Array.isArray(value)) || [];
  return candidates.map((row, index) => ({
    index,
    text: row?.sentence || row?.text || row?.content || null,
    predictedClass: row?.predicted_class || row?.predictedClass || row?.classification || null,
    generatedProb: row?.generated_prob ?? row?.generatedProb ?? row?.ai_probability ?? row?.probability ?? null,
    highlightForAi: Boolean(row?.highlight_sentence_for_ai ?? row?.highlightSentenceForAi ?? row?.highlighted),
    confidenceCategory: row?.confidence_category || row?.confidenceCategory || null,
  }));
}

export function normalizeGptZeroResponse(raw) {
  const doc = raw && Array.isArray(raw.documents) && raw.documents.length > 0 ? raw.documents[0] : null;

  if (!doc) {
    return {
      provider: "gptzero",
      parseWarning: "Response did not contain a recognizable `documents[0]` entry; showing raw response only.",
      summary: null,
      sentences: [],
      raw,
    };
  }

  const classProbabilities = doc.class_probabilities || doc.classProbabilities || null;
  const predictedClass = doc.predicted_class || doc.predictedClass || doc.document_classification || doc.documentClassification || null;
  const documentClassification = doc.document_classification || doc.documentClassification || predictedClass;
  const confidenceCategory = doc.confidence_category || doc.confidenceCategory || null;
  const completelyGeneratedProb = doc.completely_generated_prob ?? doc.completelyGeneratedProb ?? null;
  const averageGeneratedProb = doc.average_generated_prob ?? doc.averageGeneratedProb ?? null;
  const subclass = doc.subclass || doc.subclasses || null;
  const sentences = normalizeSentenceRows(doc);
  const highlightedSentenceIndices = sentences.filter((row) => row.highlightForAi).map((row) => row.index);

  const foundAnyField = [classProbabilities, predictedClass, documentClassification, confidenceCategory, completelyGeneratedProb, averageGeneratedProb, subclass, sentences.length].some(
    (v) => v !== null && v !== undefined && v !== 0
  );

  return {
    provider: "gptzero",
    modelVersion: raw?.version || raw?.model_version || doc?.version || doc?.model_version || null,
    parseWarning: foundAnyField
      ? null
      : "Recognized documents[0] but none of the expected score fields were present; API shape may have changed. Showing raw response.",
    summary: {
      predictedClass,
      documentClassification,
      confidenceCategory,
      classProbabilities,
      completelyGeneratedProb,
      averageGeneratedProb,
      subclass,
      highlightedSentenceIndices,
    },
    sentences,
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
