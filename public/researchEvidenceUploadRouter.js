(() => {
  "use strict";

  const ROUTER_VERSION = "3.2.0";
  const SPREADSHEET_RE = /\.(?:xlsx|csv)$/i;
  const BANK_MAX_BYTES = 25 * 1024 * 1024;
  const DIRECT_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
  const TARGET_WAIT_MS = 2500;
  const REPAIR_WAIT_MS = 6000;
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

  function waitForElement(id, timeoutMs = TARGET_WAIT_MS) {
    const existing = $(id);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const started = Date.now();
      let settled = false;
      let observer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        observer?.disconnect();
        resolve(value || null);
      };
      const check = () => {
        const target = $(id);
        if (target) return finish(target);
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
    const sourceList = $("researchSourceList");
    const argumentButton = $("buildArgumentMapBtn");
    return input && panel && sourceList && argumentButton ? input : null;
  }

  function removePartialResearchStudio() {
    const panel = $("tab-researchstudio");
    const button = document.querySelector('.tab-header[data-tab="researchstudio"]');
    try { panel?.remove(); } catch {}
    try { button?.remove(); } catch {}
  }

  function loadRepairScript() {
    return new Promise((resolve) => {
      const prior = document.querySelector('script[data-davis-research-studio-repair="true"]');
      if (prior) prior.remove();
      const script = document.createElement("script");
      script.dataset.davisResearchStudioRepair = "true";
      script.src = `/researchStudioUI.js?v=3.1.1-repair-${Date.now()}`;
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Boolean(ok));
      };
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      const timer = setTimeout(() => finish(false), REPAIR_WAIT_MS);
      document.body.appendChild(script);
    });
  }

  async function repairResearchStudioUi() {
    if (researchStudioTargetReady()) return researchStudioTargetReady();
    gatewayStatus("Researcher Studio evidence controls are incomplete. Repairing this page automatically…");
    removePartialResearchStudio();
    const loaded = await loadRepairScript();
    if (!loaded) return null;
    return waitForElement("researchEvidenceFiles", REPAIR_WAIT_MS);
  }

  async function ensureResearchEvidenceTarget() {
    const ready = researchStudioTargetReady();
    if (ready) return ready;

    await waitForElement("researchEvidenceFiles", TARGET_WAIT_MS);
    const afterWait = researchStudioTargetReady();
    if (afterWait) return afterWait;

    return repairResearchStudioUi();
  }

  async function targetConsumedFiles(target) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
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
        gatewayStatus(`${fileName}: workbook processing did not complete within 90 seconds. Reload the Studio and retry; the interface will no longer claim that processing is still active indefinitely.`, true);
      }
    }, 90000);
  }

  async function routeSpreadsheet(file) {
    if (file.size > BANK_MAX_BYTES) {
      gatewayStatus(`${file.name} is ${fileSizeMb(file)} MB. Spreadsheet evidence is capped at 25 MB in this build.`, true);
      return false;
    }

    gatewayStatus(`Routing ${file.name} (${fileSizeMb(file)} MB) to the Literature Evidence Bank…`);
    const bankInput = await waitForElement("literatureBankFile");
    if (!bankInput) {
      gatewayStatus("The Literature Evidence Bank did not initialise. No background upload is still running. Reload the Studio and try again; if this repeats, the Literature Evidence Bank bootstrap itself has failed.", true);
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

    gatewayStatus(`Preparing ${chosen.length} direct evidence source(s)…`);
    let target = await ensureResearchEvidenceTarget();
    if (!target) {
      gatewayStatus("Researcher Studio evidence controls could not be restored automatically. No background transfer is running. Reload this page once; if the problem repeats, the Studio bootstrap has failed and should be treated as a product defect rather than a file problem.", true);
      return false;
    }

    try {
      copyFilesIntoInput(target, chosen);
      if (await targetConsumedFiles(target)) {
        gatewayStatus(`${chosen.length} direct evidence source(s) handed to the Evidence Workspace for reading.`);
        return true;
      }

      // A target element existed but no Researcher Studio consumer handled its
      // change event. This is a partial-initialisation state, so repair once and
      // replay the same File objects instead of asking the user to select again.
      gatewayStatus("Evidence input was present but its Researcher Studio handler was not active. Repairing the Studio and retrying automatically…");
      removePartialResearchStudio();
      target = await repairResearchStudioUi();
      if (!target) throw new Error("Researcher Studio repair did not restore the evidence input.");
      copyFilesIntoInput(target, chosen);
      if (!(await targetConsumedFiles(target))) throw new Error("Researcher Studio evidence handler did not consume the selected files after automatic repair.");
      gatewayStatus(`${chosen.length} direct evidence source(s) restored and handed to the Evidence Workspace for reading.`);
      return true;
    } catch (err) {
      gatewayStatus(`Could not transfer the selected evidence source(s): ${err.message}`, true);
      return false;
    }
  }

  async function routeFiles(files) {
    const chosen = Array.from(files || []);
    if (!chosen.length) return;
    const spreadsheets = chosen.filter((file) => SPREADSHEET_RE.test(file.name || ""));
    const direct = chosen.filter((file) => !SPREADSHEET_RE.test(file.name || ""));

    if (spreadsheets.length > 1) {
      gatewayStatus(`You selected ${spreadsheets.length} spreadsheets. The Literature Evidence Bank holds one active workbook at a time; routing the first (${spreadsheets[0].name}). Load the others separately after reviewing the first.`);
    }

    if (spreadsheets.length) await routeSpreadsheet(spreadsheets[0]);
    if (direct.length) await routeDirectSources(direct);
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
    routeSpreadsheet(spreadsheets[0])
      .then(() => direct.length ? routeDirectSources(direct) : true)
      .catch((err) => gatewayStatus(`Evidence routing failed: ${err.message}`, true));
    try { event.target.value = ""; } catch {}
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

  function clearFalseInitialisingState() {
    const text = String($("evidenceGatewayStatus")?.textContent || "");
    if (!/still initialising|transferred automatically|did not initialise within 12 seconds/i.test(text)) return;
    if (researchStudioTargetReady() || $("literatureBankFile")) {
      gatewayStatus("Evidence routes are ready. Choose the file again only if the earlier selection was made before this self-healing router loaded.");
      return;
    }
    gatewayStatus("Researcher Studio evidence controls are not ready yet. The router will attempt an automatic repair when a direct source is selected; no upload is currently processing in the background.");
  }

  document.addEventListener("change", interceptGatewayChange, true);
  document.addEventListener("change", interceptDirectWorkspaceSpreadsheetChange, true);
  document.addEventListener("drop", interceptGatewayDrop, true);
  window.addEventListener("load", () => setTimeout(clearFalseInitialisingState, 800), { once: true });
  setTimeout(clearFalseInitialisingState, 5000);

  window.__DavisEvidenceUploadRouter = {
    version: ROUTER_VERSION,
    routeFiles,
    routeSpreadsheet,
    routeDirectSources,
    ensureResearchEvidenceTarget,
    limits: { spreadsheetBytes: BANK_MAX_BYTES, directSourceBytes: DIRECT_SOURCE_MAX_BYTES },
  };
})();
