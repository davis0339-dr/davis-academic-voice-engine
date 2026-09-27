import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildManuscriptDevelopmentUnits,
  buildStudioHumanReasoningGuide,
  integrateRawAuthorContributions,
  normalizeDevelopmentDiagnosis,
} from "../server/lib/researchDevelopment.js";

const manuscript = `Introduction

Corporate governance influences financing decisions, although the pathway is not fully explained.

Prior findings point in different directions. The study nevertheless assumes one uniform effect.`;

test("development diagnosis uses stable manuscript blocks and covers every block", () => {
  const units = buildManuscriptDevelopmentUnits(manuscript);
  const paragraph = units.find((unit) => unit.paragraph_index === 2);
  const result = normalizeDevelopmentDiagnosis({
    overview: "The contradiction needs the author's decision.",
    tasks: [{
      id: "task-1",
      block_id: paragraph.block_id,
      scope: "paragraph",
      action: "resolve_contradiction",
      anchor: "different directions",
      diagnosis: "The reviewed evidence conflicts with the uniform expectation.",
      question: "Why does the study retain one expected direction?",
      why_it_matters: "The answer determines the study's theoretical position.",
      preserve: "Retain the disagreement in prior findings.",
      verification_sensitivity: "low",
    }],
  }, units);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].paragraph_index, 2);
  assert.equal(result.tasks[0].source_text, paragraph.text);
  assert.equal(result.coverage.length, units.length);
  assert.equal(result.coverage.find((row) => row.block_id === paragraph.block_id).decision, "author_action");
});

test("raw integration inserts only explicitly accepted researcher wording and never transforms it", () => {
  const units = buildManuscriptDevelopmentUnits(manuscript);
  const target = units.find((unit) => unit.paragraph_index === 1);
  const exactWords = "My own point is that lenders are not only looking at ratios. They are judging whether the people controlling the firm can be trusted with borrowed money.";
  const result = integrateRawAuthorContributions(manuscript, [
    { contribution_id: "accepted", block_id: target.block_id, raw_text: exactWords, operation: "append_after", researcher_status: "accepted" },
    { contribution_id: "unreviewed", block_id: target.block_id, raw_text: "This must not enter.", operation: "append_after", researcher_status: "unreviewed" },
  ]);
  assert.match(result.draft, new RegExp(exactWords.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result.draft, /This must not enter/);
  assert.equal(result.ledger.length, 1);
  assert.equal(result.ledger[0].raw_text, exactWords);
  assert.equal(result.ledger[0].transformation, "none");
});

test("raw replacement uses the researcher's exact wording instead of a model rewrite", () => {
  const units = buildManuscriptDevelopmentUnits(manuscript);
  const target = units.find((unit) => unit.paragraph_index === 2);
  const raw = "I can see two opposing positions here and I have not yet decided that one effect should apply in every firm.";
  const result = integrateRawAuthorContributions(manuscript, [
    { block_id: target.block_id, raw_text: raw, operation: "replace_block", researcher_status: "accepted" },
  ]);
  assert.match(result.draft, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result.draft, /Prior findings point in different directions/);
});

test("Studio diagnosis guidance is grounded in all three supplied thesis profiles", () => {
  const guide = buildStudioHumanReasoningGuide("introduction");
  assert.equal(guide.profiles.length, 3);
  assert.deepEqual(new Set(guide.profiles.map((profile) => profile.id)), new Set(["adeoye-2013", "abdulkarim-2012", "rugangira-2012"]));
  assert.match(guide.purpose, /Do not imitate wording/i);
  assert.ok(guide.applicable_moves.length >= 3);
});
