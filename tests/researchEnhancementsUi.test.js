import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const legacyUi = fs.readFileSync(new URL("../public/researchEnhancements.js", import.meta.url), "utf8");
const quickBridge = fs.readFileSync(new URL("../public/detectorQuickBridge.js", import.meta.url), "utf8");
const studioVoice = fs.readFileSync(new URL("../public/studioVoiceUI.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const optional = fs.readFileSync(new URL("../public/optionalFeatures.js", import.meta.url), "utf8");
const security = fs.readFileSync(new URL("../server/lib/security.js", import.meta.url), "utf8");

test("legacy combined enhancement script is retained for history but no longer loaded into the editor", () => {
  assert.ok(legacyUi.length > 0);
  assert.equal(index.indexOf('/researchEnhancements.js'), -1);
  assert.doesNotMatch(optional, /\/researchEnhancements\.js/);
  assert.match(optional, /\/detectorQuickBridge\.js/);
});

test("voice reasoning remains available in the isolated Research & Evidence Studio", () => {
  assert.match(studioVoice, /voiceReasoningConsent/);
  assert.match(studioVoice, /I understand and want to enable microphone transcription/);
  assert.match(studioVoice, /voiceReasoningTranscript/);
  assert.match(studioVoice, /Add transcript to my reasoning/);
  assert.match(studioVoice, /does not store raw audio/i);
  assert.match(security, /microphone=\(self\)/);
});

test("detector screenshot UX remains in the lightweight editor-detector bridge", () => {
  assert.match(quickBridge, /MAX_SCREENSHOT_BYTES = 2 \* 1024 \* 1024/);
  assert.match(quickBridge, /image\/png/);
  assert.match(quickBridge, /image\/jpeg/);
  assert.match(quickBridge, /Turnitin, GPTZero/);
});

test("successful rewrite still triggers automatic source-to-revision comparison without loading studio tools", () => {
  assert.match(quickBridge, /\/api\\\/rewrite/);
  assert.match(quickBridge, /requestComparison\(source, revised, "rewrite"\)/);
  assert.match(quickBridge, /Quick source → revision diagnostics/);
  assert.doesNotMatch(quickBridge, /MutationObserver/);
});
