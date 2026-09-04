import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("source-grounded authoring is a separate three-route workspace", async () => {
  const html = await readFile(new URL("public/source-authoring.html", root), "utf8");
  assert.match(html, /Follow a template/);
  assert.match(html, /Rebuild an existing draft/);
  assert.match(html, /Develop a manuscript/);
  assert.match(html, /Map evidence locally · 0 model calls/);
  assert.match(html, /Deep claim-to-evidence selection · maximum 1 call/);
  assert.match(html, /Read, make notes and synthesize · 1 model call/);
  assert.match(html, /id="synthesisNotebook"/);
  assert.match(html, /id="synthesisDraft"/);
  assert.match(html, /does not pass through the Editor’s preservation gates/);
  assert.match(html, /Send to Editor review · automatic length routing/);
  assert.match(html, /Continue later in Research Studio/);
});

test("source-led extracts are locked while connections remain editable", async () => {
  const ui = await readFile(new URL("public/sourceGroundedAuthoringUI.js", root), "utf8");
  assert.match(ui, /LOCKED VERBATIM EXTRACT/);
  assert.match(ui, /EDITABLE CONNECTION/);
  assert.match(ui, /block\.type === "extract"/);
  assert.match(ui, /lockedExtracts/);
});

test("editor handoff blocks the general rewriter but leaves analysis available", async () => {
  const mode = await readFile(new URL("public/sourceAuthoringEditorMode.js", root), "utf8");
  assert.match(mode, /source\.readOnly = true/);
  assert.match(mode, /revise\.disabled = true/);
  assert.doesNotMatch(mode, /analyseOnlyBtn.*disabled/s);
  assert.match(mode, /Analyse Only and detector review remain available/);
  assert.match(mode, /payload\.targetSurface === "longdoc"/);
  assert.match(mode, /longdoc\.value = payload\.assembledText/);
  assert.match(mode, /Nothing was trimmed/);
  assert.match(mode, /startJob\.disabled = true/);
});

test("source ingestion exposes bibliographic review and length-aware handoff metadata", async () => {
  const [html, ui, importer, detector] = await Promise.all([
    readFile(new URL("public/source-authoring.html", root), "utf8"),
    readFile(new URL("public/sourceGroundedAuthoringUI.js", root), "utf8"),
    readFile(new URL("public/fileImport.js", root), "utf8"),
    readFile(new URL("public/detectorScreenshotGateway.js", root), "utf8"),
  ]);
  assert.match(html, /id="referenceWorkspace"/);
  assert.match(html, /id="sourcePreflight"/);
  assert.match(html, /automatic length routing/);
  assert.match(ui, /targetSurface: wordCount\(draft\) > state\.capabilities\.singleEditorWordLimit \? "longdoc" : "single"/);
  assert.match(ui, /bibliographic-fields/);
  assert.match(ui, /Confirm source identity/);
  assert.match(ui, /INPUT PRESERVATION FAILED/);
  assert.match(ui, /function updatePreflight/);
  assert.match(ui, /Confirm at least one source identity before spending a guided-selection call/);
  assert.match(ui, /\/api\/source-authoring\/synthesize/);
  assert.match(ui, /Source synthesis completed in/);
  assert.match(ui, /workflowMode: outputKind === "synthesis" \? "source_synthesis"/);
  assert.match(importer, /pdf\.getMetadata\(\)/);
  assert.match(detector, /sourceAuthoringCandidate/);
  assert.match(detector, /complete source-grounded assembly/);
});

test("all three workspace headers link to one another", async () => {
  const [editor, studio, source] = await Promise.all([
    readFile(new URL("public/index.html", root), "utf8"),
    readFile(new URL("public/studio.html", root), "utf8"),
    readFile(new URL("public/source-authoring.html", root), "utf8"),
  ]);
  for (const html of [editor, studio, source]) {
    assert.match(html, /href="\/editor"/);
    assert.match(html, /href="\/studio"/);
    assert.match(html, /href="\/source-authoring"/);
  }
});
