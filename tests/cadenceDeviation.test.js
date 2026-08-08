import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessCadenceDeviation } from "../server/lib/cadenceDeviation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "detector-benchmark", name), "utf8");

const AI_SAMPLE = fixture("ai-sample-01-ridwan-salaudeen.txt");
const HUMAN_SAMPLE = fixture("human-sample-01-corporate-governance.txt");

test("refuses to compare against a family with too few measured sources", () => {
  const result = assessCadenceDeviation("Some short text.", { document_type: "journal_article" });
  assert.equal(result.available, false);
  assert.equal(result.range_position, "unavailable");
  assert.match(result.reason, /below the .* minimum/);
});

test("the AI-described sample (2026-08-07 fixture pair) is flagged above the observed thesis-family cadence range", () => {
  const result = assessCadenceDeviation(AI_SAMPLE, { document_type: "thesis" });
  assert.equal(result.available, true);
  assert.equal(result.range_position, "above_observed_range");
  assert.equal(result.threshold_flagged, true);
  assert.ok(result.flags.some((f) => f.type === "mean_sentence_length_exceeds_observed_range"));
  assert.ok(result.flags.some((f) => f.type === "long_sentence_proportion_exceeds_observed_range"));
  assert.ok(result.doc.mean > result.family.meanSentenceLengthMax, "sanity: this sample's mean genuinely exceeds the family max");
});

test("the human-described sample (2026-08-07 fixture pair) falls inside the observed thesis-family cadence range", () => {
  const result = assessCadenceDeviation(HUMAN_SAMPLE, { document_type: "thesis" });
  assert.equal(result.available, true);
  assert.equal(result.range_position, "within_observed_range");
  assert.equal(result.threshold_flagged, false);
  assert.equal(result.flags.length, 0);
  assert.ok(result.doc.mean >= result.family.meanSentenceLengthMin && result.doc.mean <= result.family.meanSentenceLengthMax);
});

test("a document can sit below the raw observed range without falsely being labelled within range or triggering a high-cadence flag", () => {
  const shortPassage = [
    "This sentence is short.",
    "The next sentence is short too.",
    "Evidence remains limited here.",
    "The argument continues plainly.",
    "Another concise statement follows.",
    "The final sentence remains brief.",
  ].join(" ");
  const result = assessCadenceDeviation(shortPassage, { document_type: "thesis" });
  assert.equal(result.available, true);
  assert.equal(result.range_position, "below_observed_range");
  assert.equal(result.threshold_flagged, false);
  assert.equal(result.flags.length, 0);
  assert.match(result.range_message, /below the raw observed family range/i);
});

test("never claims authorship -- the note explicitly disclaims that framing", () => {
  const result = assessCadenceDeviation(AI_SAMPLE, { document_type: "thesis" });
  assert.match(result.note, /not evidence of who or what wrote/);
});
