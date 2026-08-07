import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTransformationQuality } from "../server/lib/transformationQuality.js";

const source = `Corporate governance influences the way firms are directed and controlled. The board monitors management and protects shareholder interests. Strong governance may improve disclosure quality and reduce agency problems. Audit committees provide an additional layer of oversight over financial reporting. Independent directors can challenge managerial decisions where necessary. Ownership structure also shapes the incentives of controlling shareholders. These mechanisms interact with firm size, leverage, profitability and industry conditions. Their combined effect therefore varies across institutional settings and over time.`;

const nearCopy = source;

const restructured = `How firms are directed and controlled depends substantially on their governance arrangements. Protecting shareholder interests is one reason boards monitor managerial conduct. Agency problems and disclosure quality may also respond to the strength of those arrangements. Financial reporting receives a further layer of scrutiny through audit committees, while independent directors can challenge management when circumstances require it. The incentives facing controlling shareholders are shaped in part by ownership structure. Firm size, leverage, profitability and industry conditions alter how these mechanisms operate together, so their effects need not be identical across institutions or periods.`;

const choppy = `Governance matters. Boards monitor managers. Shareholders need protection. Disclosure can improve. Agency problems can decline. Audit committees add oversight. Independent directors may challenge management. Ownership structure changes incentives. Firm conditions also matter. Institutional settings differ over time.`;

const conversational = `How firms are run depends on governance. When you look at the board, it monitors management and protects shareholders. The same thing happens with audit committees, and governance doesn't work the same way everywhere. Some arrangements can improve disclosure, while other mechanisms keep agency problems in check. Ownership structure also shapes incentives, but a tiny fraction of the explanation can come from one mechanism alone.`;

test("aggressive mode rejects a near-verbatim rewrite", () => {
  const q = assessTransformationQuality(source, nearCopy, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.five_gram_overlap > 0.9);
  assert.ok(q.unchanged_sentence_ratio > 0.9);
});

test("aggressive mode accepts a materially restructured academic passage", () => {
  const q = assessTransformationQuality(source, restructured, "aggressive");
  assert.equal(q.passed, true);
  assert.ok(q.five_gram_overlap < 0.62);
  assert.ok(q.unchanged_sentence_ratio <= 0.3);
});

test("aggressive mode rejects over-segmented choppy prose even when wording changed", () => {
  const q = assessTransformationQuality(source, choppy, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.short_sentence_ratio > 0.24 || q.max_consecutive_short_sentences >= 4);
});

test("aggressive mode rejects newly introduced conversational register", () => {
  const q = assessTransformationQuality(source, conversational, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.direct_address_introduced > 0);
  assert.ok(q.formality_risks_introduced > 0);
});

test("faithful mode reports depth metrics without enforcing aggressive thresholds", () => {
  const q = assessTransformationQuality(source, nearCopy, "faithful");
  assert.equal(q.passed, true);
  assert.ok(q.five_gram_overlap > 0.9);
});
