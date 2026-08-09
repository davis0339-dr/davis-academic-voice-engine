import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const guard = readFileSync(new URL("../public/runtimeGuard.js", import.meta.url), "utf8");

test("runtime guard is valid browser JavaScript", () => {
  const result = spawnSync(process.execPath, ["--check", new URL("../public/runtimeGuard.js", import.meta.url).pathname], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("startup GET requests have a bounded timeout and visible fallback", () => {
  assert.match(guard, /STARTUP_GET_TIMEOUT_MS\s*=\s*12000/);
  assert.match(guard, /\/api\/health\/llm/);
  assert.match(guard, /\/api\/style-profiles/);
  assert.match(guard, /AbortController/);
  assert.match(guard, /status check timed out/);
});

test("optional UI layers are loaded explicitly before authorial dynamic-loader guards", () => {
  const runtimeGuard = index.indexOf('src="/runtimeGuard.js"');
  const studio = index.indexOf('src="/researchStudioUI.js"');
  const capabilities = index.indexOf('src="/researchStudioCapabilitiesUI.js"');
  const evidence = index.indexOf('src="/detectorEvidenceUI.js"');
  const detector = index.indexOf('src="/detectorResearchUI.js"');
  const authorial = index.indexOf('src="/authorialTextureUI.js"');
  assert.ok(runtimeGuard > 0);
  assert.ok(studio > runtimeGuard);
  assert.ok(capabilities > studio);
  assert.ok(evidence > capabilities);
  assert.ok(detector > evidence);
  assert.ok(authorial > detector);
  assert.match(index, /data-research-studio-ui="true"/);
  assert.match(index, /data-research-studio-capabilities-ui="true"/);
  assert.match(index, /data-detector-evidence-ui="true"/);
  assert.match(index, /data-detector-research-ui="true"/);
});
