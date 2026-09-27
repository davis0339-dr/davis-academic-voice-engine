import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync(new URL("../public/candidateRefinementUI.js", import.meta.url), "utf8");

test("researcher voice calibration explains sample relationship and exclusions", () => {
  assert.match(ui, /Researcher voice calibration/);
  assert.match(ui, /does not need to discuss the same topic/i);
  assert.match(ui, /Two to five connected paragraphs/i);
  assert.match(ui, /different topic is often safer/i);
  assert.match(ui, /Same-project material/i);
  assert.match(ui, /References, quotations, tables, questionnaires, bullet lists/i);
  assert.match(ui, /reasoning order, explanation depth, clause loading/i);
});
