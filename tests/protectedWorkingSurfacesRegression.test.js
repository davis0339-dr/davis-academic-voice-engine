import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const limits = fs.readFileSync(new URL("../server/config/limits.js", import.meta.url), "utf8");
const jobsRoute = fs.readFileSync(new URL("../server/routes/jobs.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const voice = fs.readFileSync(new URL("../public/studioVoiceUI.js", import.meta.url), "utf8");
const detector = fs.readFileSync(new URL("../public/detectorEvidenceUploadUX.js", import.meta.url), "utf8");
const evidenceBank = fs.readFileSync(new URL("../public/researchEvidenceBankUI.js", import.meta.url), "utf8");
const studio = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
const optionalFeatures = fs.readFileSync(new URL("../public/optionalFeatures.js", import.meta.url), "utf8");

test("the working 1,500-word editor remains intact while Long Document evolves separately", () => {
  assert.match(limits, /SINGLE_EDITOR_WORD_LIMIT\s*=\s*1500/);
  assert.match(app, /analyseOnlyBtn\.addEventListener/);
  assert.match(app, /analyseReviseBtn\.addEventListener/);
  assert.match(app, /startJobBtn\.addEventListener\("click", startLongDocJob\)/);
  assert.match(optionalFeatures, /\/longDocumentIntelligenceUI\.js/);
});

test("Voice Reasoning keeps explicit consent, language choice and direct argument-map build", () => {
  assert.match(voice, /Accept microphone transcription/);
  assert.match(voice, /Decline/);
  assert.match(voice, /English \(Nigeria\)/);
  assert.match(voice, /English \(UK\)/);
  assert.match(voice, /English \(US\)/);
  assert.match(voice, /Build Argument Map from Voice/);
  assert.match(voice, /Start speaking/);
});

test("detector evidence upload remains an explicit clickable workflow", () => {
  assert.match(detector, /Choose detector evidence screenshot/);
  assert.match(detector, /Read selected screenshot/);
  assert.match(detector, /Detector shown in screenshot/);
});

test("large Literature Evidence Bank remains operational and receives Long Document evidence-needs handoff additively", () => {
  assert.match(evidenceBank, /Upload literature bank/);
  assert.match(evidenceBank, /Find evidence for current reasoning/);
  assert.match(evidenceBank, /Send selected to Evidence Workspace/);
  assert.match(studio, /researchEvidenceBankUI\.js/);
  assert.match(studio, /longDocumentEvidenceHandoffUI\.js/);
});

test("Long Document no longer silently converts Authorial into Deep plus Aggressive across all chunks", () => {
  assert.doesNotMatch(jobsRoute, /authorial\s*\?\s*"deep"/);
  assert.doesNotMatch(jobsRoute, /authorial\s*\?\s*"aggressive"/);
  assert.match(jobsRoute, /passes? author choices unchanged|authority ceilings/i);
});
