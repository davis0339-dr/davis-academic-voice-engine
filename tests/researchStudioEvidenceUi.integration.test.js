import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const studio = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
const evidenceUi = fs.readFileSync(new URL("../public/researchStudioEvidenceCoreUI.js", import.meta.url), "utf8");

test("Research Studio loads the cache-busted evidence control layer", () => {
  assert.match(studio, /researchStudioEvidenceCoreUI\.js\?v=2\.2\.0/);
});

test("Evidence Workspace exposes a real device picker and direct paste workflow", () => {
  assert.match(evidenceUi, /Choose files from device/);
  assert.match(evidenceUi, /fileInput\.click\(\)/);
  assert.match(evidenceUi, /Drag and drop evidence files here/);
  assert.match(evidenceUi, /Paste a source instead of uploading a file/);
  assert.match(evidenceUi, /Paste text from clipboard/);
  assert.match(evidenceUi, /Add pasted source to Evidence Workspace/);
  assert.match(evidenceUi, /Add author jottings \/ field notes \/ supervisor notes/);
  assert.match(evidenceUi, /Evidence UI v\$\{UI_VERSION\}/);
});

test("Evidence Workspace keeps document and data upload types enabled", () => {
  for (const extension of [".txt", ".md", ".docx", ".pdf", ".csv", ".xlsx"]) {
    assert.ok(evidenceUi.includes(extension), `Expected ${extension} support in Research Studio evidence UI`);
  }
});
