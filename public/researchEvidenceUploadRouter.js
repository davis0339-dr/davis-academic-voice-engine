(() => {
  "use strict";

  const ROUTER_VERSION = "3.3.0";
  const SPREADSHEET_RE = /\.(?:xlsx|csv)$/i;
  const BANK_MAX_BYTES = 25 * 1024 * 1024;
  const DIRECT_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
  const TARGET_WAIT_MS = 1200;
  const REPAIR_MAX_MS = 30000;
  const REPAIR_RETRIES = 2;
  const POLL_MS = 80;
  const $ = (id) => document.getElementById(id);
  let repairPromise = null;
  let preflightStarted = false;

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

  function loadRepairScript(attempt = 0) {
    return new Promise((resolve) => {
      const prior = document.querySelector('script[data-davis-research-studio-repair="true"]');
      if (prior) prior.remove();

      const script = document.createElement("script");
      script.dataset.davisResearchStudioRepair = "true";
      script.src = `/researchStudioUI.js?v=3.3.0-repair-${Date.now()}-${attempt}`;

      let settled = false;
      let observer = null;
      const started = Date.now();
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        observer?.disconnect();
        resolve(result);
      };
      const checkReady = () => {
        const target = researchStudioTargetReady();
        if (target) return finish({ ok: true, target, reason: "ready" });
        if (Date.now() - started >= REPAIR_MAX_MS) return finish({ ok: false, target: null, reason: "deadline" });
      };
      const poll = setInterval(checkReady, POLL_MS);
      observer = new MutationObserver(checkReady);
      observer.observe(document.documentElement, { childList: true, subtree: true });

      script.onload = () => {
        const target = researchStudioTargetReady();
        if (target) finish({ ok: true, target, reason: "loaded" });
      };
      script.onerror = () => finish({ ok: false, target: null, reason: "script_error" });
      document.body.appendChild(script);
      checkReady();
    });
  }

  async function repairResearchStudioUi() {
    const ready = researchStudioTargetReady();
    if (ready) return ready;
    if (repairPromise) return repairPromise;

    repairPromise = (async () => {
      gatewayStatus("Researcher Studio evidence controls are incomplete. Restoring the workspace before accepting evidence…");

      for (let attempt = 0; attempt <= REPAIR_RETRIES; attempt += 1) {
        const alreadyReady = researchStudioTargetReady();
        if (alreadyReady) return alreadyReady;

        removePartialResearchStudio();
        const result = await loadRepairScript(attempt);
        if (result.ok && result.target) return result.target;

        if (result.reason === "script_error" && attempt < REPAIR_RETRIES) {
          gatewayStatus(`Researcher Studio repair load failed on attempt ${attempt + 1}. Retrying automatically…`);
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }

        if (result.reason === "deadline") break;
      }
      return researchStudioTargetReady();
    })();

    try {
      return await repairPromise;
    } finally {
      repairPromise = null;
    }
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    return !target?.files?.length;
  }

  async function preflightResearchStudio() {
    if (preflightStarted) return;
    preflightStarted = true;
    const target = await ensureResearchEvidenceTarget();
    if (target) {
      const current = String($("evidenceGatewayStatus")?.textContent || "");
      if (/initialis|incomplete|repair|restore|could not|failed/i.test(current)) {
        gatewayStatus("Evidence Workspace ready. Add files or pasted sources directly; no background repair is pending.");
      }
      return;
    }
    gatewayStatus("Researcher Studio did not become ready after a full bootstrap attempt. Reload the Studio once. If this repeats on the same build, report the build number because this is a workspace bootstrap defect, not a file problem.", true);
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
      gatewayStatus("Evidence Workspace could not reach a ready state after the full repair cycle. Your selected source was not discarded by a short timer, but it could not be handed to an active Researcher Studio consumer. Reload once and retry on the same build; if it repeats, the build has a bootstrap defect.", true);
      return false;
    }

    try {
      copyFilesIntoInput(target, chosen);
      if (await targetConsumedFiles(target)) {
        gatewayStatus(`${chosen.length} direct evidence source(s) handed to the Evidence Workspace for reading.`);
        return true;
      }

      gatewayStatus("The evidence input exists but its consumer did not process the selection. Rebuilding the Researcher Studio and replaying the same source automatically…");
      removePartialResearchStudio();
      target = await repairResearchStudioUi();
      if (!target) throw new Error("Researcher Studio repair did not restore an active evidence input.");
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
    if (researchStudioTargetReady()) {
      if (/initialis|transferred automatically|did not initialise|could not be restored|bootstrap|repair|restore/i.test(text)) {
        gatewayStatus("Evidence Workspace ready. Add files or pasted sources directly; no background repair is pending.");
      }
      return;
    }
    if (/still initialising|transferred automatically|did not initialise|could not be restored/i.test(text)) {
      gatewayStatus("Evidence Workspace is not ready yet. The router is repairing Researcher Studio now; no file transfer is being claimed as complete.");
    }
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
    repairResearchStudioUi,
    limits: { spreadsheetBytes: BANK_MAX_BYTES, directSourceBytes: DIRECT_SOURCE_MAX_BYTES },
  };

  queueMicrotask(() => {
    preflightResearchStudio().catch((err) => gatewayStatus(`Researcher Studio preflight failed: ${err.message}`, true));
  });
  window.addEventListener("load", () => {
    setTimeout(clearFalseInitialisingState, 600);
    setTimeout(() => {
      if (!researchStudioTargetReady()) preflightResearchStudio().catch(() => {});
    }, 1200);
  }, { once: true });
  setInterval(clearFalseInitialisingState, 1500);
})();