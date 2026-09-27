import test from "node:test";
import assert from "node:assert/strict";
import {
  DETECTOR_SEGMENT_OUTPUT_TOKENS,
  extractDetectorReportObservation,
} from "../server/lib/detectorReportExtraction.js";

function response(value, stopReason = "end_turn") {
  return { text: typeof value === "string" ? value : JSON.stringify(value), raw: { stop_reason: stopReason } };
}

function observation(overrides = {}) {
  return {
    detector: "GPTZero",
    version: "4.9b",
    classification: "ai",
    aiScore: 100,
    humanScore: 0,
    paraphrasedScore: 0,
    reportPageCount: 5,
    pagesInspected: [1, 2, 3, 4, 5],
    pagesWithPassageEvidence: [],
    flaggedSentenceIndices: [],
    flaggedExcerpts: [],
    highlightedPassages: [],
    patternFindings: [],
    visibleSummary: "Complete detector result.",
    confidence: "high",
    warnings: [],
    ...overrides,
  };
}

function queuedProvider(items) {
  const calls = [];
  return {
    calls,
    async callAnthropic(options) {
      calls.push(options);
      const next = items.shift();
      if (!next) throw new Error("Unexpected provider call");
      return next;
    },
  };
}

test("PDF detector extraction requires separate overview and page-audited passage responses", async () => {
  const provider = queuedProvider([
    response(observation({ patternFindings: [{ label: "Everything in threes", reportedCount: 2, instances: [] }] })),
    response(observation({ highlightedPassages: [{ text: "A mapped passage from page five", classification: "ai", colour: "orange", page: 5 }], pagesWithPassageEvidence: [5] })),
  ]);
  const result = await extractDetectorReportObservation({ provider, reportContent: { type: "document" }, mimeType: "application/pdf" });
  assert.equal(provider.calls.length, 2);
  assert.ok(provider.calls.every((call) => call.maxTokens === DETECTOR_SEGMENT_OUTPUT_TOKENS));
  assert.equal(result.extraction.complete, true);
  assert.equal(result.extraction.strategy, "page_audited_segmented_extraction");
  assert.deepEqual(result.extraction.pages_inspected, [1, 2, 3, 4, 5]);
  assert.deepEqual(result.extraction.pages_with_passage_evidence, [5]);
  assert.equal(result.observation.aiScore, 100);
});

test("malformed but complete detector JSON receives one syntax-only recovery", async () => {
  const provider = queuedProvider([
    response('{"detector":"GPTZero","classification":"ai" "aiScore":100}'),
    response(observation()),
  ]);
  const result = await extractDetectorReportObservation({ provider, reportContent: { type: "image" }, mimeType: "image/png" });
  assert.equal(provider.calls.length, 2);
  assert.equal(result.extraction.complete, true);
  assert.equal(result.extraction.strategy, "single_pass_with_syntax_recovery");
  assert.match(provider.calls[1].system, /repair JSON syntax only/i);
});

test("PDF extraction merges complete pattern and passage phases", async () => {
  const provider = queuedProvider([
    response(observation({
      patternFindings: [{ label: "Everything in threes", description: "Tidy triads", reportedCount: 7, likelihoodText: "1.6x", instances: [{ text: "one, two, and three", page: 4 }] }],
      visibleSummary: "Overall result and named patterns extracted.",
    })),
    response(observation({
      highlightedPassages: [{ text: "Creditors judge whether management is monitored reliably", classification: "ai", colour: "purple", page: 2 }],
      pagesWithPassageEvidence: [2],
      visibleSummary: "All colour-coded passages extracted.",
    })),
  ]);
  const result = await extractDetectorReportObservation({ provider, reportContent: { type: "document" }, mimeType: "application/pdf" });
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(provider.calls.map((call) => call.maxTokens), [DETECTOR_SEGMENT_OUTPUT_TOKENS, DETECTOR_SEGMENT_OUTPUT_TOKENS]);
  assert.equal(result.extraction.complete, true);
  assert.equal(result.extraction.strategy, "page_audited_segmented_extraction");
  assert.equal(result.observation.patternFindings.length, 1);
  assert.equal(result.observation.highlightedPassages.length, 1);
  assert.deepEqual(result.observation.flaggedExcerpts, ["Creditors judge whether management is monitored reliably"]);
});

test("a length-stopped segmented phase cannot be presented as a complete report", async () => {
  const provider = queuedProvider([
    response("{", "max_tokens"),
  ]);
  await assert.rejects(
    () => extractDetectorReportObservation({ provider, reportContent: { type: "document" }, mimeType: "application/pdf" }),
    (err) => err?.code === "DETECTOR_REPORT_STRUCTURE_RECOVERY_FAILED" && /output allowance/i.test(err.message)
  );
});

test("a PDF with unproved page coverage receives one audit recovery and rejects partial coverage", async () => {
  const incomplete = observation({ reportPageCount: 5, pagesInspected: [5], pagesWithPassageEvidence: [5] });
  const provider = queuedProvider([response(incomplete), response(incomplete), response(incomplete)]);
  await assert.rejects(
    () => extractDetectorReportObservation({ provider, reportContent: { type: "document" }, mimeType: "application/pdf" }),
    (err) => err?.code === "DETECTOR_REPORT_STRUCTURE_RECOVERY_FAILED" && /missing page/i.test(err.message)
  );
  assert.equal(provider.calls.length, 3);
});
