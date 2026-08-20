import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCollaborativeRevisionPromptBlock,
  ensureCollaborativeReviewInputs,
  normalizeAdditionalInputs,
  normalizeRevisionPurpose,
} from "../server/lib/collaborativeRevision.js";

const editorHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const editorApp = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const promptContract = readFileSync(new URL("../server/lib/promptContract.js", import.meta.url), "utf8");
const rewriteRoute = readFileSync(new URL("../server/routes/rewrite.js", import.meta.url), "utf8");
const modelResponse = readFileSync(new URL("../server/lib/modelResponse.js", import.meta.url), "utf8");

test("revision purpose defaults safely to fidelity and recognises collaborative revision", () => {
  assert.equal(normalizeRevisionPurpose(), "fidelity");
  assert.equal(normalizeRevisionPurpose("unexpected"), "fidelity");
  assert.equal(normalizeRevisionPurpose("fidelity"), "fidelity");
  assert.equal(normalizeRevisionPurpose("collaborative"), "collaborative");
});

test("fidelity mode cannot release model-proposed additions", () => {
  const additions = normalizeAdditionalInputs([
    {
      kind: "evidence",
      location: "Paragraph 2",
      proposal: "Add recent evidence on creditor monitoring.",
      reason: "The mechanism is asserted but not evidenced.",
      status: "verification_required",
    },
  ], "fidelity");

  assert.deepEqual(additions, []);
  assert.match(buildCollaborativeRevisionPromptBlock("fidelity"), /additional_inputs must be an empty array/i);
});

test("collaborative mode normalises bounded, reviewable additions without treating them as manuscript content", () => {
  const additions = normalizeAdditionalInputs([
    {
      kind: "evidence",
      location: "cost-of-debt mechanism",
      proposal: "Check whether board independence is associated with lower borrowing spreads in the target setting.",
      reason: "The draft currently moves from monitoring to debt pricing without direct support.",
      status: "verification_required",
      researcher_question: "Which evidence do you want to rely on for this link?",
      evidence_needed: "A directly relevant study or supplied dataset result.",
    },
    {
      kind: "invented-category",
      proposal: "Clarify whether this is a causal or associational argument.",
      status: "silently_inserted",
    },
    { kind: "idea", proposal: "" },
  ], "collaborative");

  assert.equal(additions.length, 2);
  assert.deepEqual(additions[0], {
    id: "additional-input-1",
    kind: "evidence",
    location: "cost-of-debt mechanism",
    proposal: "Check whether board independence is associated with lower borrowing spreads in the target setting.",
    reason: "The draft currently moves from monitoring to debt pricing without direct support.",
    status: "verification_required",
    researcher_question: "Which evidence do you want to rely on for this link?",
    evidence_needed: "A directly relevant study or supplied dataset result.",
  });
  assert.equal(additions[1].kind, "researcher_question");
  assert.equal(additions[1].status, "researcher_confirmation_required");
  assert.match(buildCollaborativeRevisionPromptBlock("collaborative"), /never insert proposed material into revised_text/i);
  assert.match(buildCollaborativeRevisionPromptBlock("collaborative"), /machine-assisted/i);
});

test("Editor exposes Collaborative Revision and sends its purpose through the existing rewrite request", () => {
  assert.match(editorHtml, /id="revisionPurpose"/);
  assert.match(editorHtml, /value="fidelity"[^>]*selected/i);
  assert.match(editorHtml, /value="collaborative"/i);
  assert.match(editorHtml, /proposed additions.*verification/i);
  assert.match(editorApp, /revisionPurpose:\s*\$\("revisionPurpose"\)\.value/);
  assert.match(editorApp, /renderAdditionalInputs\(data\.additional_inputs/);
});

test("rewrite contract keeps additions separate and returns them as bounded metadata", () => {
  assert.match(promptContract, /additional_inputs/);
  assert.match(rewriteRoute, /revisionPurpose/);
  assert.match(rewriteRoute, /additional_inputs/);
  assert.match(rewriteRoute, /normalizeAdditionalInputs/);
  assert.match(modelResponse, /Preserve all additional_inputs entries/);
});

test("collaborative mode supplies bounded review needs when the model returns none for a proposal with checkable claims", () => {
  const sourceText = `The mixed methods study will examine debt cost during 2015-2024. Corporate debt reached $13.68 trillion in 2024 (Board of Governors, 2025). Direct contemporary evidence remains limited.`;
  const additions = ensureCollaborativeReviewInputs({
    sourceText,
    revisionPurpose: "collaborative",
    modelInputs: [],
  });

  assert.equal(additions.length, 3);
  assert.ok(additions.some((item) => item.kind === "evidence" && item.status === "verification_required"));
  assert.ok(additions.some((item) => item.kind === "researcher_question" && /mixed.methods/i.test(item.proposal)));
  assert.ok(additions.some((item) => item.kind === "evidence" && /literature[- ]gap/i.test(item.proposal)));
  assert.ok(additions.every((item) => item.proposal && item.researcher_question));
});

test("fallback review needs never appear in fidelity mode or replace model-supplied collaborative inputs", () => {
  const supplied = [{ id: "kept", kind: "depth", proposal: "Clarify the mechanism.", status: "researcher_confirmation_required" }];
  assert.deepEqual(ensureCollaborativeReviewInputs({
    sourceText: "A mixed methods study will test 2024 evidence.",
    revisionPurpose: "fidelity",
    modelInputs: [],
  }), []);
  assert.deepEqual(ensureCollaborativeReviewInputs({
    sourceText: "A mixed methods study will test 2024 evidence.",
    revisionPurpose: "collaborative",
    modelInputs: supplied,
  }), supplied);
});
