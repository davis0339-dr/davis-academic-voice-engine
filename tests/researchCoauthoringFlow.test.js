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
  assert.match(studio, /manuscript → exact diagnosis → author response → raw working draft/i);
  assert.match(studio, /id="researchEvidenceWorkspaceCard"/);
  assert.match(studio, /id="integrityResults"/);
  assert.match(studio, /researchCoauthoringUI\.js\?v=5\.0\.0/);
});

test("each generated question has a real microphone workflow with local status feedback", () => {
  const ui = read("public/researchCoauthoringUI.js");

  assert.match(ui, /Answer this question by voice/);
  assert.match(ui, /data-question-voice-panel/);
  assert.match(ui, /data-start-question-voice/);
  assert.match(ui, /data-stop-question-voice/);
  assert.match(ui, /data-question-voice-status/);
  assert.match(ui, /function startQuestionVoice/);
  assert.match(ui, /SpeechRecognition/);
  assert.match(ui, /recognition\.onresult/);
  assert.match(ui, /live transcript is being written into this answer box/i);
  assert.match(ui, /browser denied microphone permission/i);
  assert.match(ui, /Use existing Studio voice transcript/);
});

test("coauthoring keeps typed reasoning fully supported alongside voice", () => {
  const ui = read("public/researchCoauthoringUI.js");
  const voice = read("public/studioVoiceUI.js");

  assert.match(ui, /Answer in your own words and understanding/i);
  assert.match(ui, /You do not need to sound academic here/i);
  assert.match(ui, /data-coauthor-answer/);
  assert.match(ui, /inputMode = "typed"/);
  assert.match(ui, /inputMode = "mixed"/);
  assert.match(voice, /typing is equally valid/i);
  assert.match(voice, /avoid reading a generated answer if possible/i);
});

test("researcher responses are assessed but raw answers are not automatically sent through prose reconstruction", () => {
  const ui = read("public/researchCoauthoringUI.js");
  const route = read("server/routes/researchStudio.js");

  assert.match(route, /\/research\/response-assess/);
  assert.match(route, /not_required_for_authorial_intent/);
  assert.match(route, /verify_before_factual_use/);
  assert.match(route, /evidence_workspace_check/);
  assert.match(route, /A researcher's explanation can establish what they mean/i);
  assert.match(route, /does NOT by itself establish an external empirical fact/i);
  assert.match(ui, /writeResponsesIntoResearcherReasoning\(responses\)/);
  assert.match(ui, /Researcher's answer \(\$\{item\.input_mode\}\): \$\{item\.answer\}/);
  assert.doesNotMatch(ui, /build\.click\(\)/);
  assert.match(ui, /\/api\/research\/raw-integrate/);
  assert.match(ui, /No language model edited the inserted wording/i);
});

test("manuscript questions are designed to elicit judgment rather than generate the argument for the researcher", () => {
  const route = read("server/routes/researchStudio.js");
  assert.match(route, /\/research\/manuscript-questions/);
  assert.match(route, /Do not answer your own questions/);
  assert.match(route, /Do not rewrite any sentence/);
  assert.match(route, /verification_sensitivity/);
  assert.match(route, /read_back_in_own_words/);
});
