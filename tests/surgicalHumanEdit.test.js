import { test } from "node:test";
import assert from "node:assert/strict";
import { applySurgicalEditProposals } from "../server/lib/surgicalHumanEdit.js";

test("surgical recovery improves local grammar while preserving untouched human-textured prose", () => {
  const source = [
    "Corporate orientation towards its stakeholders interests is important to emerging markets.",
    "This necessitates a firm to depend on its stakeholders as a convenient indices that determine corporate identity in the marketplace.",
    "The methodology distinguishes research design from research methods (McBurney, 1998; Hakim, 1997).",
    "Policy research provides knowledge for action, while theoretical research provides knowledge for understanding.",
  ].join(" ");

  const result = applySurgicalEditProposals({
    sourceText: source,
    maxChangedSentenceRatio: 0.50,
    proposals: [
      {
        source_span: "stakeholders interests",
        replacement: "stakeholders' interests",
        category: "possessive",
        reason: "Correct possessive form.",
        confidence: 0.99,
      },
      {
        source_span: "as a convenient indices",
        replacement: "as convenient indices",
        category: "article_determiner",
        reason: "Remove article before plural noun.",
        confidence: 0.98,
      },
    ],
  });

  assert.equal(result.safe_change_made, true);
  assert.equal(result.applied_edit_count, 2);
  assert.match(result.revised_text, /stakeholders' interests/);
  assert.match(result.revised_text, /as convenient indices/);
  assert.match(result.revised_text, /Policy research provides knowledge for action, while theoretical research provides knowledge for understanding\./);
  assert.match(result.revised_text, /\(McBurney, 1998; Hakim, 1997\)/);
  assert.equal(result.preservation.citations_ok, true);
  assert.equal(result.preservation.numbers_ok, true);
});

test("surgical recovery rejects stylistic re-authoring that is not a local correction", () => {
  const source = "A prompt can tell an AI to vary sentence length. A corpus can show it how sentence lengths actually vary.";
  const result = applySurgicalEditProposals({
    sourceText: source,
    maxChangedSentenceRatio: 0.50,
    proposals: [
      {
        source_span: "A prompt can tell an AI to vary sentence length.",
        replacement: "Instructional prompts may be strategically deployed to manipulate syntactic cadence across generated discourse.",
        category: "local_clarity",
        reason: "Make it more academic.",
        confidence: 0.99,
      },
    ],
  });

  assert.equal(result.safe_change_made, false);
  assert.equal(result.revised_text, source);
  assert.ok(result.rejected_edits.some((edit) => edit.rejected_reason === "replacement_not_surgical" || edit.rejected_reason === "replacement_size_out_of_bounds"));
});

test("surgical recovery rejects edits that alter protected citations or numbers", () => {
  const source = "The approach was discussed by McBurney (1998) and involved 18 firms.";
  const result = applySurgicalEditProposals({
    sourceText: source,
    maxChangedSentenceRatio: 1,
    proposals: [
      {
        source_span: "McBurney (1998)",
        replacement: "McBurney",
        category: "local_clarity",
        reason: "Shorten citation wording.",
        confidence: 0.99,
      },
      {
        source_span: "18 firms",
        replacement: "several firms",
        category: "local_clarity",
        reason: "Generalise the count.",
        confidence: 0.99,
      },
    ],
  });

  assert.equal(result.safe_change_made, false);
  assert.equal(result.revised_text, source);
  assert.ok(result.rejected_edits.length >= 2);
});

test("surgical recovery enforces a maximum number of affected sentences", () => {
  const source = [
    "The first objective examine governance practice.",
    "The second objective consider non-financial issues.",
    "The third objective present the framework in applied form.",
    "The final section discuss research methods.",
  ].join(" ");

  const result = applySurgicalEditProposals({
    sourceText: source,
    maxChangedSentenceRatio: 0.25,
    proposals: [
      {
        source_span: "objective examine",
        replacement: "objective examines",
        category: "grammar_agreement",
        reason: "Subject-verb agreement.",
        confidence: 0.99,
      },
      {
        source_span: "objective consider",
        replacement: "objective considers",
        category: "grammar_agreement",
        reason: "Subject-verb agreement.",
        confidence: 0.98,
      },
      {
        source_span: "objective present",
        replacement: "objective presents",
        category: "grammar_agreement",
        reason: "Subject-verb agreement.",
        confidence: 0.97,
      },
    ],
  });

  assert.equal(result.sentence_change_ceiling, 1);
  assert.equal(result.affected_sentence_count, 1);
  assert.equal(result.applied_edit_count, 1);
  assert.ok(result.rejected_edits.some((edit) => edit.rejected_reason === "sentence_change_ceiling"));
});
