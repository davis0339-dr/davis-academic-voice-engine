import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const studio = readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
const guard = readFileSync(new URL("../public/runtimeGuard.js", import.meta.url), "utf8");
const optional = readFileSync(new URL("../public/optionalFeatures.js", import.meta.url), "utf8");

test("runtime guard and workspace loaders are valid browser JavaScript", () => {
  for (const rel of [
    "../public/runtimeGuard.js",
    "../public/optionalFeatures.js",
    "../public/detectorQuickBridge.js",
    "../public/workspaceHandoff.js",
    "../public/studioBootstrap.js",
    "../public/studioVoiceUI.js",
    "../public/researchCoauthoringUI.js",
  ]) {
    const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(rel, import.meta.url))], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test("startup GET requests have a bounded timeout and visible fallback", () => {
  assert.match(guard, /STARTUP_GET_TIMEOUT_MS\s*=\s*12000/);
  assert.match(guard, /\/api\/health\/llm/);
  assert.match(guard, /\/api\/style-profiles/);
  assert.match(guard, /AbortController/);
  assert.match(guard, /startup status unavailable/);
});

test("editor keeps only editor-result and detector modules, with detector research lazy-loaded", () => {
  const runtimeGuard = index.indexOf('src="/runtimeGuard.js"');
  const app = index.indexOf('src="/app.js"');
  const loader = index.indexOf('src="/optionalFeatures.js"');
  assert.ok(runtimeGuard > 0);
  assert.ok(app > runtimeGuard);
  assert.ok(loader > app);

  assert.match(optional, /\/detectorQuickBridge\.js/);
  assert.match(optional, /\/plannerObservability\.js/);
  assert.match(optional, /\/rewriteVerdict\.js/);
  assert.match(optional, /\/authorialTextureUI\.js/);
  assert.match(optional, /\/detectorResearchUI\.js/);
  assert.match(optional, /data-tab=\"detectorqa\"/);
  assert.match(optional, /SCRIPT_TIMEOUT_MS\s*=\s*8000/);
  assert.match(optional, /script\.onerror/);

  assert.doesNotMatch(optional, /\/researchStudioUI\.js/);
  assert.doesNotMatch(optional, /\/researchStudioCapabilitiesUI\.js/);
  assert.doesNotMatch(optional, /\/detectorEvidenceUI\.js/);
});

test("research and evidence modules live on the separate static Studio page", () => {
  assert.match(index, /href=\"\/studio\"/);
  assert.match(studio, /Research &amp; Evidence Studio/);
  assert.match(studio, /id="tab-researchstudio"/);
  assert.match(studio, /id="researchEvidenceWorkspaceCard"/);
  assert.match(studio, /id="evidenceInputGateway"/);
  assert.match(studio, /color-scheme:dark/);
  assert.match(studio, /\/researchStudioUI\.js\?v=4\.0\.0/);
  assert.match(studio, /\/researchCoauthoringUI\.js\?v=5\.0\.0/);
  assert.match(studio, /\/researchStudioEvidenceGateway\.js\?v=4\.0\.1/);
  assert.match(studio, /\/researchEvidenceUploadRouter\.js\?v=4\.0\.1/);
  assert.match(studio, /\/detectorEvidenceUI\.js/);
  assert.match(studio, /\/studioVoiceUI\.js/);
  assert.doesNotMatch(studio, /\/researchStudioCapabilitiesUI\.js/);
  assert.doesNotMatch(studio, /\/researchStudioEvidenceCoreUI\.js/);
  assert.doesNotMatch(studio, /\/app\.js/);
});
