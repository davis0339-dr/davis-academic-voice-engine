import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const JAND_GUY_TRIAL_BYTES = 8065442;
const DIRECT_LIMIT = 5 * 1024 * 1024;
const BANK_LIMIT = 25 * 1024 * 1024;

test("Jand Guy-sized workbook is routed to the 25 MB Literature Evidence Bank instead of the 5 MB direct-source reader", () => {
  assert.ok(JAND_GUY_TRIAL_BYTES > DIRECT_LIMIT, "trial workbook should exceed the direct Evidence Workspace limit");
  assert.ok(JAND_GUY_TRIAL_BYTES < BANK_LIMIT, "trial workbook should fit the Literature Evidence Bank limit");

  const router = read("public/researchEvidenceUploadRouter.js");
  assert.match(router, /SPREADSHEET_RE\s*=\s*\/\\\.\(\?:xlsx\|csv\)/i);
  assert.match(router, /BANK_MAX_BYTES\s*=\s*25\s*\*\s*1024\s*\*\s*1024/);
  assert.match(router, /DIRECT_SOURCE_MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(router, /\$\("literatureBankFile"\)/);
  assert.match(router, /copyFilesIntoInput\(bankInput, \[file\]\)/);
});

test("spreadsheet routing also intercepts the internal Research Studio file chooser", () => {
  const router = read("public/researchEvidenceUploadRouter.js");
  assert.match(router, /event\.target\?\.id !== "researchEvidenceFiles"/);
  assert.match(router, /interceptDirectWorkspaceSpreadsheetChange/);
  assert.match(router, /document\.addEventListener\("change", interceptDirectWorkspaceSpreadsheetChange, true\)/);
});

test("Evidence routing uses stable markup and refuses destructive panel reconstruction", () => {
  const router = read("public/researchEvidenceUploadRouter.js");
  const html = read("public/studio.html");
  assert.match(router, /ROUTER_VERSION\s*=\s*"4\.0\.1"/);
  assert.match(router, /READY_WAIT_MS\s*=\s*5000/);
  assert.match(router, /async function preflight/);
  assert.match(router, /queueMicrotask\(async \(\) =>/);
  assert.match(router, /The interface was not rebuilt behind the scenes/i);
  assert.match(router, /runLocalBrowserSmoke/);
  assert.doesNotMatch(router, /repairResearchStudioUi/);
  assert.doesNotMatch(router, /removePartialResearchStudio/);
  assert.doesNotMatch(router, /loadRepairScript/);
  assert.match(html, /id="researchEvidenceWorkspaceCard"/);
  assert.match(html, /id="researchEvidenceFiles"/);
  assert.match(html, /id="evidenceInputGateway"/);
});

test("Literature Evidence Bank retains every worksheet instead of silently choosing only the largest sheet", () => {
  const bank = read("public/researchEvidenceBankUI.js");
  assert.match(bank, /BANK_VERSION\s*=\s*"3\.2\.0"/);
  assert.match(bank, /sheets:\s*\[\]/);
  assert.match(bank, /state\.sheets\s*=\s*sheets/);
  assert.match(bank, /literatureBankSheetSelect/);
  assert.match(bank, /worksheet\(s\) retained/i);
  assert.match(bank, /mappingBySheet/);
  assert.doesNotMatch(bank, /sheets\.reduce\(\(best, current\).*current\.records\.length > best\.records\.length/s);
});

test("Studio loads one evidence surface and cache-busts the functional scripts together", () => {
  const html = read("public/studio.html");
  const bankIndex = html.indexOf("researchEvidenceBankUI.js?v=3.2.0");
  const routerIndex = html.indexOf("researchEvidenceUploadRouter.js?v=4.0.1");
  assert.ok(bankIndex >= 0, "Literature Evidence Bank script should be present");
  assert.ok(routerIndex > bankIndex, "upload router must load after Literature Evidence Bank UI");
  assert.match(html, /Evidence Gateway v4\.0\.0/);
  assert.match(html, /researchStudioUI\.js\?v=4\.0\.0/);
  assert.match(html, /researchCoauthoringUI\.js\?v=4\.0\.0/);
  assert.match(html, /fileImport\.js\?v=4\.0\.0/);
  assert.doesNotMatch(html, /researchStudioEvidenceCoreUI\.js/);
  assert.equal((html.match(/id="evidenceInputGateway"/g) || []).length, 1);
});