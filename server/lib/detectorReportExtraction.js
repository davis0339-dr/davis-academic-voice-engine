import {
  detectorScreenshotPrompt,
  mergeDetectorScreenshotAnalyses,
  normaliseDetectorScreenshotAnalysis,
} from "./detectorScreenshot.js";

export const DETECTOR_IMAGE_OUTPUT_TOKENS = 5000;
export const DETECTOR_PDF_OUTPUT_TOKENS = 10000;
export const DETECTOR_SEGMENT_OUTPUT_TOKENS = 16000;

const EXTRACTION_SYSTEM = "Extract only explicitly supported information from the supplied detector-result screenshot or PDF report. Return the requested JSON only.";
const REPAIR_SYSTEM = [
  "You repair JSON syntax only.",
  "The supplied text is a detector-report extraction that was intended to be one JSON object.",
  "Preserve every field, passage, pattern, score and warning already present. Do not summarise, rewrite, infer, remove or add evidence.",
  "Correct separators, escaping, brackets and braces, then return exactly one valid JSON object and nothing else.",
].join(" ");

function stoppedForLength(response) {
  return response?.raw?.stop_reason === "max_tokens";
}

function extractionError(message, cause) {
  const err = new Error(message);
  err.code = "DETECTOR_REPORT_STRUCTURE_RECOVERY_FAILED";
  err.cause = cause;
  return err;
}

async function repairSyntax({ provider, text }) {
  const maxTokens = Math.min(DETECTOR_SEGMENT_OUTPUT_TOKENS, Math.max(5000, Math.ceil(String(text || "").length / 2.4)));
  const repaired = await provider.callAnthropic({
    system: REPAIR_SYSTEM,
    messages: [{ role: "user", content: String(text || "") }],
    maxTokens,
  });
  if (stoppedForLength(repaired)) {
    throw extractionError("Detector report recovery exceeded its protected output allowance.");
  }
  try {
    return normaliseDetectorScreenshotAnalysis(repaired.text);
  } catch (err) {
    throw extractionError("Detector report recovery could not produce a complete structured result.", err);
  }
}

async function parseResponse({ provider, response }) {
  if (stoppedForLength(response)) return { observation: null, truncated: true, syntax_repair_used: false };
  try {
    return { observation: normaliseDetectorScreenshotAnalysis(response.text), truncated: false, syntax_repair_used: false };
  } catch {
    return { observation: await repairSyntax({ provider, text: response.text }), truncated: false, syntax_repair_used: true };
  }
}

async function extractPhase({ provider, reportContent, extractionMode }) {
  const response = await provider.callAnthropic({
    system: EXTRACTION_SYSTEM,
    messages: [{
      role: "user",
      content: [
        reportContent,
        { type: "text", text: detectorScreenshotPrompt({ extractionMode, compact: true }) },
      ],
    }],
    maxTokens: DETECTOR_SEGMENT_OUTPUT_TOKENS,
  });
  const parsed = await parseResponse({ provider, response });
  if (parsed.truncated) {
    throw extractionError(`The ${extractionMode.replace(/_/g, " ")} phase exceeded its protected output allowance.`);
  }
  return parsed;
}

export async function extractDetectorReportObservation({ provider, reportContent, mimeType }) {
  const initial = await provider.callAnthropic({
    system: EXTRACTION_SYSTEM,
    messages: [{
      role: "user",
      content: [reportContent, { type: "text", text: detectorScreenshotPrompt() }],
    }],
    maxTokens: mimeType === "application/pdf" ? DETECTOR_PDF_OUTPUT_TOKENS : DETECTOR_IMAGE_OUTPUT_TOKENS,
  });
  const parsed = await parseResponse({ provider, response: initial });
  if (!parsed.truncated) {
    return {
      observation: parsed.observation,
      extraction: {
        complete: true,
        strategy: parsed.syntax_repair_used ? "single_pass_with_syntax_recovery" : "single_pass",
        provider_calls: parsed.syntax_repair_used ? 2 : 1,
        syntax_repair_used: parsed.syntax_repair_used,
        segmented_recovery_used: false,
      },
    };
  }

  // A length-stopped response is missing evidence and must never be repaired by
  // merely closing its JSON. Re-read the report in two bounded phases instead.
  const overview = await extractPhase({ provider, reportContent, extractionMode: "overview_patterns" });
  const passages = await extractPhase({ provider, reportContent, extractionMode: "highlighted_passages" });
  const observation = mergeDetectorScreenshotAnalyses(overview.observation, passages.observation);
  if (!observation) throw extractionError("Detector report segmented recovery returned no usable observation.");
  return {
    observation,
    extraction: {
      complete: true,
      strategy: "segmented_full_report_recovery",
      provider_calls: 3 + Number(overview.syntax_repair_used) + Number(passages.syntax_repair_used),
      syntax_repair_used: overview.syntax_repair_used || passages.syntax_repair_used,
      segmented_recovery_used: true,
    },
  };
}
