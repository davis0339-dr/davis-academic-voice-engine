import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DETECTOR_SCREENSHOT_BYTES,
  validateDetectorScreenshotPayload,
  normaliseDetectorScreenshotAnalysis,
} from "../server/lib/detectorScreenshot.js";

test("accepts one small PNG/JPEG base64 payload and rejects unsupported types", () => {
  const payload = Buffer.from("small-image-fixture").toString("base64");
  const result = validateDetectorScreenshotPayload({ mimeType: "image/png", imageBase64: payload });
  assert.equal(result.bytes, Buffer.byteLength("small-image-fixture"));

  assert.throws(
    () => validateDetectorScreenshotPayload({ mimeType: "application/pdf", imageBase64: payload }),
    /PNG or JPEG/
  );
});

test("rejects screenshots above the decoded 2 MB cap", () => {
  const huge = Buffer.alloc(MAX_DETECTOR_SCREENSHOT_BYTES + 1, 1).toString("base64");
  assert.throws(
    () => validateDetectorScreenshotPayload({ mimeType: "image/jpeg", imageBase64: huge }),
    /2 MB/
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
