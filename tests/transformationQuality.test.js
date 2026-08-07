import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTransformationQuality } from "../server/lib/transformationQuality.js";

const source = `Corporate governance influences the way firms are directed and controlled. The board monitors management and protects shareholder interests. Strong governance may improve disclosure quality and reduce agency problems. Audit committees provide an additional layer of oversight over financial reporting. Independent directors can challenge managerial decisions where necessary. Ownership structure also shapes the incentives of controlling shareholders. These mechanisms interact with firm size, leverage, profitability and industry conditions. Their combined effect therefore varies across institutional settings and over time.`;

const nearCopy = `Corporate governance influences the way firms are directed and controlled. The board monitors management and protects shareholder interests. Strong governance may improve disclosure quality and reduce agency problems. Audit committees provide an additional layer of oversight over financial reporting. Independent directors can challenge managerial decisions where necessary. Ownership structure also shapes the incentives of controlling shareholders. These mechanisms interact with firm size, leverage, profitability and industry conditions. Their combined effect therefore varies across institutional settings and over time.`;

const restructured = `How firms are directed and controlled depends substantially on their governance arrangements. Protecting shareholder interests is one reason boards monitor managerial conduct. Agency problems and disclosure quality may also respond to the strength of those arrangements. Financial reporting receives a further layer of scrutiny through audit committees, while independent directors can challenge management when circumstances require it. The incentives facing controlling shareholders are shaped in part by ownership structure. Firm size, leverage, profitability and industry conditions alter how these mechanisms operate together, so their effects need not be identical across institutions or periods.`;

test("aggressive mode rejects a near-verbatim rewrite", () => {
  const q = assessTransformationQuality(source, nearCopy, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.five_gram_overlap > 0.9);
  assert.ok(q.unchanged_sentence_ratio > 0.9);
});

test("aggressive mode accepts a materially restructured passage", () => {
  const q = assessTransformationQuality(source, restructured, "aggressive");
  assert.equal(q.passed, true);
  assert.ok(q.five_gram_overlap < 0.62);
  assert.ok(q.unchanged_sentence_ratio <= 0.3);
});

test("faithful mode reports depth metrics without enforcing the aggressive thresholds", () => {
  const q = assessTransformationQuality(source, nearCopy, "faithful");
  assert.equal(q.passed, true);
  assert.ok(q.five_gram_overlap > 0.9);
});
