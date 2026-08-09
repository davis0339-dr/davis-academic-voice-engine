(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function safeFileName(value) {
    return String(value || "supporting-source")
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || "supporting-source";
  }

  function setStatus(message, error = false) {
    const el = $("researchStudioStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `status-message ${error ? "error" : ""}`.trim();
  }

  function attachSyntheticTextSource(title, text) {
    const input = $("researchEvidenceFiles");
    if (!input) return setStatus("Evidence source input is unavailable.", true);
    const body = String(text || "").trim();
    if (!body) return setStatus("Paste some supporting source text first.", true);
    try {
      const file = new File([body], `${safeFileName(title)}.txt`, { type: "text/plain" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (err) {
      setStatus(`Could not add pasted source: ${err.message}`, true);
    }
  }

  function appendAuthorNotes() {
    const notes = $("authorJottings")?.value.trim() || "";
    const thoughts = $("researcherThoughts");
    if (!notes) return setStatus("Add your jottings or research notes first.", true);
    if (!thoughts) return setStatus("Researcher reasoning field is unavailable.", true);
    thoughts.value = `${thoughts.value.trim()}${thoughts.value.trim() ? "\n\n" : ""}[Author jottings / researcher notes]\n${notes}`;
    thoughts.dispatchEvent(new Event("input", { bubbles: true }));
    setStatus("Author jottings added to researcher reasoning. They will shape the argument map but will not be mislabelled as external scholarly evidence.");
  }

  function install() {
    const fileInput = $("researchEvidenceFiles");
    const evidenceResults = $("evidenceAlignmentResults");
    if (!fileInput || !evidenceResults || $("expandedEvidenceInputs")) return Boolean(fileInput);

    fileInput.setAttribute("accept", ".txt,.md,.markdown,.docx,.pdf,.csv,.xlsx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const status = $("researchEvidenceStatus");
    if (status) {
      status.textContent = "Add supporting TXT, MD, DOCX, text-based PDF, CSV or XLSX sources. Journal articles, reports, datasets and working documents are all supported.";
    }

    const panel = document.createElement("section");
    panel.id = "expandedEvidenceInputs";
    panel.className = "expanded-evidence-inputs";
    panel.innerHTML = `
      <div class="expanded-evidence-head"><strong>Additional research inputs</strong><span>Keep provenance clear</span></div>
      <p class="muted">External scholarly/supporting material and researcher-originated notes are handled differently. Uploaded/pasted sources can support claims; your own jottings or voice reasoning shape the argument but are not presented as independent evidence.</p>
      <div class="expanded-evidence-grid">
        <label>Paste an article, report, memo or other supporting source
          <input id="pastedSourceTitle" type="text" maxlength="120" placeholder="Source title / short label" />
          <textarea id="pastedSupportingSource" rows="6" placeholder="Paste source text or an extracted passage here…"></textarea>
          <button id="addPastedSupportingSource" type="button">Add as supporting source</button>
        </label>
        <label>Author jottings / field notes / supervisor notes
          <textarea id="authorJottings" rows="6" placeholder="Rough ideas, interpretation notes, observations, reminders, supervisor guidance or your own thinking…"></textarea>
          <button id="addAuthorJottings" type="button">Add to researcher reasoning</button>
        </label>
      </div>
      <p class="muted">Voice Reasoning remains available above. A voice transcript and typed jottings feed the same researcher-approved argument map.</p>`;

    evidenceResults.parentElement?.insertBefore(panel, evidenceResults);
    $("addPastedSupportingSource")?.addEventListener("click", () => {
      attachSyntheticTextSource($("pastedSourceTitle")?.value || "pasted-supporting-source", $("pastedSupportingSource")?.value || "");
    });
    $("addAuthorJottings")?.addEventListener("click", appendAuthorNotes);
    return true;
  }

  const style = document.createElement("style");
  style.textContent = `
    .expanded-evidence-inputs{margin:1rem 0;padding:1rem;border:1px solid #405269;border-radius:10px;background:rgba(8,16,28,.22)}
    .expanded-evidence-head{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}.expanded-evidence-head span{opacity:.7}.expanded-evidence-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:.75rem}.expanded-evidence-grid label{display:grid;gap:.45rem;align-content:start}.expanded-evidence-grid textarea,.expanded-evidence-grid input{width:100%;box-sizing:border-box}@media(max-width:800px){.expanded-evidence-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 120) clearInterval(timer);
  }, 75);
})();
