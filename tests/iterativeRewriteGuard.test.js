import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessIterativeRegularisation,
  buildIterativeRewriteDirective,
  iterativeCorrectionBlock,
  normaliseRewriteLineage,
} from "../server/lib/iterativeRewriteGuard.js";

const root = [
  "Corporate debt is an important source of finance for U.S. firms, but lenders look beyond accounting ratios.",
  "They also consider reporting quality, board oversight, managerial power and the board's ability to monitor risk.",
  "Some governance arrangements are associated with ratings, yields and loan terms.",
  "The evidence is not always consistent across firms or credit conditions.",
  "Board independence may help creditors in some settings and matter less in others.",
  "Leadership structure can also affect how lenders interpret risk.",
  "The study therefore examines several board characteristics together.",
  "It focuses on manufacturing firms over a recent ten-year period.",
].join(" ");

const regularised = [
  "Corporate indebtedness constitutes a primary financing mechanism within prevailing U.S. institutional conditions, while creditor pricing determinations extend materially beyond conventional accounting-ratio evaluation.",
  "Reporting integrity, oversight effectiveness, managerial-authority allocation and risk-control capacity collectively shape lender assessment processes.",
  "Governance configuration is associated with credit-rating outcomes, yield compression and contractual loan-pricing structures.",
  "Empirical relationships nevertheless exhibit contextual instability across firm-level and macro-financial environments.",
  "Board-independence architecture may generate creditor-risk mitigation under selected institutional configurations while producing attenuated effects elsewhere.",
  "Leadership-structure concentration additionally influences professional interpretations of governance-related risk exposure.",
  "Accordingly, the investigation integrates multiple directorial characteristics within a unified explanatory specification.",
  "The empirical scope centres on manufacturing corporations observed across a contemporary decennial interval.",
].join(" ");

test("rewrite lineage activates only for a genuine rewrite-of-rewrite chain", () => {
  assert.deepEqual(normaliseRewriteLineage({ sourceGeneration: 0, rootSourceText: root }, root), {
    source_generation: 0,
    chained_from_prior_revision: false,
    root_source_text: "",
  });

  const chained = normaliseRewriteLineage({ sourceGeneration: 1, rootSourceText: root }, regularised);
  assert.equal(chained.source_generation, 1);
  assert.equal(chained.chained_from_prior_revision, true);
  assert.equal(chained.root_source_text, root);
});

test("cumulative lexical formalisation is flagged against the retained root source", () => {
  const assessment = assessIterativeRegularisation({
    sourceText: regularised,
    candidateText: regularised.replace("primary financing mechanism", "principal capital-allocation mechanism"),
    rewriteLineage: { sourceGeneration: 1, rootSourceText: root },
  });

  assert.equal(assessment.available, true);
  assert.equal(assessment.source_generation, 1);
  assert.ok(assessment.score > 0);
  assert.ok(assessment.reasons.some((reason) => /Nominalisation|Long-word|Average word length|formalisation|regularisation/i.test(reason)));
});

test("iterative directive tells the model to de-regularise rather than chase rewrite distance", () => {
  const directive = buildIterativeRewriteDirective({
    sourceText: regularised,
    rewriteLineage: { sourceGeneration: 2, rootSourceText: root },
  });
  assert.match(directive, /cumulative machine regularisation/i);
  assert.match(directive, /rewrite distance is not a goal/i);
  assert.match(directive, /ROOT SOURCE/i);
  assert.match(directive, /ordinary academic wording/i);
});

test("blocking iterative assessment produces a targeted correction block", () => {
  const block = iterativeCorrectionBlock({
    available: true,
    blocking: true,
    reasons: ["Nominalisation density rose materially."],
  });
  assert.match(block, /DE-REGULARISATION/i);
  assert.match(block, /Nominalisation density rose materially/);
  assert.match(block, /fake errors/i);
});
