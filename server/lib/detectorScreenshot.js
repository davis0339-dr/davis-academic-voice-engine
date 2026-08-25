export const MAX_DETECTOR_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const DETECTOR_SCREENSHOT_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

function clampScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Number(n.toFixed(1)))) : null;
}

function cleanString(value, max = 500) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

export function canonicalDetectorName(value) {
  const text = cleanString(value, 80) || "";
  const lower = text.toLowerCase();
  if (lower.includes("gptzero")) return "GPTZero";
  if (lower.includes("turnitin")) return "Turnitin";
  if (lower.includes("copyleaks")) return "Copyleaks";
  if (lower.includes("originality")) return "Originality.ai";
  if (lower.includes("stealthwriter")) return "Stealthwriter";
  return text || "Other";
}

export function validateDetectorScreenshotPayload({ mimeType, imageBase64 } = {}) {
  if (!DETECTOR_SCREENSHOT_MIME_TYPES.has(mimeType)) {
    const err = new Error("Only one PNG or JPEG detector-result screenshot is accepted.");
    err.code = "UNSUPPORTED_SCREENSHOT_TYPE";
    throw err;
  }
  if (typeof imageBase64 !== "string" || !/^[A-Za-z0-9+/=\r\n]+$/.test(imageBase64)) {
    const err = new Error("Screenshot payload is not valid base64 image data.");
    err.code = "BAD_SCREENSHOT_DATA";
    throw err;
  }
  const bytes = Buffer.from(imageBase64, "base64");
  if (!bytes.length) {
    const err = new Error("Screenshot image is empty.");
    err.code = "BAD_SCREENSHOT_DATA";
    throw err;
  }
  if (bytes.length > MAX_DETECTOR_SCREENSHOT_BYTES) {
    const err = new Error("Detector screenshot exceeds the 2 MB image limit.");
    err.code = "SCREENSHOT_TOO_LARGE";
    err.status = 413;
    throw err;
  }
  return { bytes: bytes.length, mimeType, imageBase64 };
}

export function detectorScreenshotPrompt() {
  return `You are reading ONE screenshot of an external AI-writing detector result for research logging and source-versus-revision analysis.\n\nExtract only information visibly supported by the screenshot. Do not infer missing scores and do not claim authorship. The purpose is to save a frustrated researcher from manually transcribing detector evidence.\n\nReturn ONLY valid JSON with this exact shape:\n{\n  "detector": string|null,\n  "version": string|null,\n  "classification": "ai"|"ai_paraphrased"|"mixed"|"human"|"uncertain"|null,\n  "aiScore": number|null,\n  "humanScore": number|null,\n  "paraphrasedScore": number|null,\n  "flaggedSentenceIndices": number[],\n  "flaggedExcerpts": string[],\n  "visibleSummary": string,\n  "confidence": "high"|"medium"|"low",\n  "warnings": string[]\n}\n\nRules:\n- Scores are percentages from 0 to 100 only when visibly shown.\n- flaggedSentenceIndices must be zero-based and included only when the screenshot explicitly numbers sentences; otherwise return [].\n- flaggedExcerpts may contain short verbatim excerpts only when the screenshot visibly highlights or distinctly classifies those words. Return [] when no highlighted passage is legible. Do not infer missing text.\n- If the screenshot uses a label such as AI, Mixed, Human, AI paraphrased, or uncertain, map it conservatively.\n- Do not count highlighted words or estimate percentages from coloured areas.\n- visibleSummary should briefly state exactly what the screenshot visibly reports.\n- If text is ambiguous, use null and explain in warnings.`;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try { return JSON.parse(candidate); } catch {}
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
  throw new Error("Screenshot analysis did not return valid JSON.");
}

export function normaliseDetectorScreenshotAnalysis(modelText) {
  const parsed = extractJson(modelText);
  const allowed = new Set(["ai", "ai_paraphrased", "mixed", "human", "uncertain"]);
  const classification = allowed.has(parsed.classification) ? parsed.classification : null;
  const flaggedSentenceIndices = Array.isArray(parsed.flaggedSentenceIndices)
    ? [...new Set(parsed.flaggedSentenceIndices.map(Number).filter((n) => Number.isInteger(n) && n >= 0))].slice(0, 1000)
    : [];
  const flaggedExcerpts = Array.isArray(parsed.flaggedExcerpts)
    ? [...new Set(parsed.flaggedExcerpts.map((value) => cleanString(value, 500)).filter(Boolean))].slice(0, 100)
    : [];
  return {
    detector: canonicalDetectorName(parsed.detector),
    version: cleanString(parsed.version, 80),
    classification,
    aiScore: clampScore(parsed.aiScore),
    humanScore: clampScore(parsed.humanScore),
    paraphrasedScore: clampScore(parsed.paraphrasedScore),
    flaggedSentenceIndices,
    flaggedExcerpts,
    visibleSummary: cleanString(parsed.visibleSummary, 1000) || "Detector screenshot analysed; no additional visible summary was returned.",
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((x) => cleanString(x, 500)).filter(Boolean).slice(0, 10) : [],
  };
}
