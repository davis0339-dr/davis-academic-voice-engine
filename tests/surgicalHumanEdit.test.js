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
        severity: "clear",
        reason: "Correct possessive form.",
        confidence: 0.99,
      },
      {
        source_span: "as a convenient indices",
        replacement: "as convenient indices",
        category: "article_determiner",
        severity: "clear",
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
        severity: "optional",
        reason: "Make it more academic.",
        confidence: 0.99,
      },
    ],
  });

  assert.equal(result.safe_change_made, false);
  assert.equal(result.revised_text, source);
  assert.ok(result.rejected_edits.some((edit) => edit.rejected_reason === "optional_style_edit"));
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
        severity: "clear",
        reason: "Shorten citation wording.",
        confidence: 0.99,
      },
      {
        source_span: "18 firms",
        replacement: "several firms",
        category: "local_clarity",
        severity: "clear",
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
        severity: "clear",
        reason: "Subject-verb agreement.",
        confidence: 0.99,
      },
      {
        source_span: "objective consider",
        replacement: "objective considers",
        category: "grammar_agreement",
        severity: "clear",
        reason: "Subject-verb agreement.",
        confidence: 0.98,
      },
      {
        source_span: "objective present",
        replacement: "objective presents",
        category: "grammar_agreement",
        severity: "clear",
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

test("human benchmark repairs many objective defects without rewriting clean surrounding prose", () => {
  const source = [
    "The mechanisms may not be viable to emerging markets.",
    "This necessitates to extend the scope of governance practice.",
    "The alternatives can be adaptable to local institutions.",
    "These issues concern stakeholders interests and corporate identity.",
    "The study provides an extended governance structures for transitional markets.",
    "This outline can be considered a theoretical research as much as it is policy research.",
    "The issues are discussed on theoretical basis.",
    "The policy approach results in an actionable variables for practice.",
    "The resulted actionable variables may serve as catalysts for change.",
    "The multi-dimension approach enhances the probability of generalisation.",
    "The methodology distinguishes research design from research methods (McBurney, 1998; Hakim, 1997).",
    "Policy research provides knowledge for action.",
    "Theoretical research provides knowledge for understanding.",
    "Corporate identity remains central to the discussion.",
    "The study retains its original argument sequence.",
    "No new empirical claim is introduced here.",
    "The final discussion concerns qualitative research.",
    "Qualitative research can identify patterns of association.",
    "The passage intentionally retains the author's longer-form academic cadence.",
    "The closing sentence is already grammatically acceptable.",
  ].join(" ");

  const proposals = [
    ["viable to emerging markets", "viable for emerging markets", "preposition_idiom"],
    ["necessitates to extend", "necessitates extending", "idiom_usage"],
    ["can be adaptable to", "can be adapted to", "word_form"],
    ["stakeholders interests", "stakeholders' interests", "possessive"],
    ["an extended governance structures", "extended governance structures", "article_determiner"],
    ["a theoretical research", "theoretical research", "article_determiner"],
    ["on theoretical basis", "on a theoretical basis", "article_determiner"],
    ["an actionable variables", "actionable variables", "article_determiner"],
    ["The resulted actionable variables", "The resulting actionable variables", "word_form"],
    ["The multi-dimension approach", "The multidimensional approach", "word_form"],
  ].map(([source_span, replacement, category], index) => ({
    source_span,
    replacement,
    category,
    severity: "clear",
    reason: "Objective grammar or usage repair.",
    confidence: 0.99 - index * 0.005,
  }));

  const result = applySurgicalEditProposals({
    sourceText: source,
    maxChangedSentenceRatio: 0.50,
    proposals,
  });

  assert.equal(result.applied_edit_count, 10);
  assert.equal(result.affected_sentence_count, 10);
  assert.equal(result.execution_status, "surgical_plan_passed");
  assert.equal(result.preservation.citations_ok, true);
  assert.match(result.revised_text, /viable for emerging markets/);
  assert.match(result.revised_text, /stakeholders' interests/);
  assert.match(result.revised_text, /actionable variables/);
  assert.match(result.revised_text, /\(McBurney, 1998; Hakim, 1997\)/);
  assert.match(result.revised_text, /The closing sentence is already grammatically acceptable\./);
});

test("repeated source spans can be edited safely with an occurrence anchor", () => {
  const source = "This necessitates to extend the analysis. Later, this necessitates to extend the policy discussion.";
  const result = applySurgicalEditProposals({
    sourceText: source,
    maxChangedSentenceRatio: 0.50,
    proposals: [
      {
        source_span: "necessitates to extend",
        replacement: "necessitates extending",
        category: "idiom_usage",
        severity: "clear",
        reason: "Repair verb complementation in the second occurrence only.",
        confidence: 0.98,
        occurrence_number: 2,
      },
    ],
  });

  assert.equal(result.applied_edit_count, 1);
  assert.equal(result.revised_text, "This necessitates to extend the analysis. Later, this necessitates extending the policy discussion.");
});
