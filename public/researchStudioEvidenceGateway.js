(() => {
  "use strict";

  const GATEWAY_VERSION = "4.0.1";
  const $ = (id) => document.getElementById(id);
  const SUPPORTED_ACCEPT = ".txt,.md,.markdown,.docx,.pdf,.csv,.xlsx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function setGatewayStatus(message, error = false) {
    const status = $("evidenceGatewayStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `file-status ${error ? "error" : ""}`.trim();
  }

  function safeName(value) {
    return String(value || "pasted-supporting-source")
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || "pasted-supporting-source";
  }

  async function transferToResearchStudio(files) {
    const chosen = Array.from(files || []);
    if (!chosen.length) return false;

    const router = window.__DavisEvidenceUploadRouter;
    if (!router?.routeFiles) {
      setGatewayStatus("Evidence routing is unavailable on this build. The selected material was not accepted and no background transfer is running.", true);
      return false;
    }

    try {
      const ok = await router.routeFiles(chosen);
      return ok === true;
    } catch (err) {
      setGatewayStatus(`The evidence router could not process the selected source(s): ${err.message}`, true);
      return false;
    }
  }

  async function addPastedGatewaySource() {
    const text = $("evidenceGatewayPasteText")?.value.trim() || "";
    const title = $("evidenceGatewayPasteTitle")?.value.trim() || "pasted-supporting-source";
    if (!text) return setGatewayStatus("Paste supporting text before adding the source.", true);

    try {
      const file = new File([text], `${safeName(title)}.txt`, { type: "text/plain" });
      const loaded = await transferToResearchStudio([file]);
      if (!loaded) return;
      $("evidenceGatewayPasteText").value = "";
      setGatewayStatus(`Pasted source “${title}” loaded into Evidence Workspace.`);
    } catch (err) {
      setGatewayStatus(`Could not add the pasted source: ${err.message}`, true);
    }
  }

  async function pasteClipboard() {
    const box = $("evidenceGatewayPasteText");
    if (!box) return;
    if (!navigator.clipboard?.readText) {
      box.focus();
      return setGatewayStatus("Clipboard access is unavailable here. Use Ctrl+V / Cmd+V in the paste box.");
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return setGatewayStatus("Clipboard does not contain readable text.", true);
      box.value = text;
      box.focus();
      setGatewayStatus("Clipboard text loaded. Add a source label if useful, then click Add pasted source.");
    } catch {
      box.focus();
      setGatewayStatus("Clipboard permission was not granted. Use Ctrl+V / Cmd+V in the paste box instead.");
    }
  }

  function bind() {
    const input = $("evidenceGatewayFiles");
    if (input) input.accept = SUPPORTED_ACCEPT;

    $("addGatewayPastedSourceBtn")?.addEventListener("click", () => {
      addPastedGatewaySource().catch((err) => setGatewayStatus(`Could not add the pasted source: ${err.message}`, true));
    });
    $("pasteGatewayClipboardBtn")?.addEventListener("click", pasteClipboard);

    const drop = $("evidenceGatewayDropZone");
    ["dragenter", "dragover"].forEach((name) => drop?.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.add("drag-active");
    }));
    ["dragleave", "drop"].forEach((name) => drop?.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.remove("drag-active");
    }));
    drop?.addEventListener("click", () => input?.click());
    drop?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input?.click();
      }
    });

    const gateway = $("evidenceInputGateway");
    if (gateway) gateway.dataset.gatewayVersion = GATEWAY_VERSION;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
