import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const studioHtml = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
const evidenceUi = fs.readFileSync(new URL("../public/researchStudioEvidenceCoreUI.js", import.meta.url), "utf8");

test("Research Studio loads the core evidence UI directly", () => {
  assert.match(studioHtml, /researchStudioUI\.js/);
  assert.match(studioHtml, /researchStudioEvidenceCoreUI\.js/);
  assert.ok(studioHtml.indexOf("researchStudioEvidenceCoreUI.js") > studioHtml.indexOf("researchStudioUI.js"));
});

test("evidence UI exposes an actual device picker button wired to the file input", () => {
  assert.match(evidenceUi, /id="browseResearchEvidenceBtn"/);
  assert.match(evidenceUi, /fileInput\.click\(\)/);
  assert.match(evidenceUi, /id="researchEvidenceFiles"|researchEvidenceFiles/);
});

test("evidence UI supports paste, notes and spreadsheet evidence", () => {
  assert.match(evidenceUi, /id="evidencePasteText"/);
  assert.match(evidenceUi, /id="addPastedEvidenceBtn"/);
  assert.match(evidenceUi, /id="evidenceAuthorNotes"/);
  assert.match(evidenceUi, /\.csv/);
  assert.match(evidenceUi, /\.xlsx/);
});

test("evidence UI supports drag and drop and fixes Studio contrast", () => {
  assert.match(evidenceUi, /researchEvidenceDropZone/);
  assert.match(evidenceUi, /dataTransfer\?\.files/);
  assert.match(evidenceUi, /research-studio-card\{background:var\(--panel\)!important;color:var\(--text\)!important/);
});
