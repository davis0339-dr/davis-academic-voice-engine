import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("a completed response always places its candidate in Revised", () => {
  assert.match(app, /revisedText\.value = data\.revised_text \|\| ""/);
  assert.doesNotMatch(app, /No revision produced: every generated candidate breached a hard preservation invariant/);
  assert.doesNotMatch(app, /setBusy\(false, `Done\. Request/);
});

test("the Preservation tab can show a legacy rejected audit and always receives the shared release decision", () => {
  assert.match(app, /rejected_preservation_failure\?\.preservation/);
  assert.match(app, /renderPreservation\(data\.preservation \|\| rejectedPreservation \|\| \{\}, data\.preservation_release, data\.preservation_chain\)/);
});
