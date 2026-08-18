import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyseRhetoricalSemanticPreservation, buildRhetoricalLedger } from "../server/lib/rhetoricalPreservation.js";
import { auditPreservation } from "../server/lib/preservation.js";
import { extractProtectedSpans } from "../server/lib/protect.js";
import { deriveLongDocumentChunkPolicy } from "../server/lib/longDocumentIntelligence.js";

const source = fs.readFileSync(new URL("./fixtures/rhetorical-preservation/audit-firm-architecture.txt", import.meta.url), "utf8");

test("normal-length preservation flags architecture-stripping compression", () => {
  const compressed = source
    .replace(/Audit-firm performance[^.]+\.\s*/, "")
    .replace(/The organisational character[^.]+\.\s*/, "")
    .replace(/Commercial scale, however,[^.]+\.\s*/, "")
    .replace(/Its relevance is instead that[^.]+\.\s*/, "")
    .replace(/This tension is visible in North America\.\s*/, "")
    .replace(/Canada provides a complementary picture\.\s*/, "")
    .replace(/Across Europe,[^.]+\.\s*/, "")
    .replace(/The improvement is material,[^.]+\./, "Concentrated market strength and engagement deficiencies coexist.");
  const report = analyseRhetoricalSemanticPreservation(source, compressed, { lengthPreference: "maintain" });
  assert.equal(report.passed, false);
  assert.ok(report.overall_length_ratio < 0.9);
  assert.ok(report.possible_proposition_losses.length > 0);
  assert.ok(report.transitions_lost > 0);
  assert.ok(report.interpretive_statements_lost > 0);
});

test("semantic audit rejects unsupported equality", () => {
  const drifted = source.replace(
    "Organisational performance may also encompass market outcomes and operating effectiveness",
    "Market outcomes and operating effectiveness may matter equally"
  );
  const report = analyseRhetoricalSemanticPreservation(source, drifted, { lengthPreference: "maintain" });
  assert.equal(report.passed, false);
  assert.ok(report.comparison_magnitude_or_direction_changes.length > 0);
  assert.ok(report.unsupported_additions.length > 0);
});

test("balanced contrast survives when wording and punctuation remain unchanged", () => {
  const report = auditPreservation(source, source, extractProtectedSpans(source), { lengthPreference: "maintain" });
  assert.equal(report.rhetorical_semantic_ok, true);
  assert.equal(report.rhetorical_semantic_preservation.contrast_or_concession_lost, 0);
  assert.equal(report.rhetorical_semantic_preservation.overall_length_ratio, 1);
});

test("rhetorical ledger records paragraph functions without embedding source sentences", () => {
  const ledger = buildRhetoricalLedger(source);
  assert.ok(ledger.length >= 6);
  assert.ok(ledger.some((paragraph) => paragraph.sentences.some((sentence) => sentence.roles.includes("authorial_interpretation"))));
  assert.ok(ledger.some((paragraph) => paragraph.sentences.some((sentence) => sentence.roles.includes("geographic_or_conceptual_transition"))));
  assert.equal(JSON.stringify(ledger).includes("Audit-firm performance therefore"), false);
});

test("long-document policy carries Maintain into the same rhetorical audit contract", () => {
  const policy = deriveLongDocumentChunkPolicy({
    sourceText: source,
    requestedIntensity: "deep",
    requestedNaturalisation: "authorial",
    requestedLengthPreference: "maintain",
  });
  assert.equal(policy.effective.lengthPreference, "maintain");
  const compressed = source.split(/\n\n/).map((paragraph) => paragraph.split(/(?<=[.!?])\s+/).slice(1).join(" ")).join("\n\n");
  const report = auditPreservation(source, compressed, extractProtectedSpans(source), {
    lengthPreference: policy.effective.lengthPreference,
  });
  assert.equal(report.rhetorical_semantic_ok, false);
  assert.ok(report.rhetorical_semantic_preservation.topic_or_framing_sentences_lost > 0);
});

