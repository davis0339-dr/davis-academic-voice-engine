(() => {
  "use strict";

  const ROUTER_VERSION = "3.1.0";
  const SPREADSHEET_RE = /\.(?:xlsx|csv)$/i;
  const BANK_MAX_BYTES = 25 * 1024 * 1024;
  const DIRECT_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
  const TARGET_WAIT_MS = 12000;
  const POLL_MS = 80;
  const $ = (id) => document.getElementById(id);

  function gatewayStatus(message, error = false) {
    const el = $("evidenceGatewayStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `file-status ${error ? "error" : ""}`.trim();
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
      if (observer) observer.disconnect();
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
      gatewayStatus("The Literature Evidence Bank did not initialise within 12 seconds. No background upload is still running. Reload the Studio and try again; if this repeats, the Studio initialisation itself has failed.", true);
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
    const target = await waitForElement("researchEvidenceFiles");
    if (!target) {
      gatewayStatus("The Researcher Studio Evidence Workspace did not initialise within 12 seconds. No background transfer is still running. Reload the Studio and retry.", true);
      return false;
    }

    try {
      copyFilesIntoInput(target, chosen);
      gatewayStatus(`${chosen.length} direct evidence source(s) handed to the Evidence Workspace for reading.`);
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
      gatewayStatus(`You selected ${spreadsheets.length} spreadsheets. The Literature Evidence Bank holds one active workbook at a time; routing the first (${spreadsheets[0].name}). Load the others separately after reviewing the first.`, false);
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
    if (!/still initialising|transferred automatically/i.test(text)) return;
    if ($("researchEvidenceFiles") || $("literatureBankFile")) {
      gatewayStatus("Evidence routes are ready. Choose the file again if it was selected before the Studio finished loading.");
      return;
    }
    gatewayStatus("Researcher Studio has not initialised. No upload is processing in the background. Reload the Studio before selecting evidence.", true);
  }

  document.addEventListener("change", interceptGatewayChange, true);
  document.addEventListener("drop", interceptGatewayDrop, true);
  window.addEventListener("load", () => setTimeout(clearFalseInitialisingState, 1500), { once: true });
  setTimeout(clearFalseInitialisingState, 15000);

  window.__DavisEvidenceUploadRouter = {
    version: ROUTER_VERSION,
    routeFiles,
    limits: { spreadsheetBytes: BANK_MAX_BYTES, directSourceBytes: DIRECT_SOURCE_MAX_BYTES },
  };
})();
