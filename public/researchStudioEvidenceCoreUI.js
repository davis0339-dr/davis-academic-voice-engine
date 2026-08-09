(() => {
  "use strict";

  const UI_VERSION = "2.2.0";
  const $ = (id) => document.getElementById(id);
  const SUPPORTED_ACCEPT = ".txt,.md,.markdown,.docx,.pdf,.csv,.xlsx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function statusElement() {
    return $("researchEvidenceStatus") || $("researchEvidenceUiStatus");
  }

  function setStatus(message, error = false) {
    const status = statusElement();
    if (status) {
      status.textContent = message;
      status.className = `file-status ${error ? "error" : ""}`.trim();
    }
    const studioStatus = $("researchStudioStatus");
    if (studioStatus && error) {
      studioStatus.textContent = message;
      studioStatus.className = "status-message error";
    }
  }

  function safeFileName(value) {
    return String(value || "supporting-source")
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || "supporting-source";
  }

  function sendFiles(files) {
    const input = $("researchEvidenceFiles");
    if (!input) return setStatus("Evidence file input is unavailable. Reload the Research Studio and try again.", true);
    const chosen = Array.from(files || []);
    if (!chosen.length) return;
    try {
      const transfer = new DataTransfer();
      chosen.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (err) {
      setStatus(`Could not attach the selected files: ${err.message}`, true);
    }
  }

  function addPastedSource() {
    const text = $("evidencePasteText")?.value.trim() || "";
    const title = $("evidencePasteTitle")?.value.trim() || "pasted-supporting-source";
    if (!text) return setStatus("Paste article, report, document, dataset notes, or other supporting text before adding it.", true);
    try {
      const file = new File([text], `${safeFileName(title)}.txt`, { type: "text/plain" });
      sendFiles([file]);
      if ($("evidencePasteText")) $("evidencePasteText").value = "";
      setStatus(`Added pasted supporting source: ${title}.`);
    } catch (err) {
      setStatus(`Could not add pasted supporting source: ${err.message}`, true);
    }
  }

  async function pasteFromClipboard() {
    const target = $("evidencePasteText");
    if (!target) return;
    if (!navigator.clipboard?.readText) {
      target.focus();
      return setStatus("Clipboard reading is not available in this browser. Click inside the paste box and use Ctrl+V / Cmd+V.");
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return setStatus("The clipboard does not currently contain readable text.", true);
      target.value = text;
      target.focus();
      setStatus("Clipboard text loaded. Add a source title if useful, then click Add pasted source.");
    } catch {
      target.focus();
      setStatus("Browser clipboard permission was not granted. Use Ctrl+V / Cmd+V in the paste box instead.");
    }
  }

  function addAuthorNotes() {
    const notes = $("evidenceAuthorNotes")?.value.trim() || "";
    const thoughts = $("researcherThoughts");
    if (!notes) return setStatus("Add author jottings or notes first.", true);
    if (!thoughts) return setStatus("Researcher reasoning field is unavailable.", true);
    const prefix = thoughts.value.trim() ? "\n\n" : "";
    thoughts.value = `${thoughts.value.trim()}${prefix}[Author jottings / researcher notes]\n${notes}`;
    thoughts.dispatchEvent(new Event("input", { bubbles: true }));
    if ($("evidenceAuthorNotes")) $("evidenceAuthorNotes").value = "";
    setStatus("Author jottings added to researcher reasoning. They shape the argument map but are not treated as independent scholarly evidence.");
  }

  function evidenceSectionFor(input) {
    return input?.closest(".research-studio-card") || null;
  }

  function install() {
    const fileInput = $("researchEvidenceFiles");
    const sourceList = $("researchSourceList");
    if (!fileInput || !sourceList) return false;

    fileInput.setAttribute("accept", SUPPORTED_ACCEPT);

    const existing = $("researchEvidenceCoreControls");
    if (existing) {
      const oldToolbar = fileInput.closest(".file-toolbar");
      if (oldToolbar) oldToolbar.hidden = true;
      return true;
    }

    const section = evidenceSectionFor(fileInput);
    if (!section) return false;

    const oldToolbar = fileInput.closest(".file-toolbar");
    const legacyStatus = $("researchEvidenceStatus");

    const controls = document.createElement("section");
    controls.id = "researchEvidenceCoreControls";
    controls.dataset.evidenceUiVersion = UI_VERSION;
    controls.className = "research-evidence-core-controls";
    controls.innerHTML = `
      <div class="research-evidence-core-head">
        <div>
          <strong>Add evidence and research inputs</strong>
          <p>Choose files directly from this device, drag and drop them, or paste supporting text.</p>
        </div>
        <span class="research-evidence-badge">Evidence UI v${UI_VERSION}</span>
      </div>

      <div class="research-evidence-upload-row">
        <button id="browseResearchEvidenceBtn" class="primary research-evidence-browse" type="button">Choose files from device</button>
        <span id="researchEvidenceUiStatus" class="file-status">TXT, MD, DOCX, text-based PDF, CSV and XLSX are supported.</span>
      </div>

      <div id="researchEvidenceDropZone" class="research-evidence-dropzone" tabindex="0" role="button" aria-label="Drop supporting evidence files here or press Enter to choose files">
        <strong>Drag and drop evidence files here</strong>
        <span>Journal articles, reports, supporting documents, CSV datasets and Excel workbooks</span>
      </div>

      <details class="research-evidence-paste" open>
        <summary><strong>Paste a source instead of uploading a file</strong></summary>
        <div class="research-evidence-paste-actions">
          <button id="pasteResearchEvidenceClipboardBtn" type="button">Paste text from clipboard</button>
          <span class="muted">or click in the box below and use Ctrl+V / Cmd+V</span>
        </div>
        <label>Source title / label
          <input id="evidencePasteTitle" type="text" maxlength="120" placeholder="e.g. Anderson et al. (2004), supervisor memo, industry report" />
        </label>
        <label>Source text
          <textarea id="evidencePasteText" rows="8" placeholder="Paste the article excerpt, report passage, document text, dataset notes, literature extract, or other supporting material here…"></textarea>
        </label>
        <button id="addPastedEvidenceBtn" type="button">Add pasted source to Evidence Workspace</button>
      </details>

      <details class="research-evidence-notes">
        <summary><strong>Add author jottings / field notes / supervisor notes</strong></summary>
        <p>These inputs shape your reasoning and interpretation but remain distinct from external scholarly evidence.</p>
        <textarea id="evidenceAuthorNotes" rows="6" placeholder="Type or paste your own notes, observations, interpretation, supervisor comments or rough ideas…"></textarea>
        <button id="addAuthorNotesBtn" type="button">Add notes to Researcher Reasoning</button>
      </details>`;

    if (oldToolbar) oldToolbar.insertAdjacentElement("afterend", controls);
    else sourceList.insertAdjacentElement("beforebegin", controls);

    if (legacyStatus) {
      legacyStatus.hidden = true;
      legacyStatus.setAttribute("aria-hidden", "true");
    }
    if (oldToolbar) oldToolbar.hidden = true;

    $("browseResearchEvidenceBtn")?.addEventListener("click", () => fileInput.click());
    $("pasteResearchEvidenceClipboardBtn")?.addEventListener("click", pasteFromClipboard);
    $("addPastedEvidenceBtn")?.addEventListener("click", addPastedSource);
    $("addAuthorNotesBtn")?.addEventListener("click", addAuthorNotes);

    const dropZone = $("researchEvidenceDropZone");
    dropZone?.addEventListener("click", () => fileInput.click());
    dropZone?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });
    ["dragenter", "dragover"].forEach((name) => dropZone?.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-active");
    }));
    ["dragleave", "drop"].forEach((name) => dropZone?.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-active");
    }));
    dropZone?.addEventListener("drop", (event) => sendFiles(event.dataTransfer?.files));

    setStatus("TXT, MD, DOCX, text-based PDF, CSV and XLSX are supported. Choose files, drag-and-drop, or paste a source below.");
    return true;
  }

  const style = document.createElement("style");
  style.id = "researchEvidenceCoreUiStyles";
  style.textContent = `
    .research-studio-intro,.research-studio-card{background:var(--panel)!important;color:var(--text)!important;border-color:var(--border)!important}
    .research-studio-card h3,.research-studio-card h4,.research-studio-card strong,.research-studio-intro h3{color:var(--text)}
    .research-studio-card input,.research-studio-card textarea,.research-studio-card select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:.55rem}
    .research-studio-card .muted,.research-studio-intro .muted{color:var(--muted)!important}
    .research-summary-callout,.evidence-link,.integrity-overall{background:var(--panel-2)!important;color:var(--text)!important}
    .research-evidence-core-controls{margin:.8rem 0 1rem;padding:1rem;border:1px solid #4f6f8e;border-radius:12px;background:rgba(12,22,34,.75)}
    .research-evidence-core-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap}.research-evidence-core-head p{margin:.28rem 0;color:var(--muted)}
    .research-evidence-badge{padding:.28rem .58rem;border:1px solid #4f6f8e;border-radius:999px;font-size:.78em;color:#b8c7d9;white-space:nowrap}
    .research-evidence-upload-row{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;margin:.9rem 0}.research-evidence-browse{font-size:1rem!important;min-height:46px!important;padding:.7rem 1.1rem!important}
    .research-evidence-dropzone{display:grid;gap:.28rem;padding:1.15rem;border:2px dashed #647f9b;border-radius:10px;text-align:center;cursor:pointer;background:rgba(255,255,255,.025)}.research-evidence-dropzone:hover,.research-evidence-dropzone.drag-active{border-color:var(--accent);background:rgba(91,141,239,.1)}.research-evidence-dropzone span{color:var(--muted);font-size:.88em}
    .research-evidence-paste,.research-evidence-notes{margin-top:.9rem;padding:.8rem;border:1px solid var(--border);border-radius:9px}.research-evidence-paste label{display:grid;gap:.35rem;margin:.65rem 0}.research-evidence-paste textarea,.research-evidence-notes textarea{width:100%;box-sizing:border-box}.research-evidence-notes p{color:var(--muted)}
    .research-evidence-paste-actions{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin:.7rem 0}
    @media(max-width:760px){.research-evidence-upload-row{align-items:stretch}.research-evidence-browse{width:100%}.research-evidence-paste-actions{align-items:stretch}.research-evidence-paste-actions button{width:100%}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const retry = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 160) clearInterval(retry);
  }, 50);

  const observer = new MutationObserver(() => {
    if (install()) observer.disconnect();
  });
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else queueMicrotask(install);

  window.__DavisResearchEvidenceUI = { version: UI_VERSION, install };
})();
