(() => {
  "use strict";

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

  function transferToResearchStudio(files) {
    const target = $("researchEvidenceFiles");
    const chosen = Array.from(files || []);
    if (!chosen.length) return false;
    if (!target) {
      setGatewayStatus("Files selected. Research Studio is still initialising; they will be transferred automatically.");
      return false;
    }
    try {
      const transfer = new DataTransfer();
      chosen.forEach((file) => transfer.items.add(file));
      target.files = transfer.files;
      target.dispatchEvent(new Event("change", { bubbles: true }));
      setGatewayStatus(`${chosen.length} source file(s) sent into Evidence Workspace.`);
      return true;
    } catch (err) {
      setGatewayStatus(`The files were selected, but could not be transferred into Evidence Workspace: ${err.message}`, true);
      return false;
    }
  }

  function forwardGatewayFiles() {
    const input = $("evidenceGatewayFiles");
    if (!input?.files?.length) return;
    if (transferToResearchStudio(input.files)) input.value = "";
  }

  function addPastedGatewaySource() {
    const text = $("evidenceGatewayPasteText")?.value.trim() || "";
    const title = $("evidenceGatewayPasteTitle")?.value.trim() || "pasted-supporting-source";
    if (!text) return setGatewayStatus("Paste supporting text before adding the source.", true);
    try {
      const file = new File([text], `${safeName(title)}.txt`, { type: "text/plain" });
      if (!transferToResearchStudio([file])) return;
      $("evidenceGatewayPasteText").value = "";
      setGatewayStatus(`Pasted source “${title}” added to Evidence Workspace.`);
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

  function moveGatewayIntoEvidenceWorkspace() {
    const gateway = $("evidenceInputGateway");
    const hiddenInput = $("researchEvidenceFiles");
    if (!gateway || !hiddenInput) return false;
    const card = hiddenInput.closest(".research-studio-card");
    const heading = card?.querySelector("h4");
    if (!card || !heading) return false;

    if (gateway.parentElement !== card) heading.insertAdjacentElement("afterend", gateway);
    card.querySelector(".file-toolbar")?.setAttribute("hidden", "");
    return true;
  }

  function bind() {
    const input = $("evidenceGatewayFiles");
    if (input) {
      input.accept = SUPPORTED_ACCEPT;
      input.addEventListener("change", forwardGatewayFiles);
    }
    $("addGatewayPastedSourceBtn")?.addEventListener("click", addPastedGatewaySource);
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
    drop?.addEventListener("drop", (event) => transferToResearchStudio(event.dataTransfer?.files));
    drop?.addEventListener("click", () => input?.click());
    drop?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input?.click();
      }
    });

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const moved = moveGatewayIntoEvidenceWorkspace();
      if (moved && $("evidenceGatewayFiles")?.files?.length) forwardGatewayFiles();
      if (moved || attempts >= 200) clearInterval(timer);
    }, 50);

    const observer = new MutationObserver(() => {
      if (moveGatewayIntoEvidenceWorkspace()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
