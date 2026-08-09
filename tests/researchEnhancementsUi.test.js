import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync(new URL("../public/researchEnhancements.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const optional = fs.readFileSync(new URL("../public/optionalFeatures.js", import.meta.url), "utf8");
const security = fs.readFileSync(new URL("../server/lib/security.js", import.meta.url), "utf8");

test("research enhancement script is preserved but removed from the parser-blocking critical path", () => {
  assert.equal(index.indexOf('/researchEnhancements.js'), -1);
  assert.ok(index.indexOf('/app.js') > -1);
  assert.ok(index.indexOf('/optionalFeatures.js') > index.indexOf('/app.js'));
  assert.match(optional, /\/researchEnhancements\.js/);
});

test("voice reasoning requires explicit consent and keeps transcript editable", () => {
  assert.match(ui, /voiceReasoningConsent/);
  assert.match(ui, /I understand and want to enable microphone transcription/);
  assert.match(ui, /voiceReasoningTranscript/);
  assert.match(ui, /Add transcript to my reasoning/);
  assert.match(ui, /does not store raw audio/i);
  assert.match(security, /microphone=\(self\)/);
});

test("detector screenshot UX enforces one PNG or JPEG and a 2 MB client cap", () => {
  assert.match(ui, /MAX_SCREENSHOT_BYTES = 2 \* 1024 \* 1024/);
  assert.match(ui, /image\/png/);
  assert.match(ui, /image\/jpeg/);
  assert.match(ui, /Upload the summary screen, not a Turnitin report\/PDF/);
});

test("successful rewrite triggers automatic source-to-revision comparison", () => {
  assert.match(ui, /\/api\\\/rewrite/);
  assert.match(ui, /requestComparison\(source, revised, "rewrite"\)/);
  assert.match(ui, /Automatic original → revised comparison/);
});
