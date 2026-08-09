import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const guard = readFileSync(new URL("../public/runtimeGuard.js", import.meta.url), "utf8");
const optional = readFileSync(new URL("../public/optionalFeatures.js", import.meta.url), "utf8");

test("runtime guard and optional loader are valid browser JavaScript", () => {
  for (const rel of ["../public/runtimeGuard.js", "../public/optionalFeatures.js"]) {
    const result = spawnSync(process.execPath, ["--check", new URL(rel, import.meta.url).pathname], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test("startup GET requests have a bounded timeout and visible fallback", () => {
  assert.match(guard, /STARTUP_GET_TIMEOUT_MS\s*=\s*12000/);
  assert.match(guard, /\/api\/health\/llm/);
  assert.match(guard, /\/api\/style-profiles/);
  assert.match(guard, /AbortController/);
  assert.match(guard, /status check timed out/);
});

test("advanced UI layers are not parser blocking and each fails open", () => {
  const runtimeGuard = index.indexOf('src="/runtimeGuard.js"');
  const app = index.indexOf('src="/app.js"');
  const loader = index.indexOf('src="/optionalFeatures.js"');
  assert.ok(runtimeGuard > 0);
  assert.ok(app > runtimeGuard);
  assert.ok(loader > app);

  assert.match(optional, /\/researchEnhancements\.js/);
  assert.match(optional, /\/plannerObservability\.js/);
  assert.match(optional, /\/rewriteVerdict\.js/);
  assert.match(optional, /\/researchStudioUI\.js/);
  assert.match(optional, /\/researchStudioCapabilitiesUI\.js/);
  assert.match(optional, /\/detectorEvidenceUI\.js/);
  assert.match(optional, /\/detectorResearchUI\.js/);
  assert.match(optional, /\/authorialTextureUI\.js/);
  assert.match(optional, /SCRIPT_TIMEOUT_MS\s*=\s*8000/);
  assert.match(optional, /script\.onerror/);
});
