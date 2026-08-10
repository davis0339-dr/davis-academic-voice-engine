import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const studio = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
const gateway = fs.readFileSync(new URL("../public/researchStudioEvidenceGateway.js", import.meta.url), "utf8");
const router = fs.readFileSync(new URL("../public/researchEvidenceUploadRouter.js", import.meta.url), "utf8");

test("Research Studio loads the single static evidence gateway and stable router", () => {
  assert.match(studio, /Evidence Gateway v4\.0\.1/);
  assert.match(studio, /researchStudioEvidenceGateway\.js\?v=4\.0\.1/);
  assert.match(studio, /researchEvidenceUploadRouter\.js\?v=4\.0\.1/);
  assert.doesNotMatch(studio, /researchStudioEvidenceCoreUI\.js/);
  assert.equal((studio.match(/id="evidenceInputGateway"/g) || []).length, 1);
});

test("Evidence Workspace exposes device selection, drag-drop and direct paste in the same Step 3 surface", () => {
  assert.match(studio, /Choose evidence files from this device/);
  assert.match(studio, /Drag and drop evidence files here/);
  assert.match(studio, /Paste a document, article excerpt, report or supporting source/);
  assert.match(studio, /Paste text from clipboard/);
  assert.match(studio, /Add pasted source to Evidence Workspace/);
  assert.match(studio, /id="researchEvidenceWorkspaceCard"/);
  assert.match(gateway, /pasteGatewayClipboardBtn/);
  assert.match(gateway, /addPastedGatewaySource/);
  assert.match(gateway, /return ok === true/);
  assert.match(router, /routeDirectSources/);
});

test("Evidence Workspace keeps document and data upload types enabled", () => {
  for (const extension of [".txt", ".md", ".docx", ".pdf", ".csv", ".xlsx"]) {
    assert.ok(studio.includes(extension), `Expected ${extension} support in Research Studio evidence UI`);
  }
  assert.match(router, /SPREADSHEET_RE/);
  assert.match(router, /routeSpreadsheet/);
});