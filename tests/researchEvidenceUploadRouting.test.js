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
  assert.ok(JAND_GUY_TRIAL_BYTES > DIRECT_LIMIT, "trial workbook should exceed the old direct Evidence Workspace limit");
  assert.ok(JAND_GUY_TRIAL_BYTES < BANK_LIMIT, "trial workbook should fit the Literature Evidence Bank limit");

  const router = read("public/researchEvidenceUploadRouter.js");
  assert.match(router, /SPREADSHEET_RE\s*=\s*\/\\\.\(\?:xlsx\|csv\)/i);
  assert.match(router, /BANK_MAX_BYTES\s*=\s*25\s*\*\s*1024\s*\*\s*1024/);
  assert.match(router, /DIRECT_SOURCE_MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(router, /waitForElement\("literatureBankFile"\)/);
  assert.match(router, /copyFilesIntoInput\(bankInput, \[file\]\)/);
});

test("spreadsheet routing also intercepts the internal Research Studio file chooser", () => {
  const router = read("public/researchEvidenceUploadRouter.js");
  assert.match(router, /event\.target\?\.id !== "researchEvidenceFiles"/);
  assert.match(router, /interceptDirectWorkspaceSpreadsheetChange/);
  assert.match(router, /document\.addEventListener\("change", interceptDirectWorkspaceSpreadsheetChange, true\)/);
});

test("Evidence gateway preflights Researcher Studio readiness and repairs partial bootstrap before declaring failure", () => {
  const router = read("public/researchEvidenceUploadRouter.js");
  assert.match(router, /ROUTER_VERSION\s*=\s*"3\.3\.0"/);
  assert.match(router, /TARGET_WAIT_MS\s*=\s*1200/);
  assert.match(router, /REPAIR_MAX_MS\s*=\s*30000/);
  assert.match(router, /REPAIR_RETRIES\s*=\s*2/);
  assert.match(router, /async function preflightResearchStudio/);
  assert.match(router, /queueMicrotask\(\(\) =>/);
  assert.match(router, /repairResearchStudioUi/);
  assert.match(router, /replaying the same source automatically/i);
  assert.match(router, /processing did not complete within 90 seconds/i);
  assert.doesNotMatch(router, /REPAIR_WAIT_MS\s*=\s*6000/);
  assert.doesNotMatch(router, /did not initialise within 12 seconds/i);
  assert.doesNotMatch(router, /could not be restored automatically/i);
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

test("Studio loads the sheet-aware bank before the router and cache-busts the core Research Studio scripts", () => {
  const html = read("public/studio.html");
  const bankIndex = html.indexOf("researchEvidenceBankUI.js?v=3.2.0");
  const routerIndex = html.indexOf("researchEvidenceUploadRouter.js?v=3.2.1");
  assert.ok(bankIndex >= 0, "Literature Evidence Bank script should be present");
  assert.ok(routerIndex > bankIndex, "upload router must load after Literature Evidence Bank UI");
  assert.match(html, /Evidence Gateway v3\.2\.1/);
  assert.match(html, /researchStudioUI\.js\?v=3\.1\.1/);
  assert.match(html, /researchCoauthoringUI\.js\?v=1\.0\.0/);
  assert.match(html, /fileImport\.js\?v=3\.1\.0/);
  assert.match(html, /CSV\/XLSX: Literature Evidence Bank \(25 MB, up to 10,000 indexed rows per worksheet/i);
});