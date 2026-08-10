(() => {
  "use strict";

  const ROUTER_VERSION = "4.0.1";
  const SPREADSHEET_RE = /\.(?:xlsx|csv)$/i;
  const BANK_MAX_BYTES = 25 * 1024 * 1024;
  const DIRECT_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
  const READY_WAIT_MS = 5000;
  const POLL_MS = 80;
  const $ = (id) => document.getElementById(id);

  function gatewayStatus(message, error = false) {
    const gateway = $("evidenceGatewayStatus");
    const direct = $("researchEvidenceUiStatus") || $("researchEvidenceStatus");
    for (const el of [gateway, direct]) {
      if (!el) continue;
      el.textContent = message;
      el.className = `file-status ${error ? "error" : ""}`.trim();
    }
  }

  function fileSizeMb(file) {
    return (Number(file?.size || 0) / 1024 / 1024).toFixed(1);
  }

  function copyFilesIntoInput(input, files) {
    const transfer = new DataTransfer();
    Array.from(files || []).forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function waitFor(predicate, timeoutMs = READY_WAIT_MS) {
    const immediate = predicate();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      const started = Date.now();
      let observer = null;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        observer?.disconnect();
        resolve(value || null);
      };
      const check = () => {
        const value = predicate();
        if (value) return finish(value);
        if (Date.now() - started >= timeoutMs) finish(null);
      };
      const timer = setInterval(check, POLL_MS);
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      check();
    });
  }

  function researchStudioTargetReady() {
    const input = $("researchEvidenceFiles");
    const panel = $("tab-researchstudio");
    const card = $("researchEvidenceWorkspaceCard");
    const sourceList = $("researchSourceList");
    return input && panel && card && sourceList ? input : null;
  }

  async function ensureResearchEvidenceTarget() {
    return waitFor(researchStudioTargetReady, READY_WAIT_MS);
  }

  async function targetConsumedFiles(target) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return !target?.files?.length;
  }

  function mirrorBankStatus(fileName) {
    const bankStatus = $("literatureBankStatus");
    if (!bankStatus) return;
    const sync = () => {
      const text = String(bankStatus.textContent || "").trim();
      if (!text) return;
      const failed = /could not|failed|error|too large|no worksheet/i.test(text);
      gatewayStatus(`Spreadsheet route · ${text}`, failed);
    };
    sync();
    const observer = new MutationObserver(() => {
      sync();
      const text = String(bankStatus.textContent || "");
      if (/indexed record|could not load|too large|no worksheet/i.test(text)) observer.disconnect();
    });
    observer.observe(bankStatus, { childList: true, subtree: true, characterData: true });
    setTimeout(() => {
      observer.disconnect();
      if (/reading|routing|initialis/i.test(String($("evidenceGatewayStatus")?.textContent || ""))) {
        gatewayStatus(`${fileName}: workbook processing did not complete within 90 seconds. The interface has stopped waiting; retry the workbook once.`, true);
      }
    }, 90000);
  }

  async function routeSpreadsheet(file) {
    if (file.size > BANK_MAX_BYTES) {
      gatewayStatus(`${file.name} is ${fileSizeMb(file)} MB. Spreadsheet evidence is capped at 25 MB in this build.`, true);
      return false;
    }

    gatewayStatus(`Routing ${file.name} (${fileSizeMb(file)} MB) to the Literature Evidence Bank…`);
    const bankInput = await waitFor(() => $("literatureBankFile"), READY_WAIT_MS);
    if (!bankInput) {
      gatewayStatus("The Literature Evidence Bank is not available on this page. The workbook was not accepted and no background upload is running.", true);
      return false;
    }

    try {
      copyFilesIntoInput(bankInput, [file]);
      gatewayStatus(`${file.name} handed to the Literature Evidence Bank. Reading workbook and indexing evidence rows…`);
      mirrorBankStatus(file.name);
      return true;
    } catch (err) {
      gatewayStatus(`Could not route ${file.name} into the Literature Evidence Bank: ${err.message}`, true);
      return false;
    }
  }

  async function routeDirectSources(files) {
    const chosen = Array.from(files || []);
    if (!chosen.length) return true;

    const oversized = chosen.find((file) => file.size > DIRECT_SOURCE_MAX_BYTES);
    if (oversized) {
      gatewayStatus(`${oversized.name} is ${fileSizeMb(oversized)} MB. Direct TXT/DOCX/PDF evidence currently has a 5 MB per-file limit. Large CSV/XLSX files use the separate 25 MB Literature Evidence Bank.`, true);
      return false;
    }

    const target = await ensureResearchEvidenceTarget();
    if (!target) {
      gatewayStatus("Researcher Studio is present but its evidence input is not available. No panel rebuild or background repair was attempted; reload only if the page itself is incomplete.", true);
      return false;
    }

    try {
      gatewayStatus(`Reading ${chosen.length} evidence source(s)…`);
      copyFilesIntoInput(target, chosen);
      if (!(await targetConsumedFiles(target))) {
        gatewayStatus("The Evidence Workspace input exists, but its source reader did not consume the selected material. The source was not reported as loaded and the interface was not rebuilt behind the scenes.", true);
        return false;
      }
      gatewayStatus(`${chosen.length} evidence source(s) loaded into Researcher Studio.`);
      return true;
    } catch (err) {
      gatewayStatus(`Could not load the selected evidence source(s): ${err.message}`, true);
      return false;
    }
  }

  async function routeFiles(files) {
    const chosen = Array.from(files || []);
    if (!chosen.length) return false;

    const spreadsheets = chosen.filter((file) => SPREADSHEET_RE.test(file.name || ""));
    const direct = chosen.filter((file) => !SPREADSHEET_RE.test(file.name || ""));
    let ok = true;

    if (spreadsheets.length > 1) {
      gatewayStatus(`You selected ${spreadsheets.length} spreadsheets. The Literature Evidence Bank holds one active workbook at a time; routing the first (${spreadsheets[0].name}). Load the others separately after reviewing the first.`);
    }

    if (spreadsheets.length) ok = (await routeSpreadsheet(spreadsheets[0])) && ok;
    if (direct.length) ok = (await routeDirectSources(direct)) && ok;
    return ok;
  }

  function interceptGatewayChange(event) {
    if (event.target?.id !== "evidenceGatewayFiles") return;
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    event.stopImmediatePropagation();
    event.stopPropagation();
    routeFiles(files).catch((err) => gatewayStatus(`Evidence routing failed: ${err.message}`, true));
    try { event.target.value = ""; } catch {}
  }

  function interceptDirectWorkspaceSpreadsheetChange(event) {
    if (event.target?.id !== "researchEvidenceFiles") return;
    const files = Array.from(event.target.files || []);
    const spreadsheets = files.filter((file) => SPREADSHEET_RE.test(file.name || ""));
    if (!spreadsheets.length) return;

    const direct = files.filter((file) => !SPREADSHEET_RE.test(file.name || ""));
    event.stopImmediatePropagation();
    event.stopPropagation();
    try { event.target.value = ""; } catch {}
    routeSpreadsheet(spreadsheets[0])
      .then(() => direct.length ? routeDirectSources(direct) : true)
      .catch((err) => gatewayStatus(`Evidence routing failed: ${err.message}`, true));
  }

  function interceptGatewayDrop(event) {
    if (event.target?.id !== "evidenceGatewayDropZone" && !event.target?.closest?.("#evidenceGatewayDropZone")) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    routeFiles(files).catch((err) => gatewayStatus(`Evidence routing failed: ${err.message}`, true));
  }

  async function preflight() {
    const target = await ensureResearchEvidenceTarget();
    if (target) {
      const current = String($("evidenceGatewayStatus")?.textContent || "");
      if (!current || /initialis|repair|bootstrap|could not|failed/i.test(current)) gatewayStatus("Evidence Workspace ready.");
      return true;
    }
    gatewayStatus("Evidence Workspace markup is incomplete on this build. Source ingestion is disabled rather than pretending that a background repair is running.", true);
    return false;
  }

  async function runLocalBrowserSmoke() {
    const host = String(location.hostname || "").toLowerCase();
    const enabled = new URLSearchParams(location.search).get("evidenceSmoke") === "1";
    if (!enabled || !["127.0.0.1", "localhost"].includes(host)) return;

    document.documentElement.dataset.evidenceSmoke = "running";
    const smokeFile = new File([
      "Browser smoke evidence. Governance mechanisms can affect creditor risk assessment when they alter monitoring quality and information reliability."
    ], "browser-smoke-evidence.txt", { type: "text/plain" });

    const ok = await routeDirectSources([smokeFile]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const sourceListText = String($("researchSourceList")?.textContent || "");
    const passed = ok && /browser-smoke-evidence\.txt/i.test(sourceListText);
    document.documentElement.dataset.evidenceSmoke = passed ? "pass" : "fail";
    const marker = document.createElement("div");
    marker.id = "evidenceBrowserSmokeResult";
    marker.hidden = true;
    marker.textContent = passed ? "PASS browser-smoke-evidence.txt" : `FAIL ${String($("evidenceGatewayStatus")?.textContent || "unknown")}`;
    document.body.appendChild(marker);
  }

  document.addEventListener("change", interceptGatewayChange, true);
  document.addEventListener("change", interceptDirectWorkspaceSpreadsheetChange, true);
  document.addEventListener("drop", interceptGatewayDrop, true);

  window.__DavisEvidenceUploadRouter = {
    version: ROUTER_VERSION,
    routeFiles,
    routeSpreadsheet,
    routeDirectSources,
    ensureResearchEvidenceTarget,
    limits: { spreadsheetBytes: BANK_MAX_BYTES, directSourceBytes: DIRECT_SOURCE_MAX_BYTES },
  };

  queueMicrotask(async () => {
    try {
      await preflight();
      await runLocalBrowserSmoke();
    } catch (err) {
      gatewayStatus(`Evidence preflight failed: ${err.message}`, true);
      if (new URLSearchParams(location.search).get("evidenceSmoke") === "1") document.documentElement.dataset.evidenceSmoke = "fail";
    }
  });
})();
