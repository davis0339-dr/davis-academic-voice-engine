import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("manuscript-first coauthoring starts independently of the Editor and preserves the evidence-and-integrity workflow", () => {
  const ui = read("public/researchCoauthoringUI.js");
  const studio = read("public/studio.html");

  assert.match(ui, /Researcher-led coauthoring — manuscript first/);
  assert.match(ui, /upload a TXT, DOCX or text-based PDF/i);
  assert.match(ui, /This can start independently of the Editor/i);
  assert.match(ui, /Use current Source text/);
  assert.match(ui, /Use current Revised text/);
  assert.match(ui, /existing post-editor framework remains separate and intact/i);

  assert.match(studio, /Researcher-led manuscript development/i);
  assert.match(studio, /manuscript → researcher reasoning → approved argument map → evidence alignment\/challenge → controlled reconstruction → integrity check/i);
  assert.match(studio, /id="researchEvidenceWorkspaceCard"/);
  assert.match(studio, /id="integrityResults"/);
});

test("coauthoring explicitly prefers the researcher's own understanding without blocking typed answers", () => {
  const ui = read("public/researchCoauthoringUI.js");
  const voice = read("public/studioVoiceUI.js");

  assert.match(ui, /Answer in your own words and understanding/i);
  assert.match(ui, /You do not need to sound academic here/i);
  assert.match(ui, /data-coauthor-answer/);
  assert.match(ui, /Use current Voice transcript for this answer/);
  assert.match(ui, /Voice is optional/);
  assert.match(voice, /typing is equally valid/i);
  assert.match(voice, /avoid reading a generated answer if possible/i);
});

test("researcher responses are assessed for verification needs but raw answers remain the argument-map source", () => {
  const ui = read("public/researchCoauthoringUI.js");
  const route = read("server/routes/researchStudio.js");

  assert.match(route, /\/research\/response-assess/);
  assert.match(route, /not_required_for_authorial_intent/);
  assert.match(route, /verify_before_factual_use/);
  assert.match(route, /evidence_workspace_check/);
  assert.match(route, /A researcher's explanation can establish what they mean/i);
  assert.match(route, /does NOT by itself establish an external empirical fact/i);
  assert.match(ui, /only the researcher's raw answers are fed forward/i);
  assert.match(ui, /writeResponsesIntoResearcherReasoning\(responses\)/);
  assert.match(ui, /build\.click\(\)/);
});

test("manuscript questions are designed to elicit judgment rather than generate the argument for the researcher", () => {
  const route = read("server/routes/researchStudio.js");
  assert.match(route, /\/research\/manuscript-questions/);
  assert.match(route, /Do not answer the questions yourself/);
  assert.match(route, /Do not generate an argument for the researcher/);
  assert.match(route, /verification_sensitivity/);
  assert.match(route, /The researcher may answer by voice OR by typing/);
});