(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SOURCE_KEY = "academicVoice.workspace.source.v1";
  const REVISED_KEY = "academicVoice.workspace.revised.v1";
  const DRAFT_KEY = "academicVoice.workspace.studioDraft.v1";

  function setTab(name) {
    document.querySelectorAll(".tab-header").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`));
  }

  function bindTabs() {
    document.querySelectorAll(".tab-header").forEach((button) => {
      if (button.dataset.studioBound === "true") return;
      button.dataset.studioBound = "true";
      button.addEventListener("click", () => setTab(button.dataset.tab));
    });
  }

  function fillSelect(select, values) {
    if (!select) return;
    select.innerHTML = '<option value="">Auto / evidence-backed default</option>';
    for (const value of values || []) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = String(value).replace(/_/g, " ");
      select.appendChild(option);
    }
  }

  async function loadStyleProfiles() {
    try {
      const response = await fetch("/api/style-profiles");
      const data = await response.json();
      const dims = data.selectable_dimensions || {};
      fillSelect($("documentType"), dims.document_type);
      fillSelect($("region"), dims.region);
      fillSelect($("degree"), dims.degree);
      fillSelect($("discipline"), dims.discipline);
      fillSelect($("researchMode"), dims.research_mode);
      fillSelect($("section"), dims.section);
    } catch {
      const status = $("studioShellStatus");
      if (status) status.textContent = "Style-family controls could not load; Researcher Studio can still be used with its broad evidence-backed defaults.";
    }
  }

  function coverageRows(entries = []) {
    return entries.slice(0, 12).map((row) => `<div class="studio-coverage-row"><span>${String(row.value).replace(/_/g, " ")}</span><strong>${row.count}</strong><em>${row.strength}</em></div>`).join("");
  }

  async function loadMethodology() {
    const target = $("studioMethodology");
    if (!target) return;
    try {
      const response = await fetch("/api/methodology");
      const data = await response.json();
      if (!response.ok) throw new Error("coverage unavailable");
      target.innerHTML = `
        <section class="studio-evidence-card">
          <h3>Corpus coverage</h3>
          <p>${data.totalIncluded} independent sources are currently included in the evidence corpus. Strength labels describe corpus coverage, not authorship probability.</p>
          <div class="studio-coverage-grid">
            <div><h4>Document type</h4>${coverageRows(data.table?.document_type)}</div>
            <div><h4>Region</h4>${coverageRows(data.table?.region)}</div>
            <div><h4>Degree</h4>${coverageRows(data.table?.degree)}</div>
            <div><h4>Research mode</h4>${coverageRows(data.table?.research_mode)}</div>
          </div>
        </section>`;
    } catch {
      target.innerHTML = '<p class="muted">Corpus coverage could not load. Researcher Studio remains available.</p>';
    }
  }

  async function loadBuild() {
    const badge = $("studioBuildBadge");
    if (!badge) return;
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      badge.textContent = `build: ${data.build?.commitShort || "unknown"}`;
      if (data.build?.githubUrl) badge.href = data.build.githubUrl;
    } catch { badge.textContent = "build: unavailable"; }
  }

  function restoreEditorContext() {
    try {
      if (!$("sourceText")?.value) $("sourceText").value = localStorage.getItem(SOURCE_KEY) || "";
      if (!$("revisedText")?.value) $("revisedText").value = localStorage.getItem(REVISED_KEY) || "";
      const params = new URLSearchParams(location.search);
      if (params.get("handoff") === "editor" && (($("sourceText")?.value || $("revisedText")?.value))) {
        const status = $("studioShellStatus");
        if (status) status.textContent = "Editor context loaded. Research & Evidence Studio is isolated from the editor runtime, but the text handoff is available here.";
      }
      if (params.get("handoff") === "source-authoring" && $("sourceText")?.value) {
        const status = $("studioShellStatus");
        if (status) status.textContent = "Source-led draft loaded for optional collaboration. The exact extracts were assembled in Source-Grounded Authoring; use this Studio only for researcher questions, explanation and evidence work.";
      }
    } catch {}
  }

  function wireEditorReturn() {
    const button = $("copyResearchDraftBtn");
    if (!button) return;
    button.textContent = "Send draft back to Editor";
    button.addEventListener("click", () => {
      const draft = $("researchDraft")?.value || "";
      if (!draft) return;
      try {
        localStorage.setItem(DRAFT_KEY, draft);
        localStorage.setItem(SOURCE_KEY, $("sourceText")?.value || "");
        localStorage.setItem(REVISED_KEY, draft);
      } catch {}
      location.href = "/editor?handoff=studio";
    });
  }

  function init() {
    restoreEditorContext();
    bindTabs();
    wireEditorReturn();
    loadStyleProfiles();
    loadMethodology();
    loadBuild();

    // researchStudioUI inserts its own tab/panel synchronously before this file.
    bindTabs();
    if (document.querySelector('.tab-header[data-tab="researchstudio"]')) setTab("researchstudio");
    else setTab("evidence");
  }

  const style = document.createElement("style");
  style.textContent = `
    .studio-shell{max-width:1500px;margin:0 auto;padding:1rem}.studio-context{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1rem 0}.studio-context-card,.studio-evidence-card{padding:1rem;border:1px solid #405269;border-radius:10px;background:rgba(22,31,44,.42)}.studio-context textarea{width:100%;box-sizing:border-box;min-height:130px}.studio-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:.7rem}.studio-filters label{display:flex;flex-direction:column;gap:.3rem}.studio-coverage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}.studio-coverage-row{display:grid;grid-template-columns:1fr auto auto;gap:.5rem;padding:.35rem 0;border-bottom:1px solid #34475e}.studio-coverage-row em{opacity:.65;font-size:.8em}.studio-shell .tabs{margin-top:1rem}@media(max-width:800px){.studio-context{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
