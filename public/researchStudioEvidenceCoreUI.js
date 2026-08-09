(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SUPPORTED_ACCEPT = ".txt,.md,.markdown,.docx,.pdf,.csv,.xlsx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function setStatus(message, error = false) {
    const status = $("researchEvidenceStatus");
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
    if (!input) return setStatus("Evidence file input is unavailable. Refresh the Studio and try again.", true);
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
    if (!text) return setStatus("Paste article, report, dataset notes, or other supporting text before adding it.", true);
    try {
      const file = new File([text], `${safeFileName(title)}.txt`, { type: "text/plain" });
      sendFiles([file]);
      if ($("evidencePasteText")) $("evidencePasteText").value = "";
      setStatus(`Added pasted supporting source: ${title}.`);
    } catch (err) {
      setStatus(`Could not add pasted supporting source: ${err.message}`, true);
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
    setStatus("Author jottings added to researcher reasoning. They will shape the argument map but will not be treated as independent scholarly evidence.");
  }

  function install() {
    const fileInput = $("researchEvidenceFiles");
    const sourceList = $("researchSourceList");
    if (!fileInput || !sourceList || $("researchEvidenceCoreControls")) return Boolean(fileInput && sourceList);

    fileInput.setAttribute("accept", SUPPORTED_ACCEPT);

    const oldToolbar = fileInput.closest(".file-toolbar");
    if (oldToolbar) oldToolbar.hidden = true;

    const controls = document.createElement("section");
    controls.id = "researchEvidenceCoreControls";
    controls.className = "research-evidence-core-controls";
    controls.innerHTML = `
      <div class="research-evidence-core-head">
        <div>
          <strong>Add evidence and research inputs</strong>
          <p>Use an actual device-file picker, drag files here, or paste source text directly.</p>
        </div>
        <span class="research-evidence-badge">Up to 8 sources</span>
      </div>

      <div class="research-evidence-upload-row">
        <button id="browseResearchEvidenceBtn" class="primary research-evidence-browse" type="button">Choose files from device</button>
        <span id="researchEvidenceStatus" class="file-status">TXT, MD, DOCX, text-based PDF, CSV and XLSX are supported.</span>
      </div>

      <div id="researchEvidenceDropZone" class="research-evidence-dropzone" tabindex="0" role="button" aria-label="Drop supporting evidence files here or press Enter to choose files">
        <strong>Drag and drop evidence files here</strong>
        <span>Journal articles, reports, supporting documents, CSV datasets and Excel workbooks</span>
      </div>

      <details class="research-evidence-paste" open>
        <summary><strong>Paste a source instead of uploading a file</strong></summary>
        <label>Source title / label
          <input id="evidencePasteTitle" type="text" maxlength="120" placeholder="e.g. Anderson et al. (2004), supervisor memo, industry report" />
        </label>
        <label>Source text
          <textarea id="evidencePasteText" rows="7" placeholder="Paste the article excerpt, report passage, document text, dataset notes, or other supporting material here…"></textarea>
        </label>
        <button id="addPastedEvidenceBtn" type="button">Add pasted source to Evidence Workspace</button>
      </details>

      <details class="research-evidence-notes">
        <summary><strong>Add author jottings / field notes / supervisor notes</strong></summary>
        <p>These shape your argument and interpretation but are kept distinct from external scholarly evidence.</p>
        <textarea id="evidenceAuthorNotes" rows="6" placeholder="Type or paste your own notes, observations, interpretation, supervisor comments or rough ideas…"></textarea>
        <button id="addAuthorNotesBtn" type="button">Add notes to Researcher Reasoning</button>
      </details>`;

    sourceList.insertAdjacentElement("beforebegin", controls);

    const browse = $("browseResearchEvidenceBtn");
    browse?.addEventListener("click", () => fileInput.click());

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

    $("addPastedEvidenceBtn")?.addEventListener("click", addPastedSource);
    $("addAuthorNotesBtn")?.addEventListener("click", addAuthorNotes);

    setStatus("TXT, MD, DOCX, text-based PDF, CSV and XLSX are supported. Choose files, drag-and-drop, or paste a source below.");
    return true;
  }

  const style = document.createElement("style");
  style.textContent = `
    .research-studio-intro,.research-studio-card{background:var(--panel)!important;color:var(--text)!important;border-color:var(--border)!important}
    .research-studio-card h3,.research-studio-card h4,.research-studio-card strong,.research-studio-intro h3{color:var(--text)}
    .research-studio-card input,.research-studio-card textarea,.research-studio-card select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:.55rem}
    .research-studio-card .muted,.research-studio-intro .muted{color:var(--muted)!important}
    .research-summary-callout,.evidence-link,.integrity-overall{background:var(--panel-2)!important;color:var(--text)!important}
    .research-evidence-core-controls{margin:.75rem 0 1rem;padding:1rem;border:1px solid #466078;border-radius:10px;background:rgba(12,22,34,.62)}
    .research-evidence-core-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap}.research-evidence-core-head p{margin:.25rem 0;color:var(--muted)}
    .research-evidence-badge{padding:.25rem .55rem;border:1px solid #466078;border-radius:999px;font-size:.78em;color:var(--muted)}
    .research-evidence-upload-row{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin:.8rem 0}.research-evidence-browse{font-size:.95rem!important;min-height:44px!important;padding:.65rem 1rem!important}
    .research-evidence-dropzone{display:grid;gap:.25rem;padding:1rem;border:2px dashed #58718a;border-radius:10px;text-align:center;cursor:pointer;background:rgba(255,255,255,.02)}.research-evidence-dropzone:hover,.research-evidence-dropzone.drag-active{border-color:var(--accent);background:rgba(91,141,239,.08)}.research-evidence-dropzone span{color:var(--muted);font-size:.85em}
    .research-evidence-paste,.research-evidence-notes{margin-top:.85rem;padding:.75rem;border:1px solid var(--border);border-radius:8px}.research-evidence-paste label{display:grid;gap:.3rem;margin:.6rem 0}.research-evidence-paste textarea,.research-evidence-notes textarea{width:100%;box-sizing:border-box}.research-evidence-notes p{color:var(--muted)}
    @media(max-width:760px){.research-evidence-upload-row{align-items:stretch}.research-evidence-browse{width:100%}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 100) clearInterval(timer);
  }, 50);
})();
