import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("startup status is driven by the single general health request", () => {
  assert.match(app, /fetch\("\/api\/health"\)/);
  assert.doesNotMatch(app, /loadLlmStatus\(\);/);
  assert.match(app, /data\.llm/);
});

test("initial HTML does not present an indefinite checking message", () => {
  assert.doesNotMatch(html, /checking service status/i);
});
