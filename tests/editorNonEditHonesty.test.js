import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("a source-retained fallback leaves Revised empty and is not labelled Done", () => {
  assert.match(app, /revisedText\.value = noRevision \? "" : data\.revised_text/);
  assert.match(app, /No revision produced: every generated candidate breached a hard preservation invariant/);
  assert.doesNotMatch(app, /setBusy\(false, `Done\. Request/);
});

test("the Preservation tab shows the rejected candidate audit rather than auditing the copied source", () => {
  assert.match(app, /rejected_preservation_failure\?\.preservation/);
  assert.match(app, /renderPreservation\(noRevision && rejectedPreservation \? rejectedPreservation : data\.preservation\)/);
});
