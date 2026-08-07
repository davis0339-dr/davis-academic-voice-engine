import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTransformationQuality } from "../server/lib/transformationQuality.js";

const source = `Corporate governance influences the way firms are directed and controlled. The board monitors management and protects shareholder interests. Strong governance may improve disclosure quality and reduce agency problems. Audit committees provide an additional layer of oversight over financial reporting. Independent directors can challenge managerial decisions where necessary. Ownership structure also shapes the incentives of controlling shareholders. These mechanisms interact with firm size, leverage, profitability and industry conditions. Their combined effect therefore varies across institutional settings and over time.`;

const nearCopy = source;

const lightRewrite = `Corporate governance shapes the way firms are directed and controlled. The board monitors management while protecting shareholder interests. Strong governance can improve disclosure quality and reduce agency problems. Audit committees add an additional layer of oversight over financial reporting. Independent directors may challenge managerial decisions when necessary. Ownership structure also affects the incentives of controlling shareholders. These mechanisms interact with firm size, leverage, profitability, and industry conditions. Their combined effect varies across institutional settings and over time.`;

const splitNearCopy = `Corporate governance influences the way firms are directed and controlled. The board monitors management. It also protects shareholder interests. Strong governance may improve disclosure quality while reducing agency problems. Audit committees provide an additional layer of oversight over financial reporting. Independent directors can challenge managerial decisions when necessary. Ownership structure shapes the incentives of controlling shareholders. These mechanisms interact with firm size, leverage, profitability and industry conditions. Their combined effect varies across institutional settings and over time.`;

const restructured = `How firms are directed and controlled depends substantially on their governance arrangements. Protecting shareholder interests is one reason boards monitor managerial conduct. Agency problems and disclosure quality may also respond to the strength of those arrangements. Financial reporting receives a further layer of scrutiny through audit committees, while independent directors can challenge management when circumstances require it. The incentives facing controlling shareholders are shaped in part by ownership structure. Firm size, leverage, profitability and industry conditions alter how these mechanisms operate together, so their effects need not be identical across institutions or periods.`;

const choppy = `Governance matters. Boards monitor managers. Shareholders need protection. Disclosure can improve. Agency problems can decline. Audit committees add oversight. Independent directors may challenge management. Ownership structure changes incentives. Firm conditions also matter. Institutional settings differ over time.`;

const conversational = `How firms are run depends on governance. When you look at the board, it monitors management and protects shareholders. The same thing happens with audit committees, and governance doesn't work the same way everywhere. Some arrangements can improve disclosure, while other mechanisms keep agency problems in check. Ownership structure also shapes incentives, but a tiny fraction of the explanation can come from one mechanism alone.`;

test("aggressive mode rejects a near-verbatim rewrite", () => {
  const q = assessTransformationQuality(source, nearCopy, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.five_gram_overlap > 0.9);
  assert.ok(q.unchanged_sentence_ratio > 0.9);
});

test("aggressive mode rejects light synonym edits that retain source sentence skeletons", () => {
  const q = assessTransformationQuality(source, lightRewrite, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.near_source_sentence_ratio > 0.45);
  assert.ok(q.near_source_sentence_count >= 4);
});

test("aggressive mode rejects splitting source sentences without real reconstruction", () => {
  const q = assessTransformationQuality(source, splitNearCopy, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.near_source_sentence_ratio > 0.45 || q.unchanged_sentence_ratio > 0.3);
});

test("aggressive mode accepts a materially restructured academic passage", () => {
  const q = assessTransformationQuality(source, restructured, "aggressive");
  assert.equal(q.passed, true);
  assert.ok(q.five_gram_overlap < 0.62);
  assert.ok(q.unchanged_sentence_ratio <= 0.3);
  assert.ok(q.near_source_sentence_ratio <= 0.45);
});

test("aggressive mode rejects over-segmented choppy prose even when wording changed", () => {
  const q = assessTransformationQuality(source, choppy, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.short_sentence_ratio > 0.32 || q.max_consecutive_short_sentences >= 4 || q.mean_sentence_length < 14);
});

test("aggressive mode rejects newly introduced conversational register", () => {
  const q = assessTransformationQuality(source, conversational, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.direct_address_introduced > 0);
  assert.ok(q.formality_risks_introduced > 0);
});

test("protected citations and figures are removed from rewrite-depth overlap scoring", () => {
  const citationHeavySource = `Audit fees rose from 17.34 in 2023 to 28.2 in 2024 (Smith, 2024; Jones, 2023). The same evidence indicates that market concentration remained high at 99 per cent (Brown, 2025; Green, 2024). These figures frame the competitive problem faced by indigenous audit firms, while regulatory requirements continue to shape the conditions under which those firms operate.`;
  const citationHeavyRevision = `The competitive position of indigenous audit firms must be read against a market in which fee growth and concentration occurred together. Between 2023 and 2024, audit fees moved from 17.34 to 28.2 (Smith, 2024; Jones, 2023). Concentration nevertheless remained at 99 per cent (Brown, 2025; Green, 2024), showing that regulatory conditions and market expansion did not distribute opportunities evenly across firms.`;
  const protectedSpans = {
    citations: ["(Smith, 2024; Jones, 2023)", "(Brown, 2025; Green, 2024)"],
    numbers: ["17.34", "2023", "28.2", "2024", "99"],
    monetary: [],
    statNotation: [],
    quotes: [],
    acronyms: [],
  };

  const q = assessTransformationQuality(citationHeavySource, citationHeavyRevision, "aggressive", { protectedSpans });
  assert.ok(q.raw_five_gram_overlap >= q.five_gram_overlap);
  assert.ok(q.protected_token_share > 0);
});

test("a moderate share of short sentences alone is compatible with sustained academic cadence", () => {
  const mixedCadence = `Governance remains important. Boards monitor management through formal oversight arrangements that are embedded within wider organisational and institutional structures. Audit committees add another layer of scrutiny over financial reporting, while independent directors can challenge managerial decisions when circumstances require it. Ownership matters too. The incentives facing controlling shareholders are partly shaped by ownership structure, although firm size, leverage, profitability and industry conditions alter how those incentives operate across settings. Financial reporting quality also depends on how these mechanisms interact with professional competence and the strength of internal monitoring systems. Institutional conditions influence the effectiveness of governance arrangements because enforcement quality and market development vary across jurisdictions. Outcomes therefore differ across firms, industries and periods even where broadly similar governance mechanisms have been adopted.`;
  const q = assessTransformationQuality(source, mixedCadence, "aggressive");
  assert.ok(q.short_sentence_ratio <= 0.32);
  assert.ok(q.mean_sentence_length >= 14);
});

test("faithful mode reports depth metrics without enforcing aggressive thresholds", () => {
  const q = assessTransformationQuality(source, nearCopy, "faithful");
  assert.equal(q.passed, true);
  assert.ok(q.five_gram_overlap > 0.9);
});
