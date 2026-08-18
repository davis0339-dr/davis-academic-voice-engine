import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const authorialUi = fs.readFileSync(new URL("../public/authorialTextureUI.js", import.meta.url), "utf8");
const plannerUi = fs.readFileSync(new URL("../public/plannerObservability.js", import.meta.url), "utf8");

test("Moderate diagnostic breadth is not presented to researchers as a rejection ceiling", () => {
  assert.match(authorialUi, /breadth_enforcement === "diagnostic"/);
  assert.match(authorialUi, /Changed-sentence reference|Change breadth reference/);
  assert.match(authorialUi, /High change is permitted/);
  assert.match(plannerUi, /breadth_enforcement === "diagnostic"/);
  assert.match(plannerUi, /Diagnostic change reference/);
});
