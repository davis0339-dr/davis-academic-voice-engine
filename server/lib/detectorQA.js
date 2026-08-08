// External detector QA / research orchestration.
//
// Detector outputs are empirical observations about classifier behaviour, not
// ground truth about authorship. They may be compared with linguistic features,
// preservation results and revision history so the product can learn where
// classifiers agree, disagree and produce false-positive risk. Generation must
// still preserve facts, citations, methods and the user's intellectual content.

import { gptZeroProvider } from "./detectorProviders/gptzero.js";
import { copyleaksProvider } from "./detectorProviders/copyleaks.js";

const PROVIDERS = [gptZeroProvider, copyleaksProvider];

export const DISCLAIMER =
  "Detector results are classifier observations, not proof of authorship. The research layer may compare detector outcomes with measurable linguistic features and revision history, but academic-content preservation remains a hard constraint and cross-detector disagreement must remain visible.";

export async function listDetectorHealth() {
  return Promise.all(PROVIDERS.map(async (p) => ({ id: p.id, label: p.label, ...(await p.checkHealth()) })));
}

function gptZeroObservation(result) {
  const s = result?.summary || {};
  const probs = s.classProbabilities || {};
  const aiProb = Number(
    probs.ai ?? probs.generated ?? probs.completely_generated ?? s.completelyGeneratedProb ?? s.averageGeneratedProb
  );
  const humanProb = Number(probs.human);
  const subclass = result?.raw?.documents?.[0]?.subclass || result?.raw?.documents?.[0]?.subclasses || null;
  const paraphraseValue = Number(
    subclass?.ai_paraphrased?.probability ?? subclass?.ai_paraphrased ?? subclass?.paraphrased?.probability ?? subclass?.paraphrased
  );
  return {
    detector: "GPTZero",
    version: result?.raw?.version || result?.raw?.model_version || result?.raw?.documents?.[0]?.version || null,
    classification: s.predictedClass || null,
    aiScore: Number.isFinite(aiProb) ? (aiProb <= 1 ? aiProb * 100 : aiProb) : null,
    humanScore: Number.isFinite(humanProb) ? (humanProb <= 1 ? humanProb * 100 : humanProb) : null,
    paraphrasedScore: Number.isFinite(paraphraseValue) ? (paraphraseValue <= 1 ? paraphraseValue * 100 : paraphraseValue) : null,
  };
}

function copyleaksObservation(result) {
  return {
    detector: "Copyleaks",
    version: result?.modelVersion || null,
    classification: Number(result?.summary?.ai) > Number(result?.summary?.human) ? "ai" : "human",
    aiScore: Number.isFinite(Number(result?.summary?.ai)) ? Number(result.summary.ai) * 100 : null,
    humanScore: Number.isFinite(Number(result?.summary?.human)) ? Number(result.summary.human) * 100 : null,
  };
}

export function providerResultToObservation(result) {
  if (!result || result.state !== "READY") return null;
  if (result.id === "gptzero") return gptZeroObservation(result);
  if (result.id === "copyleaks") return copyleaksObservation(result);
  return null;
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
  const all = [...results, ...skipped];
  const observations = all.map(providerResultToObservation).filter(Boolean);
  return { results: all, observations, disclaimer: DISCLAIMER };
}
