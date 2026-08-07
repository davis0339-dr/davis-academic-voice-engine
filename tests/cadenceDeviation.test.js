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
  // document_type=journal_article resolves directly (3 matching documents
  // clears the emerging-evidence threshold, so compileFamily doesn't fall
  // back further) but only 1 of those 3 has cadence stats measured -- a
  // real case where match-count strength and cadence-measurement strength
  // diverge, which is exactly what MIN_FAMILY_SAMPLE guards against.
  const result = assessCadenceDeviation("Some short text.", { document_type: "journal_article" });
  assert.equal(result.available, false);
  assert.match(result.reason, /below the .* minimum/);
});

test("the AI-described sample (2026-08-07 fixture pair) is flagged as outside the observed thesis-family cadence range", () => {
  const result = assessCadenceDeviation(AI_SAMPLE, { document_type: "thesis" });
  assert.equal(result.available, true);
  assert.ok(result.flags.some((f) => f.type === "mean_sentence_length_exceeds_observed_range"));
  assert.ok(result.flags.some((f) => f.type === "long_sentence_proportion_exceeds_observed_range"));
  assert.ok(result.doc.mean > result.family.meanSentenceLengthMax, "sanity: this sample's mean genuinely exceeds the family max");
});

test("the human-described sample (2026-08-07 fixture pair) falls inside the observed thesis-family cadence range", () => {
  const result = assessCadenceDeviation(HUMAN_SAMPLE, { document_type: "thesis" });
  assert.equal(result.available, true);
  assert.equal(result.flags.length, 0);
  assert.ok(result.doc.mean >= result.family.meanSentenceLengthMin && result.doc.mean <= result.family.meanSentenceLengthMax);
});

test("never claims authorship -- the note explicitly disclaims that framing", () => {
  const result = assessCadenceDeviation(AI_SAMPLE, { document_type: "thesis" });
  assert.match(result.note, /not evidence of who or what wrote/);
});
