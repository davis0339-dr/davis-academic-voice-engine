export const MAX_DETECTOR_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_DETECTOR_REPORT_PDF_BYTES = 5 * 1024 * 1024;
export const DETECTOR_REPORT_MIME_TYPES = new Set(["image/png", "image/jpeg", "application/pdf"]);
export const DETECTOR_SCREENSHOT_MIME_TYPES = DETECTOR_REPORT_MIME_TYPES;

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

export function validateDetectorScreenshotPayload({ mimeType, fileBase64, imageBase64 } = {}) {
  if (!DETECTOR_REPORT_MIME_TYPES.has(mimeType)) {
    const err = new Error("Detector evidence must be a PNG, JPEG or PDF report.");
    err.code = "UNSUPPORTED_REPORT_TYPE";
    throw err;
  }
  const encoded = typeof fileBase64 === "string" ? fileBase64 : imageBase64;
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) {
    const err = new Error("Detector report payload is not valid base64 data.");
    err.code = "BAD_REPORT_DATA";
    throw err;
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) {
    const err = new Error("Detector report file is empty.");
    err.code = "BAD_REPORT_DATA";
    throw err;
  }
  const maximumBytes = mimeType === "application/pdf" ? MAX_DETECTOR_REPORT_PDF_BYTES : MAX_DETECTOR_SCREENSHOT_BYTES;
  if (bytes.length > maximumBytes) {
    const err = new Error(mimeType === "application/pdf"
      ? "Detector PDF report exceeds the 5 MB limit."
      : "Detector screenshot exceeds the 2 MB image limit.");
    err.code = "REPORT_TOO_LARGE";
    err.status = 413;
    throw err;
  }
  if (mimeType === "application/pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    const err = new Error("The uploaded file does not contain a valid PDF signature.");
    err.code = "BAD_REPORT_DATA";
    throw err;
  }
  return {
    bytes: bytes.length,
    mimeType,
    fileBase64: encoded,
    kind: mimeType === "application/pdf" ? "pdf_report" : "result_screenshot",
    maximumBytes,
  };
}

export function detectorScreenshotPrompt() {
  return `You are reading ONE user-supplied external AI-writing detector result file. It may be a result screenshot or a full PDF report. The purpose is research logging and source-versus-revision analysis.\n\nExtract only information explicitly supported by the supplied file. Do not infer missing scores and do not claim authorship. For a multi-page PDF, use the overall document result and capture short flagged excerpts only when the report explicitly marks them.\n\nReturn ONLY valid JSON with this exact shape:\n{\n  "detector": string|null,\n  "version": string|null,\n  "classification": "ai"|"ai_paraphrased"|"mixed"|"human"|"uncertain"|null,\n  "aiScore": number|null,\n  "humanScore": number|null,\n  "paraphrasedScore": number|null,\n  "flaggedSentenceIndices": number[],\n  "flaggedExcerpts": string[],\n  "visibleSummary": string,\n  "confidence": "high"|"medium"|"low",\n  "warnings": string[]\n}\n\nRules:\n- Scores are percentages from 0 to 100 only when explicitly shown.\n- flaggedSentenceIndices must be zero-based and included only when the report explicitly numbers sentences; otherwise return [].\n- flaggedExcerpts may contain short verbatim excerpts only when the report visibly highlights or distinctly classifies those words. Return [] when no highlighted passage is legible. Do not infer missing text.\n- If the report uses a label such as AI, Mixed, Human, AI paraphrased, or uncertain, map it conservatively.\n- Do not count highlighted words or estimate percentages from coloured areas.\n- visibleSummary should briefly state exactly what the supplied screenshot or PDF report explicitly reports.\n- If text is ambiguous, use null and explain in warnings.`;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try { return JSON.parse(candidate); } catch {}
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
  throw new Error("Detector report analysis did not return valid JSON.");
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
    visibleSummary: cleanString(parsed.visibleSummary, 1000) || "Detector report analysed; no additional explicit summary was returned.",
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((x) => cleanString(x, 500)).filter(Boolean).slice(0, 10) : [],
  };
}
