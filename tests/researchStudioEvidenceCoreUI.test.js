import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const studioHtml = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
const gateway = fs.readFileSync(new URL("../public/researchStudioEvidenceGateway.js", import.meta.url), "utf8");
const router = fs.readFileSync(new URL("../public/researchEvidenceUploadRouter.js", import.meta.url), "utf8");

test("Research Studio owns one static evidence surface instead of loading a second dynamic UI", () => {
  assert.match(studioHtml, /id="researchEvidenceWorkspaceCard"/);
  assert.match(studioHtml, /id="evidenceInputGateway"/);
  assert.match(studioHtml, /id="researchEvidenceFiles"/);
  assert.equal((studioHtml.match(/id="evidenceInputGateway"/g) || []).length, 1);
  assert.doesNotMatch(studioHtml, /researchStudioEvidenceCoreUI\.js/);
});

test("static evidence surface exposes a real device picker connected to the internal source reader", () => {
  assert.match(studioHtml, /id="evidenceGatewayFiles"[^>]*type="file"/);
  assert.match(studioHtml, /Choose evidence files from this device/);
  assert.match(router, /copyFilesIntoInput\(target, chosen\)/);
  assert.match(router, /researchEvidenceFiles/);
  assert.match(router, /targetConsumedFiles/);
});

test("static evidence surface supports paste plus document and spreadsheet evidence", () => {
  assert.match(studioHtml, /id="evidenceGatewayPasteText"/);
  assert.match(studioHtml, /id="addGatewayPastedSourceBtn"/);
  assert.match(studioHtml, /Paste text from clipboard/);
  assert.match(gateway, /addPastedGatewaySource/);
  assert.match(gateway, /window\.__DavisEvidenceUploadRouter/);
  assert.match(gateway, /return ok === true/);
  for (const extension of [".txt", ".md", ".docx", ".pdf", ".csv", ".xlsx"]) {
    assert.ok(studioHtml.includes(extension), `Expected ${extension} support in Research Studio evidence surface`);
  }
});

test("static evidence surface supports drag and drop without destructive panel rebuilding", () => {
  assert.match(studioHtml, /id="evidenceGatewayDropZone"/);
  assert.match(router, /event\.dataTransfer\?\.files/);
  assert.match(router, /interceptGatewayDrop/);
  assert.doesNotMatch(router, /removePartialResearchStudio/);
  assert.doesNotMatch(router, /repairResearchStudioUi/);
});