import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const optional = fs.readFileSync(new URL("../public/optionalFeatures.js", import.meta.url), "utf8");

test("core editor starts independently of optional frontend features", () => {
  const appPos = html.indexOf('src="/app.js"');
  const optionalPos = html.indexOf('src="/optionalFeatures.js"');
  assert.ok(appPos > 0);
  assert.ok(optionalPos > appPos);
  assert.match(optional, /window\.addEventListener\("load"/);
  assert.match(optional, /SCRIPT_TIMEOUT_MS\s*=\s*8000/);
});

test("core startup still has bounded health checks", () => {
  assert.match(app, /fetch\("\/api\/health"\)/);
  assert.match(app, /fetch\("\/api\/health\/llm"\)/);
});

test("initial HTML does not present the old indefinite checking message", () => {
  assert.doesNotMatch(html, /checking service status/i);
  assert.match(html, /LLM: starting/);
});
