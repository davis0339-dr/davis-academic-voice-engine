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

export function detectorScreenshotPrompt({ extractionMode = "complete", compact = false } = {}) {
  const modeInstruction = extractionMode === "overview_patterns"
    ? "EXTRACTION PHASE: return the overall result and every named writing-pattern card with its legible instances. Return highlightedPassages and flaggedExcerpts as empty arrays in this phase."
    : extractionMode === "highlighted_passages"
      ? "EXTRACTION PHASE: inspect the PDF page by page and return every distinct colour-coded or explicitly classified manuscript passage. Return patternFindings as an empty array in this phase. Record the total report page count, every page inspected, and every page containing passage evidence. Repeat the overall scores only if clearly visible."
      : extractionMode === "page_audit"
        ? "EXTRACTION PHASE: audit page coverage only, then return any coloured passages missed earlier. Record the total report page count, every page inspected, and every page containing passage evidence. Return patternFindings as an empty array."
      : "EXTRACTION PHASE: return the complete overall result, named writing-pattern evidence and colour-coded passage evidence in one response.";
  const compactInstruction = compact
    ? "Use compact JSON. Keep each copied passage or pattern instance to the shortest contiguous 6-24 word excerpt that still maps unambiguously to the report. Do not repeat duplicate excerpts."
    : "Keep copied passages concise while preserving enough contiguous wording to map them to the tested manuscript.";
  return `You are reading ONE user-supplied external AI-writing detector result file. It may be a result screenshot or a full PDF report. The purpose is research logging and source-versus-revision analysis.

Extract only information explicitly supported by the supplied file. Do not infer missing scores and do not claim authorship. For a multi-page PDF, inspect the overall result AND every page that visibly contains colour-coded or distinctly classified manuscript passages.

${modeInstruction}
${compactInstruction}

Return ONLY valid JSON with this exact shape:
{
  "detector": string|null,
  "version": string|null,
  "classification": "ai"|"ai_paraphrased"|"mixed"|"human"|"uncertain"|null,
  "aiScore": number|null,
  "humanScore": number|null,
  "paraphrasedScore": number|null,
  "reportPageCount": number|null,
  "pagesInspected": number[],
  "pagesWithPassageEvidence": number[],
  "flaggedSentenceIndices": number[],
  "flaggedExcerpts": string[],
  "highlightedPassages": [
    {"text": string, "classification": "ai"|"ai_paraphrased"|"mixed"|"human"|"uncertain", "colour": string|null, "page": number|null}
  ],
  "patternFindings": [
    {
      "label": string,
      "description": string|null,
      "reportedCount": number|null,
      "likelihoodText": string|null,
      "instances": [{"text": string, "page": number|null}]
    }
  ],
  "visibleSummary": string,
  "confidence": "high"|"medium"|"low",
  "warnings": string[]
}

Rules:
- Scores are percentages from 0 to 100 only when explicitly shown.
- flaggedSentenceIndices must be zero-based and included only when the report explicitly numbers sentences; otherwise return [].
- Inspect every visible report page for colour-coded or distinctly classified manuscript passages, not only the overall score panel.
- For a PDF, reportPageCount must be the file's total page count; pagesInspected must list every one-based page actually inspected; pagesWithPassageEvidence must list each page on which colour-coded or distinctly classified manuscript text was found. A page without colour evidence still belongs in pagesInspected.
- highlightedPassages must record each legible highlighted passage separately. Copy enough contiguous wording to map it back to the tested manuscript (normally 6-40 words), record the explicit AI/mixed/human classification, the visible colour name when discernible, and the one-based PDF page number when available.
- Some detector interfaces show named writing-pattern cards such as repeated list architecture, contrast templates, sentence-opening habits or other explainable structural tendencies. Record every explicitly named card in patternFindings, including its visible count, description, likelihood/comparison text and each legible linked instance. Preserve the detector's wording; do not invent a pattern name or infer a count.
- patternFindings are observational writing-pattern evidence, not proof of authorship. An isolated instance can be legitimate. Record it accurately and allow the downstream recurrence analysis to decide whether it warrants intervention.
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
  const reportPageCountValue = Number(parsed.reportPageCount);
  const reportPageCount = Number.isInteger(reportPageCountValue) && reportPageCountValue > 0 ? Math.min(500, reportPageCountValue) : null;
  const normalisePages = (value) => Array.isArray(value)
    ? [...new Set(value.map(Number).filter((page) => Number.isInteger(page) && page > 0 && page <= 500))].sort((a, b) => a - b)
    : [];
  const pagesInspected = normalisePages(parsed.pagesInspected);
  const pagesWithPassageEvidence = normalisePages(parsed.pagesWithPassageEvidence);
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
  const patternFindings = Array.isArray(parsed.patternFindings)
    ? parsed.patternFindings.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return null;
        const label = cleanString(row.label, 120);
        if (!label) return null;
        const reportedCount = Number(row.reportedCount);
        const instances = Array.isArray(row.instances)
          ? row.instances.map((instance) => {
              if (!instance || typeof instance !== "object" || Array.isArray(instance)) return null;
              const text = cleanString(instance.text, 500);
              if (!text) return null;
              const page = Number(instance.page);
              return { text, page: Number.isInteger(page) && page > 0 ? page : null };
            }).filter(Boolean).slice(0, 60)
          : [];
        return {
          label,
          description: cleanString(row.description, 500),
          reportedCount: Number.isInteger(reportedCount) && reportedCount >= 0 ? Math.min(1000, reportedCount) : null,
          likelihoodText: cleanString(row.likelihoodText, 160),
          instances,
        };
      }).filter(Boolean).slice(0, 30)
    : [];
  return {
    detector: canonicalDetectorName(parsed.detector),
    version: cleanString(parsed.version, 80),
    classification,
    aiScore: clampScore(parsed.aiScore),
    humanScore: clampScore(parsed.humanScore),
    paraphrasedScore: clampScore(parsed.paraphrasedScore),
    reportPageCount,
    pagesInspected,
    pagesWithPassageEvidence: [...new Set([
      ...pagesWithPassageEvidence,
      ...highlightedPassages.map((row) => row.page).filter(Number.isInteger),
    ])].sort((a, b) => a - b),
    flaggedSentenceIndices,
    flaggedExcerpts: [...new Set([...flaggedExcerpts, ...machinePassageExcerpts])].slice(0, 100),
    highlightedPassages,
    patternFindings,
    visibleSummary: cleanString(parsed.visibleSummary, 1000) || "Detector report analysed; no additional explicit summary was returned.",
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((x) => cleanString(x, 500)).filter(Boolean).slice(0, 10) : [],
  };
}

function confidenceRank(value) {
  return value === "high" ? 3 : value === "medium" ? 2 : value === "low" ? 1 : 0;
}

export function mergeDetectorScreenshotAnalyses(...values) {
  const observations = values.filter(Boolean);
  if (!observations.length) return null;
  const firstValue = (key) => observations.find((row) => row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "")?.[key] ?? null;
  const passageMap = new Map();
  for (const row of observations.flatMap((item) => item.highlightedPassages || [])) {
    const key = `${String(row.text || "").toLowerCase()}|${row.page || ""}|${row.classification || ""}`;
    if (!passageMap.has(key)) passageMap.set(key, row);
  }
  const patternMap = new Map();
  for (const finding of observations.flatMap((item) => item.patternFindings || [])) {
    const key = String(finding.label || "").trim().toLowerCase();
    if (!key) continue;
    const existing = patternMap.get(key);
    if (!existing) {
      patternMap.set(key, { ...finding, instances: [...(finding.instances || [])] });
      continue;
    }
    const instanceMap = new Map([...existing.instances, ...(finding.instances || [])].map((row) => [`${String(row.text || "").toLowerCase()}|${row.page || ""}`, row]));
    existing.instances = [...instanceMap.values()].slice(0, 60);
    if (existing.reportedCount === null && finding.reportedCount !== null) existing.reportedCount = finding.reportedCount;
    if (!existing.description && finding.description) existing.description = finding.description;
    if (!existing.likelihoodText && finding.likelihoodText) existing.likelihoodText = finding.likelihoodText;
  }
  const highlightedPassages = [...passageMap.values()].slice(0, 120);
  const explicitTargets = observations.flatMap((row) => row.flaggedExcerpts || []);
  const passageTargets = highlightedPassages
    .filter((row) => row.classification === "ai" || row.classification === "ai_paraphrased")
    .map((row) => row.text);
  const bestConfidence = observations.map((row) => row.confidence).sort((a, b) => confidenceRank(b) - confidenceRank(a))[0] || "low";
  return {
    detector: firstValue("detector") || "Other",
    version: firstValue("version"),
    classification: firstValue("classification"),
    aiScore: firstValue("aiScore"),
    humanScore: firstValue("humanScore"),
    paraphrasedScore: firstValue("paraphrasedScore"),
    reportPageCount: Math.max(...observations.map((row) => Number(row.reportPageCount) || 0), 0) || null,
    pagesInspected: [...new Set(observations.flatMap((row) => row.pagesInspected || []))].sort((a, b) => a - b),
    pagesWithPassageEvidence: [...new Set(observations.flatMap((row) => row.pagesWithPassageEvidence || []))].sort((a, b) => a - b),
    flaggedSentenceIndices: [...new Set(observations.flatMap((row) => row.flaggedSentenceIndices || []))].slice(0, 1000),
    flaggedExcerpts: [...new Set([...explicitTargets, ...passageTargets].filter(Boolean))].slice(0, 100),
    highlightedPassages,
    patternFindings: [...patternMap.values()].slice(0, 30),
    visibleSummary: observations.map((row) => row.visibleSummary).filter(Boolean).join(" ").slice(0, 1000),
    confidence: bestConfidence,
    warnings: [...new Set(observations.flatMap((row) => row.warnings || []).filter(Boolean))].slice(0, 10),
  };
}
