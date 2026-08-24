import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("the editor returns the best complete draft and reports an unmet Expand contract honestly", () => {
  assert.match(app, /expand_length_contract_missed/);
  assert.match(app, /deep_auto_developmental_compression/);
  assert.match(app, /Best complete preservation-safe revision returned/);
  assert.match(app, /No additional paid full-document retry was launched/);
});
