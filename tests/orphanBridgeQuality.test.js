import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTransformationQuality } from "../server/lib/transformationQuality.js";

const source = `Audit markets differ substantially across regions, and those differences matter for the performance of smaller firms. Developed markets are mature and highly concentrated, while several Asian jurisdictions allow domestic networks to retain more meaningful competitive positions. Narrowing the lens to Africa, audit firm performance is conditioned by tighter resource constraints and a fragile talent pipeline even in the continent's most developed audit jurisdiction. The Middle East and Africa account for only a small share of global assurance activity, with South Africa contributing the largest continental portion. These conditions frame the environment in which Nigerian audit firms must compete.`;

const introducedBridge = `Regional differences in audit markets shape the opportunities available to smaller firms. Mature developed markets remain highly concentrated, whereas domestic networks retain a stronger position in several Asian jurisdictions.\n\nNarrowing the lens to Africa, audit firm performance is conditioned by tighter resource constraints and a fragile talent pipeline.\n\nAfrica accounts for only a small portion of worldwide assurance activity, and South Africa contributes the largest continental share. Those conditions create a distinct competitive environment for Nigerian audit firms, particularly practices without the scale of the international networks.`;

const integratedBridge = `Regional differences in audit markets shape the opportunities available to smaller firms. Mature developed markets remain highly concentrated, whereas domestic networks retain a stronger position in several Asian jurisdictions. The African setting introduces a different constraint: a fragile professional talent pipeline operates alongside tighter resource limits and a comparatively small share of worldwide assurance activity. South Africa contributes the largest continental portion, but these wider conditions still frame the competitive environment faced by Nigerian audit firms.`;

test("aggressive quality gate rejects a bridge-only paragraph introduced by the rewrite", () => {
  const q = assessTransformationQuality(source, introducedBridge, "aggressive");
  assert.equal(q.passed, false);
  assert.ok(q.introduced_orphan_bridge_paragraphs >= 1);
  assert.ok(q.reasons.some((reason) => reason.includes("bridge-only paragraph")));
});

test("integrating the transition into substantive reasoning avoids the bridge-only defect", () => {
  const q = assessTransformationQuality(source, integratedBridge, "aggressive");
  assert.equal(q.introduced_orphan_bridge_paragraphs, 0);
});
