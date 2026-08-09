import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const legacyUi = fs.readFileSync(new URL("../public/researchEnhancements.js", import.meta.url), "utf8");
const quickBridge = fs.readFileSync(new URL("../public/detectorQuickBridge.js", import.meta.url), "utf8");
const studioVoice = fs.readFileSync(new URL("../public/studioVoiceUI.js", import.meta.url), "utf8");
const evidenceBank = fs.readFileSync(new URL("../public/researchEvidenceBankUI.js", import.meta.url), "utf8");
const studioHtml = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const optional = fs.readFileSync(new URL("../public/optionalFeatures.js", import.meta.url), "utf8");
const security = fs.readFileSync(new URL("../server/lib/security.js", import.meta.url), "utf8");
const countCompat = fs.readFileSync(new URL("../public/wordCountCompatibility.js", import.meta.url), "utf8");

test("legacy combined enhancement script is retained for history but no longer loaded into the editor", () => {
  assert.ok(legacyUi.length > 0);
  assert.equal(index.indexOf('/researchEnhancements.js'), -1);
  assert.doesNotMatch(optional, /\/researchEnhancements\.js/);
  assert.match(optional, /\/detectorQuickBridge\.js/);
  assert.match(optional, /\/wordCountCompatibility\.js/);
});

test("voice reasoning exposes explicit accept/decline consent, selectable language and independent argument-map action", () => {
  assert.match(studioVoice, /reasoningModeTypedBtn/);
  assert.match(studioVoice, /reasoningModeVoiceBtn/);
  assert.match(studioVoice, /acceptVoiceConsentBtn/);
  assert.match(studioVoice, /declineVoiceConsentBtn/);
  assert.match(studioVoice, /Accept microphone transcription/);
  assert.match(studioVoice, /Decline/);
  assert.match(studioVoice, /data-voice-language="en-NG"/);
  assert.match(studioVoice, /data-voice-language="en-GB"/);
  assert.match(studioVoice, /data-voice-language="en-US"/);
  assert.match(studioVoice, /addEventListener\("click", acceptVoiceConsent\)/);
  assert.match(studioVoice, /addEventListener\("click", declineVoiceConsent\)/);
  assert.match(studioVoice, /Build Argument Map from Voice/);
  assert.match(studioVoice, /Append to Typed Reasoning/);
  assert.match(studioVoice, /does not store raw audio/i);
  assert.match(security, /microphone=\(self\)/);
  assert.doesNotMatch(studioVoice, /voiceReasoningConsent/);
});

test("large CSV/XLSX literature bank is independent from the eight-source evidence workspace", () => {
  assert.match(studioHtml, /researchEvidenceBankUI\.js/);
  assert.match(evidenceBank, /MAX_BANK_BYTES = 25 \* 1024 \* 1024/);
  assert.match(evidenceBank, /MAX_BANK_ROWS = 10000/);
  assert.match(evidenceBank, /Upload literature bank/);
  assert.match(evidenceBank, /Find evidence for current reasoning/);
  assert.match(evidenceBank, /Send selected to Evidence Workspace/);
  assert.match(evidenceBank, /APA 7 REFERENCE CANDIDATE/);
});

test("detector screenshot UX exposes a detector chooser and an explicit save action", () => {
  assert.match(quickBridge, /MAX_SCREENSHOT_BYTES = 2 \* 1024 \* 1024/);
  assert.match(quickBridge, /image\/png/);
  assert.match(quickBridge, /image\/jpeg/);
  assert.match(quickBridge, /detectorScreenshotDetector/);
  assert.match(quickBridge, /Auto-detect from screenshot/);
  assert.match(quickBridge, /GPTZero/);
  assert.match(quickBridge, /Turnitin/);
  assert.match(quickBridge, /Read screenshot/);
  assert.match(quickBridge, /Save extracted result/);
});

test("quick external detector result is a directly fillable form rather than a navigation-only button", () => {
  assert.match(quickBridge, /quickDetectorEntry/);
  assert.match(quickBridge, /quickDetectorName/);
  assert.match(quickBridge, /quickDetectorClass/);
  assert.match(quickBridge, /quickDetectorAi/);
  assert.match(quickBridge, /quickDetectorHuman/);
  assert.match(quickBridge, /quickDetectorMixed/);
  assert.match(quickBridge, /Save external result/);
  assert.match(quickBridge, /saveObservation\(observation\)/);
});

test("successful rewrite still triggers automatic source-to-revision comparison without loading studio tools", () => {
  assert.match(quickBridge, /\/api\\\/rewrite/);
  assert.match(quickBridge, /requestComparison\(source, revised, "rewrite"\)/);
  assert.match(quickBridge, /Quick source → revision diagnostics/);
  assert.doesNotMatch(quickBridge, /MutationObserver/);
});

test("editor loads manuscript-style word-count compatibility and labels the count approximate", () => {
  assert.match(countCompat, /window\.wordCount = manuscriptWordCount/);
  assert.match(countCompat, /Approximate manuscript word count/);
  assert.match(countCompat, /external tools may differ slightly/i);
});
