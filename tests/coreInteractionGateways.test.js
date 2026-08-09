import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Editor serves a core detector screenshot gateway instead of relying only on optional UI", () => {
  const html = read("public/index.html");
  assert.match(html, /id="detectorScreenshotGateway"/);
  assert.match(html, /Detector Gateway v1\.0\.0/);
  assert.match(html, /id="detectorScreenshotInput"[^>]*type="file"/);
  assert.match(html, /Choose from device/);
  assert.match(html, /id="detectorScreenshotDropZone"/);
  assert.match(html, /detectorScreenshotGateway\.js\?v=1\.0\.0/);
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
