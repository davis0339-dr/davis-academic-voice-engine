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
  return `You are reading ONE user-supplied external AI-writing detector result file. It may be a result screenshot or a full PDF report. The purpose is research logging and source-versus-revision analysis.

Extract only information explicitly supported by the supplied file. Do not infer missing scores and do not claim authorship. For a multi-page PDF, inspect the overall result AND every page that visibly contains colour-coded or distinctly classified manuscript passages.

Return ONLY valid JSON with this exact shape:
{
  "detector": string|null,
  "version": string|null,
  "classification": "ai"|"ai_paraphrased"|"mixed"|"human"|"uncertain"|null,
  "aiScore": number|null,
  "humanScore": number|null,
  "paraphrasedScore": number|null,
  "flaggedSentenceIndices": number[],
  "flaggedExcerpts": string[],
  "highlightedPassages": [
    {"text": string, "classification": "ai"|"ai_paraphrased"|"mixed"|"human"|"uncertain", "colour": string|null, "page": number|null}
  ],
  "visibleSummary": string,
  "confidence": "high"|"medium"|"low",
  "warnings": string[]
}

Rules:
- Scores are percentages from 0 to 100 only when explicitly shown.
- flaggedSentenceIndices must be zero-based and included only when the report explicitly numbers sentences; otherwise return [].
- Inspect every visible report page for colour-coded or distinctly classified manuscript passages, not only the overall score panel.
- highlightedPassages must record each legible highlighted passage separately. Copy enough contiguous wording to map it back to the tested manuscript (normally 6-40 words), record the explicit AI/mixed/human classification, the visible colour name when discernible, and the one-based PDF page number when available.
- flaggedExcerpts must contain the text of passages explicitly marked as AI or AI-paraphrased. Do not include green/human passages as rewrite targets.
- Return empty passage arrays only when the report genuinely contains no legible passage-level highlighting. State that limitation in warnings; do not imply that the colour layer was analysed when only the overall score was read.
- If the report uses a label such as AI, Mixed, Human, AI paraphrased, or uncertain, map it conservatively.
- Do not count highlighted words or estimate percentages from coloured areas.
- visibleSummary should state whether passage-level colours were extracted, in addition to the overall result.
- If text is ambiguous, use null and explain in warnings.`;
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
    ? [...new Set(parsed.flaggedExcerpts.map((value) => cleanString(value, 280)).filter(Boolean))].slice(0, 100)
    : [];
  const highlightedPassages = Array.isArray(parsed.highlightedPassages)
    ? parsed.highlightedPassages.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return null;
        const text = cleanString(row.text, 500);
        if (!text) return null;
        const page = Number(row.page);
        return {
          text,
          classification: allowed.has(row.classification) ? row.classification : "uncertain",
          colour: cleanString(row.colour, 40),
          page: Number.isInteger(page) && page > 0 ? page : null,
        };
      }).filter(Boolean).slice(0, 120)
    : [];
  const machinePassageExcerpts = highlightedPassages
    .filter((row) => row.classification === "ai" || row.classification === "ai_paraphrased")
    .map((row) => cleanString(row.text, 280));
  return {
    detector: canonicalDetectorName(parsed.detector),
    version: cleanString(parsed.version, 80),
    classification,
    aiScore: clampScore(parsed.aiScore),
    humanScore: clampScore(parsed.humanScore),
    paraphrasedScore: clampScore(parsed.paraphrasedScore),
    flaggedSentenceIndices,
    flaggedExcerpts: [...new Set([...flaggedExcerpts, ...machinePassageExcerpts])].slice(0, 100),
    highlightedPassages,
    visibleSummary: cleanString(parsed.visibleSummary, 1000) || "Detector report analysed; no additional explicit summary was returned.",
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((x) => cleanString(x, 500)).filter(Boolean).slice(0, 10) : [],
  };
}
