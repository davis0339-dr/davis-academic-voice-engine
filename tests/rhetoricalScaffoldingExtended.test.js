import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences } from "../server/lib/sentences.js";
import { findRhetoricalScaffolding } from "../server/lib/rhetoricalDiagnostics.js";
import { assessTransformationQuality } from "../server/lib/transformationQuality.js";

const proxySource = `Aggregate expansion conceals different performance pressures across indigenous audit firms. In revenue growth, international networks capture most of the sector's fee expansion while smaller practices record limited gains. In market share, premium listed-company engagements remain concentrated among the largest international networks. In audit quality, weaker access to technology and specialist resources constrains the capacity of smaller firms. In operational efficiency, skills shortages and uneven digital systems raise the cost and duration of engagement delivery. These combined pressures limit the ability of indigenous firms to compete sustainably within the professional-services market.`;

const proxyStillVisible = `The aggregate figures hide several pressures affecting indigenous audit firms. Revenue growth remains uneven because international networks capture most fee expansion while smaller practices record only limited gains. Market share continues to favour the largest international networks, particularly in premium listed-company engagements. Audit quality remains constrained where smaller firms have weaker access to technology and specialist resources. Operational efficiency is also weakened by skills shortages and uneven digital systems that raise engagement cost and duration. Together, these pressures restrict the capacity of indigenous firms to compete sustainably in the professional-services market.`;

const proxyIntegrated = `The aggregate figures hide a connected competitive problem for indigenous audit firms. Fee expansion has been captured disproportionately by international networks, and that imbalance is reinforced by their control of premium listed-company engagements. Smaller practices therefore face not only a narrower revenue base but also fewer opportunities to build market presence. The same resource disadvantage affects the technical quality and efficiency of engagements because limited access to specialist skills and digital systems raises delivery costs while constraining assurance capability. Taken together, these conditions weaken sustainable competition across all four performance dimensions.`;

test("rhetorical diagnostics detect a consecutive performance-proxy checklist", () => {
  const issues = findRhetoricalScaffolding(splitSentences(proxySource));
  const proxy = issues.find((issue) => issue.issue === "proxy_label_scaffolding");
  assert.ok(proxy);
  assert.ok(proxy.labels.length >= 3);
});

test("aggressive quality gate rejects a rewritten proxy checklist that preserves the category-led scaffold", () => {
  const q = assessTransformationQuality(proxySource, proxyStillVisible, "aggressive");
  assert.equal(q.rhetorical_resolution.source_proxy_label_scaffolding, true);
  assert.equal(q.rhetorical_resolution.revised_proxy_label_scaffolding, true);
  assert.equal(q.passed, false);
  assert.ok(q.reasons.some((reason) => reason.includes("performance-proxy checklist")));
});

test("integrating the performance dimensions resolves the proxy scaffold", () => {
  const q = assessTransformationQuality(proxySource, proxyIntegrated, "aggressive");
  assert.equal(q.rhetorical_resolution.source_proxy_label_scaffolding, true);
  assert.equal(q.rhetorical_resolution.revised_proxy_label_scaffolding, false);
});

test("rhetorical diagnostics can identify repeated demonstrative bridge subjects as a soft cohesion signal", () => {
  const text = `The market expanded substantially during the period. This expansion increased the value of assurance activity. Investor expectations also became more demanding. This change raised the importance of audit quality. Regulators responded with stronger oversight requirements. These reforms altered how firms organised quality management. Competition remained concentrated despite those changes. This pattern placed additional pressure on smaller practices. Client demand also shifted toward technology-enabled assurance. These developments changed the capabilities firms needed to compete.`;
  const issues = findRhetoricalScaffolding(splitSentences(text));
  assert.ok(issues.some((issue) => issue.issue === "demonstrative_bridge_overuse"));
});
