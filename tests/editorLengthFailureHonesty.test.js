import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("the editor names an unmet development/length contract instead of returning generic review feedback", () => {
  assert.match(app, /expand_length_contract_missed/);
  assert.match(app, /deep_auto_developmental_compression/);
  assert.match(app, /Revision incomplete: the requested development\/length contract was not achieved/);
  assert.match(app, /diagnostic draft, not a finished revision/);
});
