import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Editor serves a core detector report gateway instead of relying only on optional UI", () => {
  const html = read("public/index.html");
  assert.match(html, /id="detectorScreenshotGateway"/);
  assert.match(html, /Detector Gateway v1\.2\.0/);
  assert.match(html, /id="detectorScreenshotInput"[^>]*type="file"/);
  assert.match(html, /Choose detector report file\(s\)/);
  assert.match(html, /application\/pdf/);
  assert.match(html, /id="detectorScreenshotDropZone"/);
  assert.match(html, /detectorScreenshotGateway\.js\?v=1\.2\.0/);
});

test("Detector gateway directly opens device files, supports drop-paste and persists observations", () => {
  const js = read("public/detectorScreenshotGateway.js");
  assert.match(js, /input\.click\(\)/);
  assert.match(js, /data-upload-detector-result/);
  assert.match(js, /addEventListener\("drop"/);
  assert.match(js, /addEventListener\("paste"/);
  assert.match(js, /\/api\/detector-screenshot/);
  assert.match(js, /academicVoice\.detectorObservations\.v1/);
  assert.match(js, /academicVoice:detector-observation-saved/);
  assert.match(js, /MAX_PDF_BYTES = 5 \* 1024 \* 1024/);
  assert.match(js, /fileBase64/);
  assert.match(js, /Large PDF reports are automatically re-read in bounded pattern and passage phases/);
  assert.match(js, /Complete report extraction/);
});

test("Deep Authorial cannot coexist silently with Moderate intensity in the browser controls", () => {
  const html = read("public/index.html");
  const js = read("public/modeControlGuard.js");
  assert.match(html, /Deep Authorial Reconstruction — requires Deep/);
  assert.match(html, /modeControlGuard\.js\?v=1\.0\.0/);
  assert.match(js, /naturalisation\.value === "authorial" && intensity\.value !== "deep"/);
  assert.match(js, /intensity\.value = "deep"/);
  assert.match(js, /naturalisation\.value = "faithful"/);
  assert.match(js, /silently downgraded to Faithful behind the scenes/);
});

test("Researcher Studio evidence ingestion is static, single-surface and never repairs by deleting the live panel", () => {
  const html = read("public/studio.html");
  const router = read("public/researchEvidenceUploadRouter.js");
  const gateway = read("public/researchStudioEvidenceGateway.js");

  assert.match(html, /id="tab-researchstudio"/);
  assert.match(html, /id="researchEvidenceWorkspaceCard"/);
  assert.match(html, /id="evidenceInputGateway"/);
  assert.match(html, /Evidence Gateway v4\.0\.1/);
  assert.match(html, /researchStudioUI\.js\?v=4\.0\.0/);
  assert.match(html, /researchStudioEvidenceGateway\.js\?v=4\.0\.1/);
  assert.match(html, /researchEvidenceUploadRouter\.js\?v=4\.0\.1/);
  assert.equal((html.match(/id="evidenceInputGateway"/g) || []).length, 1);
  assert.doesNotMatch(html, /researchStudioEvidenceCoreUI\.js/);

  assert.match(router, /const ROUTER_VERSION = "4\.0\.1"/);
  assert.match(router, /function researchStudioTargetReady\(/);
  assert.match(router, /async function ensureResearchEvidenceTarget\(/);
  assert.match(router, /targetConsumedFiles/);
  assert.match(router, /The interface was not rebuilt behind the scenes/i);
  assert.match(router, /runLocalBrowserSmoke/);
  assert.doesNotMatch(router, /removePartialResearchStudio/);
  assert.doesNotMatch(router, /loadRepairScript/);
  assert.doesNotMatch(router, /repairResearchStudioUi/);
  assert.doesNotMatch(router, /researchStudioUI\.js\?v=.*repair/);

  assert.match(gateway, /const GATEWAY_VERSION = "4\.0\.1"/);
  assert.match(gateway, /window\.__DavisEvidenceUploadRouter/);
  assert.match(gateway, /const ok = await router\.routeFiles\(chosen\)/);
  assert.doesNotMatch(gateway, /moveGatewayIntoEvidenceWorkspace/);
  assert.doesNotMatch(gateway, /self-healing/i);
});
