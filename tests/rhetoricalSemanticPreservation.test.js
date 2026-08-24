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
  // The precise comparison-strength defect is sufficient. Do not duplicate the
  // same finding under the less informative unsupported-addition category.
  assert.equal(report.unsupported_additions.length, 0);
});

test("substantive reconstruction is not rejected merely for lower lexical overlap", () => {
  const source = [
    "Creditors assess financial condition, but they also examine the structures through which managers are monitored and information is disclosed.",
    "Where governance mechanisms reduce perceived risk, lenders may demand a lower return, whereas weak arrangements may lead them to require compensation for uncertainty.",
    "This relationship matters because borrowing costs influence investment, profitability and the firm's capacity to pursue long-term opportunities.",
  ].join(" ");
  const reconstructed = [
    "Loan pricing depends on more than a firm's accounts. Lenders also consider managerial oversight and the credibility of disclosure when judging risk.",
    "Effective governance may therefore support cheaper borrowing; weaker arrangements, by contrast, can leave creditors seeking compensation for uncertainty.",
    "The consequences extend to investment choices, profitability and the resources available for longer-term opportunities.",
  ].join(" ");
  const report = analyseRhetoricalSemanticPreservation(source, reconstructed, { lengthPreference: "maintain" });
  assert.equal(report.passed, true);
  assert.equal(report.lexical_overlap_is_supporting_evidence_only, true);
});

test("semantic-force auditing is local rather than triggered by unrelated document vocabulary", () => {
  const sourceText = "Board independence is associated with borrowing cost within this sample. A separate methodological paragraph explains that leverage can lead to estimation bias.";
  const safeRevision = "Within this sample, borrowing cost is related to board independence. The separate methodological discussion explains that leverage can lead to estimation bias.";
  const unsafeRevision = "Within this sample, board independence determines borrowing cost. The separate methodological discussion explains that leverage can lead to estimation bias.";
  assert.equal(analyseRhetoricalSemanticPreservation(sourceText, safeRevision, { lengthPreference: "maintain" }).passed, true);
  const unsafe = analyseRhetoricalSemanticPreservation(sourceText, unsafeRevision, { lengthPreference: "maintain" });
  assert.equal(unsafe.passed, false);
  assert.equal(unsafe.causality_changes.length, 1);
});

test("associational language cannot become influence or prediction without author permission", () => {
  const sourceText = "Within this sample, board oversight is linked to financing outcomes.";
  for (const revisedText of [
    "Within this sample, board oversight influences financing outcomes.",
    "Within this sample, board oversight predicts financing outcomes.",
  ]) {
    const report = analyseRhetoricalSemanticPreservation(sourceText, revisedText, { lengthPreference: "maintain" });
    assert.equal(report.passed, false);
    assert.equal(report.causality_changes.length, 1);
  }
});

test("role-marker changes remain review evidence when propositions and paragraph architecture survive", () => {
  const reconstructed = source
    .replace("Commercial scale, however, does not eliminate the professional-performance problem.", "Large international networks still face the professional problem of engagement performance.")
    .replace("Canada provides a complementary picture.", "The Canadian evidence extends the comparison.");
  const report = analyseRhetoricalSemanticPreservation(source, reconstructed, { lengthPreference: "maintain" });
  assert.ok(report.role_losses.length > 0);
  assert.ok(report.possible_transition_role_changes > 0);
  assert.equal(report.material_rhetorical_role_loss, false);
  assert.equal(report.transitions_lost, 0);
  assert.equal(report.passed, true);
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

