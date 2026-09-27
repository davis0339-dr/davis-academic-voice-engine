import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ux = fs.readFileSync(new URL("../public/detectorEvidenceUploadUX.js", import.meta.url), "utf8");
const optional = fs.readFileSync(new URL("../public/optionalFeatures.js", import.meta.url), "utf8");

test("detector evidence report uses a real clickable button", () => {
  assert.match(ux, /chooseDetectorEvidenceScreenshotBtn/);
  assert.match(ux, /Choose detector report file\(s\)/);
  assert.match(ux, /input\.click\(\)/);
  assert.match(ux, /Read selected report file\(s\)/);
});

test("detector selector and upload status are explicitly laid out", () => {
  assert.match(ux, /detectorScreenshotDetector/);
  assert.match(ux, /detector-selector-control/);
  assert.match(ux, /Selected: \$\{file\.name\}/);
  assert.match(ux, /grid-template-columns:minmax\(250px,360px\)/);
  assert.match(ux, /card\.id !== "detectorScreenshotGateway"/);
});

test("detector evidence upload UX loads after detector bridge", () => {
  const bridgeIndex = optional.indexOf('/detectorQuickBridge.js');
  const uxIndex = optional.indexOf('/detectorEvidenceUploadUX.js');
  assert.ok(bridgeIndex >= 0);
  assert.ok(uxIndex > bridgeIndex);
});
