import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../server/lib/diagnostics.js";
import { buildInterventionPlan } from "../server/lib/planner.js";
import { assessTransformationQuality } from "../server/lib/transformationQuality.js";

const labelledGapSource = `Several unresolved gaps remain in the literature. Conceptually, prior work isolates digitalisation from the resource capabilities needed to execute it, leaving the relationship between strategy and capability insufficiently integrated. Theoretically, resource-based and dynamic-capabilities perspectives remain underused in audit-firm settings despite their wider application elsewhere. Methodologically, much of the evidence is cross-sectional and concentrated on large international firms rather than indigenous practices. Empirically, the moderating role of proactiveness has been examined in manufacturing and small-enterprise settings but not professional audit firms. Contextually, Lagos State is rarely treated as a distinct professional-service ecosystem even though it contains most of Nigeria's premium audit market. These omissions leave the combined effect of strategic initiatives, resource capabilities and proactiveness unresolved for indigenous and mid-tier audit firms.`;

const labelledGapNearCopy = `Several gaps remain unresolved in the literature. Conceptually, previous studies isolate digitalisation from the resource capabilities required to execute it, leaving strategy and capability insufficiently integrated. Theoretically, resource-based and dynamic-capabilities perspectives remain underused in audit-firm settings despite broader use elsewhere. Methodologically, much of the evidence remains cross-sectional and focused on large international firms rather than indigenous practices. Empirically, proactiveness has been examined in manufacturing and small-enterprise settings but not professional audit firms. Contextually, Lagos State is rarely examined as a distinct professional-service ecosystem despite containing most of Nigeria's premium audit market. The combined influence of strategic initiatives, resource capabilities and proactiveness therefore remains unresolved for indigenous and mid-tier audit firms.`;

const integratedGapRevision = `The literature leaves several linked issues unresolved. Research on audit-firm strategy has commonly examined individual responses such as digitalisation without showing how the human, social and financial capabilities of the firm enable those responses. The explanatory basis is also incomplete because resource-based and dynamic-capabilities perspectives, although widely used in management research, have received limited application to audit-firm performance. Existing evidence compounds this weakness: studies are often cross-sectional, concentrate on large international practices and provide little evidence on whether proactiveness changes the effect of strategy and capability in professional services. These limitations are especially important in Lagos State, where the concentration of Nigeria's premium audit market makes indigenous and mid-tier firms a distinct competitive population. The combined relationship among strategic initiatives, resource capabilities and proactiveness therefore remains insufficiently established in this setting.`;

test("planner assigns every labelled gap sentence to substantive restructuring with the scaffold reason", () => {
  const diagnostics = diagnose(labelledGapSource);
  const plan = buildInterventionPlan(diagnostics, {
    rewriteIntensity: "deep",
    lengthPreference: "preserve",
    naturalisation: "aggressive",
  });
  const scaffold = diagnostics.rhetorical_scaffolding.find((i) => i.issue === "gap_label_scaffolding");
  assert.ok(scaffold);
  assert.equal(scaffold.sentenceIndices.length, 5);
  for (const index of scaffold.sentenceIndices) {
    const item = plan.items[index];
    assert.equal(item.level, "SENTENCE_RESTRUCTURE");
    assert.match(item.reasons.join(" "), /connected scholarly argument|labelled/i);
  }
});

test("aggressive quality gate rejects a rewrite that preserves the five-label scaffold", () => {
  const q = assessTransformationQuality(labelledGapSource, labelledGapNearCopy, "aggressive");
  assert.equal(q.passed, false);
  assert.equal(q.rhetorical_resolution.source_gap_label_scaffolding, true);
  assert.equal(q.rhetorical_resolution.revised_gap_label_scaffolding, true);
  assert.match(q.reasons.join(" "), /gap-label scaffold|Conceptual\/Theoretical/i);
});

test("rhetorical-resolution gate recognises when labelled gaps have been integrated into connected prose", () => {
  const q = assessTransformationQuality(labelledGapSource, integratedGapRevision, "aggressive");
  assert.equal(q.rhetorical_resolution.source_gap_label_scaffolding, true);
  assert.equal(q.rhetorical_resolution.revised_gap_label_scaffolding, false);
});

const choppySource = `The older view of audit-firm performance was narrow and compliance-led, concentrating on fee income and the number of statutory engagements secured by the practice. Financial markets deepened. Accountability expectations widened. As those conditions changed, a broader conception of performance emerged, combining revenue growth, competitive position, technical quality and engagement efficiency within the same analytical frame. That shift also reflected the profession's movement toward knowledge-intensive and technology-enabled work rather than statutory compliance alone, while the growing importance of professional capability altered the basis on which firms competed across markets.`;

const choppyStillThere = `The earlier view of audit-firm performance remained narrow and compliance-led, focusing mainly on fee income and the number of statutory engagements secured by a practice. Markets deepened. Expectations widened. As conditions changed, a broader understanding of performance emerged, combining revenue growth, competitive position, technical quality and engagement efficiency within one analytical frame. The change also reflected the profession's movement toward knowledge-intensive and technology-enabled work rather than statutory compliance alone, while professional capability increasingly shaped competition across markets.`;

test("aggressive quality gate rejects an unresolved micro-sentence run that was diagnosed in the source", () => {
  const q = assessTransformationQuality(choppySource, choppyStillThere, "aggressive");
  assert.equal(q.rhetorical_resolution.source_choppy_sentence_run, true);
  assert.equal(q.rhetorical_resolution.revised_choppy_sentence_run, true);
  assert.equal(q.passed, false);
});
