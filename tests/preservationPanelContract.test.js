import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("Preservation panel separates possible role-marker changes from corroborated losses", () => {
  assert.match(appSource, /Possible transition role changes \(review evidence\)/);
  assert.match(appSource, /Role-marker changes are supporting evidence only/);
  assert.match(appSource, /rhetorical\.transitions_lost/);
  assert.match(appSource, /rhetorical\.possible_transition_role_changes/);
});
