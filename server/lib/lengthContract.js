import { wordCount } from "./sentences.js";

export const DEFAULT_EXPAND_MIN_ADDITION_WORDS = 200;
export const DEFAULT_EXPAND_TARGET_ADDITION_WORDS = 260;
export const DEFAULT_EXPAND_MAX_ADDITION_WORDS = 420;

export function normaliseLengthMode(preference = "auto") {
  const requested = String(preference || "auto").toLowerCase();
  if (["normal", "maintain", "preserve", "same", "same_length", "similar"].includes(requested)) return "maintain";
  if (["short", "shorter", "concise"].includes(requested)) return "concise";
  if (["long", "longer", "expand"].includes(requested)) return "expand";
  return "auto";
}

export function buildLengthContract({ sourceText = "", preference = "auto", minimumExpansionWords } = {}) {
  const sourceWords = wordCount(sourceText);
  const mode = normaliseLengthMode(preference);
  const minimumAddition = mode === "expand"
    ? Math.max(0, Math.round(Number.isFinite(Number(minimumExpansionWords))
      ? Number(minimumExpansionWords)
      : DEFAULT_EXPAND_MIN_ADDITION_WORDS))
    : 0;
  const explicitMinimum = mode === "expand" && Number.isFinite(Number(minimumExpansionWords));
  const targetAddition = mode === "expand"
    ? explicitMinimum
      ? minimumAddition + Math.max(8, Math.round(minimumAddition * 0.30))
      : Math.max(minimumAddition, DEFAULT_EXPAND_TARGET_ADDITION_WORDS)
    : 0;
  const maximumAddition = mode === "expand"
    ? explicitMinimum
      ? targetAddition + Math.max(12, Math.round(minimumAddition * 0.50))
      : Math.max(targetAddition, DEFAULT_EXPAND_MAX_ADDITION_WORDS)
    : 0;
  return {
    mode,
    source_words: sourceWords,
    minimum_addition_words: minimumAddition,
    target_addition_words: targetAddition,
    maximum_addition_words: maximumAddition,
    minimum_candidate_words: sourceWords + minimumAddition,
    target_candidate_words: sourceWords + targetAddition,
    maximum_candidate_words: sourceWords + maximumAddition,
  };
}

export function lengthContractSatisfied(candidateText, contract) {
  if (!contract || contract.mode !== "expand") return true;
  return wordCount(candidateText) >= Number(contract.minimum_candidate_words || 0);
}
