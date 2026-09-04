import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DETECTOR_SCREENSHOT_BYTES,
  MAX_DETECTOR_REPORT_PDF_BYTES,
  validateDetectorScreenshotPayload,
  normaliseDetectorScreenshotAnalysis,
  mergeDetectorScreenshotAnalyses,
} from "../server/lib/detectorScreenshot.js";

test("accepts PNG/JPEG screenshots and rejects unsupported report types", () => {
  const payload = Buffer.from("small-image-fixture").toString("base64");
  const result = validateDetectorScreenshotPayload({ mimeType: "image/png", imageBase64: payload });
  assert.equal(result.bytes, Buffer.byteLength("small-image-fixture"));

  assert.throws(
    () => validateDetectorScreenshotPayload({ mimeType: "text/plain", fileBase64: payload }),
    /PNG, JPEG or PDF/
  );
});

test("accepts a signed PDF detector report and rejects disguised PDF data", () => {
  const pdf = Buffer.from("%PDF-1.7\nGPTZero report fixture").toString("base64");
  const result = validateDetectorScreenshotPayload({ mimeType: "application/pdf", fileBase64: pdf });
  assert.equal(result.kind, "pdf_report");
  assert.equal(result.maximumBytes, MAX_DETECTOR_REPORT_PDF_BYTES);
  assert.throws(
    () => validateDetectorScreenshotPayload({ mimeType: "application/pdf", fileBase64: Buffer.from("not-a-pdf").toString("base64") }),
    /valid PDF signature/
  );
});

test("rejects screenshots above the decoded 2 MB cap", () => {
  const huge = Buffer.alloc(MAX_DETECTOR_SCREENSHOT_BYTES + 1, 1).toString("base64");
  assert.throws(
    () => validateDetectorScreenshotPayload({ mimeType: "image/jpeg", imageBase64: huge }),
    /2 MB/
  );
});

test("rejects PDF reports above the decoded 5 MB cap", () => {
  const huge = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_DETECTOR_REPORT_PDF_BYTES, 1)]).toString("base64");
  assert.throws(
    () => validateDetectorScreenshotPayload({ mimeType: "application/pdf", fileBase64: huge }),
    /5 MB/
  );
});

test("normalises visible detector screenshot observations without inventing scores", () => {
  const parsed = normaliseDetectorScreenshotAnalysis(JSON.stringify({
    detector: "Turnitin",
    version: null,
    classification: "ai",
    aiScore: 100,
    humanScore: 0,
    paraphrasedScore: null,
    flaggedSentenceIndices: [],
    flaggedExcerpts: ["highlighted academic passage"],
    visibleSummary: "AI 100%, Mixed 0%, Human 0% visibly reported.",
    confidence: "high",
    warnings: [],
  }));
  assert.equal(parsed.detector, "Turnitin");
  assert.equal(parsed.aiScore, 100);
  assert.equal(parsed.humanScore, 0);
  assert.equal(parsed.paraphrasedScore, null);
  assert.deepEqual(parsed.flaggedSentenceIndices, []);
  assert.deepEqual(parsed.flaggedExcerpts, ["highlighted academic passage"]);
});

test("extracts colour-coded passage evidence as structured, mappable observations", () => {
  const parsed = normaliseDetectorScreenshotAnalysis(JSON.stringify({
    detector: "GPTZero",
    classification: "ai",
    aiScore: 100,
    flaggedSentenceIndices: [],
    flaggedExcerpts: [],
    highlightedPassages: [
      { text: "Creditors must assess whether management is reliably monitored", classification: "ai", colour: "yellow", page: 3 },
      { text: "The purpose of this explanatory sequential mixed methods study", classification: "human", colour: "green", page: 5 },
    ],
    visibleSummary: "Overall AI result plus two highlighted passages.",
    confidence: "high",
    warnings: [],
  }));
  assert.equal(parsed.highlightedPassages.length, 2);
  assert.deepEqual(parsed.flaggedExcerpts, ["Creditors must assess whether management is reliably monitored"]);
  assert.equal(parsed.highlightedPassages[0].colour, "yellow");
  assert.equal(parsed.highlightedPassages[1].classification, "human");
});

test("canonicalises branded detector labels returned with interface suffixes", () => {
  const parsed = normaliseDetectorScreenshotAnalysis(JSON.stringify({
    detector: "GPTZero AI Detection",
    version: "Model 4.9b",
    classification: "ai",
    aiScore: 100,
    humanScore: 0,
    paraphrasedScore: null,
    flaggedSentenceIndices: [],
    flaggedExcerpts: [],
    visibleSummary: "GPTZero result",
    confidence: "high",
    warnings: [],
  }));
  assert.equal(parsed.detector, "GPTZero");
});

test("merges segmented pattern and passage evidence without duplicate targets", () => {
  const merged = mergeDetectorScreenshotAnalyses(
    {
      detector: "GPTZero", classification: "ai", aiScore: 100, humanScore: 0, paraphrasedScore: 0,
      flaggedSentenceIndices: [], flaggedExcerpts: [], highlightedPassages: [],
      patternFindings: [{ label: "Everything in threes", description: "Triads", reportedCount: 7, likelihoodText: "1.6x", instances: [{ text: "a, b, and c", page: 3 }] }],
      visibleSummary: "Patterns extracted.", confidence: "high", warnings: [],
    },
    {
      detector: "GPTZero", classification: "ai", aiScore: 100, humanScore: 0, paraphrasedScore: 0,
      flaggedSentenceIndices: [], flaggedExcerpts: [],
      highlightedPassages: [{ text: "The same detector target", classification: "ai", colour: "purple", page: 2 }, { text: "The same detector target", classification: "ai", colour: "purple", page: 2 }],
      patternFindings: [], visibleSummary: "Passages extracted.", confidence: "high", warnings: [],
    }
  );
  assert.equal(merged.patternFindings.length, 1);
  assert.equal(merged.highlightedPassages.length, 1);
  assert.deepEqual(merged.flaggedExcerpts, ["The same detector target"]);
});
