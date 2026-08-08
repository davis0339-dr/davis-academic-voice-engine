(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MAX_SOURCES = 8;
  const SOURCE_TEXT_CAP = 40000;
  const state = {
    argumentMap: null,
    evidenceLinks: [],
    sources: [],
    challenges: [],
    reconstructedDraft: "",
  };

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function styleFilters() {
    const mapping = {
      documentType: "document_type",
      region: "region",
      degree: "degree",
      discipline: "discipline",
      researchMode: "research_mode",
      section: "section",
    };
    const out = {};
    for (const [id, key] of Object.entries(mapping)) {
      const value = $(id)?.value;
      if (value) out[key] = value;
    }
    return out;
  }

  function setStudioStatus(message, kind = "") {
    const el = $("researchStudioStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `status-message ${kind}`.trim();
  }

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
    return data;
  }

  function insertStudioTab() {
    const headers = document.querySelector(".tab-headers");
    const tabs = document.querySelector(".tabs");
    if (!headers || !tabs || $("tab-researchstudio")) return;

    const detectorButton = headers.querySelector('[data-tab="detectorqa"]');
    const button = document.createElement("button");
    button.className = "tab-header";
    button.dataset.tab = "researchstudio";
    button.textContent = "Researcher Studio";
    if (detectorButton) headers.insertBefore(button, detectorButton);
    else headers.appendChild(button);

    const panel = document.createElement("div");
    panel.id = "tab-researchstudio";
    panel.className = "tab-panel";
    panel.innerHTML = `
      <section class="research-studio-intro">
        <h3>Researcher Reasoning Studio</h3>
        <p>This workspace develops the researcher's intellectual position before polishing language. Explain the idea naturally; the system separates claims, mechanisms, qualifications, assumptions, interpretations, boundaries and evidence needs. Nothing here is treated as proof of authorship.</p>
        <p class="muted">Current beta: text/Word/text-based PDF sources, up to ${MAX_SOURCES} evidence files. Source text is analysed per request and is not persisted by the Researcher Studio API.</p>
      </section>

      <div class="research-studio-grid">
        <section class="research-studio-card">
          <h4>1. Explain what you really mean</h4>
          <textarea id="researcherThoughts" rows="8" placeholder="Speak in your own intellectual voice here. Rough notes are fine. Explain what you think, what bothers you about the literature, why a relationship should exist, what you do not want to claim, or what conclusion you are leaning toward."></textarea>
          <label class="research-check"><input id="includeEditorContext" type="checkbox" checked /> Use the current Source editor text as manuscript context</label>
          <div class="action-row">
            <button id="buildArgumentMapBtn" class="primary" type="button">Build Argument Map</button>
            <button id="clearResearchStudioBtn" type="button">Clear Studio</button>
          </div>
        </section>

        <section class="research-studio-card">
          <h4>2. Researcher-approved argument map</h4>
          <p class="muted">Edit statements directly. Accept, modify or reject each intellectual move before reconstruction.</p>
          <div id="argumentMapSummary"></div>
          <div id="argumentMapNodes"><p class="muted">Build an argument map first.</p></div>
        </section>
      </div>

      <section class="research-studio-card">
        <h4>3. Evidence Workspace</h4>
        <div class="file-toolbar">
          <label class="file-button" for="researchEvidenceFiles">Add source materials</label>
          <input id="researchEvidenceFiles" class="visually-hidden" type="file" multiple accept=".txt,.md,.markdown,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
          <span id="researchEvidenceStatus" class="file-status">Add up to ${MAX_SOURCES} TXT, DOCX or text-based PDF sources.</span>
        </div>
        <div id="researchSourceList" class="research-source-list"><p class="muted">No evidence sources added.</p></div>
        <div class="action-row">
          <button id="alignEvidenceBtn" type="button">Align Evidence to Argument</button>
          <button id="challengeArgumentBtn" type="button">Challenge My Reasoning</button>
        </div>
        <div id="evidenceAlignmentResults"></div>
        <div id="researchChallengeResults"></div>
      </section>

      <section class="research-studio-card">
        <h4>4. Controlled academic reconstruction</h4>
        <label>Additional constraints (optional)
          <textarea id="researchReconstructConstraints" rows="3" placeholder="e.g. Keep proposal tense; do not introduce a moderator; preserve the negative expected relationship."></textarea>
        </label>
        <div class="action-row">
          <button id="reconstructResearchBtn" class="primary" type="button">Build Academic Version</button>
          <button id="copyResearchDraftBtn" type="button">Copy to Revised Editor</button>
        </div>
        <textarea id="researchDraft" rows="10" readonly placeholder="The controlled academic reconstruction will appear here."></textarea>
        <div id="researchDraftMeta"></div>
      </section>

      <section class="research-studio-card">
        <h4>5. Argument Integrity Check</h4>
        <p class="muted">Use this after another LLM, editor or supervisor changes the prose. The check compares intellectual content against your approved argument map, not against wording.</p>
        <textarea id="integrityCandidate" rows="7" placeholder="Paste the later polished/reworked version here, or use the current Revised editor text."></textarea>
        <div class="action-row">
          <button id="useRevisedForIntegrityBtn" type="button">Use Current Revised Text</button>
          <button id="runIntegrityBtn" type="button">Check Argument Integrity</button>
        </div>
        <div id="integrityResults"></div>
      </section>

      <div id="researchStudioStatus" class="status-message" aria-live="polite"></div>
    `;

    const detectorPanel = $("tab-detectorqa");
    if (detectorPanel) tabs.insertBefore(panel, detectorPanel);
    else tabs.appendChild(panel);

    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-header").forEach((el) => el.classList.toggle("active", el === button));
      document.querySelectorAll(".tab-panel").forEach((el) => el.classList.toggle("active", el === panel));
    });
  }

  function hardenDetectorUi() {
    const sourceScan = $("scanSourceBtn");
    const revisedScan = $("scanRevisedBtn");
    for (const button of [sourceScan, revisedScan]) {
      if (!button) continue;
      button.disabled = true;
      button.hidden = true;
    }
    const disclaimer = document.querySelector(".detector-disclaimer");
    if (disclaimer) {
      disclaimer.textContent = "Writing-pattern research only. Live third-party detector integrations are disabled by design. You may independently test elsewhere and record the result manually; this application does not send your manuscript to detector vendors.";
    }
  }

  function syncArgumentMapFromDom() {
    if (!state.argumentMap) return null;
    state.argumentMap.nodes = state.argumentMap.nodes.map((node) => {
      const statement = $(`arg-statement-${node.id}`)?.value ?? node.statement;
      const type = $(`arg-type-${node.id}`)?.value ?? node.type;
      const researcher_status = $(`arg-status-${node.id}`)?.value ?? node.researcher_status;
      return { ...node, statement: String(statement).trim(), type, researcher_status };
    }).filter((node) => node.statement);
    return state.argumentMap;
  }

  function renderArgumentMap() {
    const summary = $("argumentMapSummary");
    const target = $("argumentMapNodes");
    if (!summary || !target) return;
    if (!state.argumentMap) {
      summary.innerHTML = "";
      target.innerHTML = '<p class="muted">Build an argument map first.</p>';
      return;
    }

    summary.innerHTML = `
      <div class="research-summary-callout"><strong>Your apparent position:</strong> ${esc(state.argumentMap.researcher_summary || "")}</div>
      ${state.argumentMap.boundaries?.length ? `<p><strong>Boundaries:</strong> ${state.argumentMap.boundaries.map(esc).join(" · ")}</p>` : ""}
      ${state.argumentMap.researcher_decisions?.length ? `<p><strong>Decisions already visible:</strong> ${state.argumentMap.researcher_decisions.map(esc).join(" · ")}</p>` : ""}
      ${state.argumentMap.unresolved_questions?.length ? `<details><summary>Unresolved questions</summary><ul>${state.argumentMap.unresolved_questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></details>` : ""}
    `;

    const typeOptions = ["claim", "mechanism", "qualification", "assumption", "counterargument", "interpretation", "implication", "boundary", "evidence_need", "methodological_choice"];
    target.innerHTML = state.argumentMap.nodes.map((node, index) => `
      <article class="argument-node">
        <div class="argument-node-head">
          <strong>${esc(node.id)}</strong>
          <span class="agency-origin">${esc(node.origin)}</span>
          <span class="muted">confidence: ${esc(node.confidence)}</span>
        </div>
        <textarea id="arg-statement-${esc(node.id)}" rows="3">${esc(node.statement)}</textarea>
        <div class="argument-node-controls">
          <label>Function
            <select id="arg-type-${esc(node.id)}">${typeOptions.map((type) => `<option value="${type}" ${node.type === type ? "selected" : ""}>${type.replace(/_/g, " ")}</option>`).join("")}</select>
          </label>
          <label>Your decision
            <select id="arg-status-${esc(node.id)}">
              <option value="unreviewed" ${node.researcher_status === "unreviewed" ? "selected" : ""}>Unreviewed</option>
              <option value="accepted" ${node.researcher_status === "accepted" ? "selected" : ""}>Accept</option>
              <option value="modified" ${node.researcher_status === "modified" ? "selected" : ""}>Modified by me</option>
              <option value="rejected" ${node.researcher_status === "rejected" ? "selected" : ""}>Reject</option>
            </select>
          </label>
        </div>
        ${node.evidence_need ? `<p class="muted"><strong>Evidence need:</strong> ${esc(node.evidence_need)}</p>` : ""}
        ${node.rationale ? `<p class="muted"><strong>Why it matters:</strong> ${esc(node.rationale)}</p>` : ""}
      </article>
    `).join("");
  }

  async function buildArgumentMap() {
    const thoughts = $("researcherThoughts")?.value.trim() || "";
    if (!thoughts) return setStudioStatus("Explain your thinking first. Rough language is fine.", "error");
    setStudioStatus("Recovering the reasoning structure…");
    try {
      const data = await postJson("/api/research/reasoning-map", {
        thoughts,
        manuscriptContext: $("includeEditorContext")?.checked ? ($("sourceText")?.value || "") : "",
        styleFilters: styleFilters(),
      });
      state.argumentMap = data.argumentMap;
      state.evidenceLinks = [];
      renderArgumentMap();
      renderEvidenceLinks();
      setStudioStatus(`Argument map built with ${state.argumentMap.nodes.length} intellectual moves. Review them before reconstruction.`);
    } catch (err) {
      setStudioStatus(`Could not build argument map: ${err.message}`, "error");
    }
  }

  async function importEvidenceFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const remaining = Math.max(0, MAX_SOURCES - state.sources.length);
    if (!remaining) return setStudioStatus(`Evidence Workspace already contains the ${MAX_SOURCES}-source beta limit.`, "error");
    const chosen = files.slice(0, remaining);
    const status = $("researchEvidenceStatus");
    for (const file of chosen) {
      if (status) status.textContent = `Reading ${file.name}…`;
      try {
        const result = await window.AcademicFileImport.readAcademicFile(file, 5 * 1024 * 1024);
        const text = String(result.text || "").slice(0, SOURCE_TEXT_CAP);
        if (!text) throw new Error("No readable text found.");
        state.sources.push({
          id: `source-${Date.now()}-${state.sources.length + 1}`,
          title: file.name,
          citation: "",
          text,
          truncated: String(result.text || "").length > SOURCE_TEXT_CAP,
        });
      } catch (err) {
        setStudioStatus(`${file.name}: ${err.message}`, "error");
      }
    }
    if (status) status.textContent = `${state.sources.length}/${MAX_SOURCES} source(s) loaded. Add citation labels below when available.`;
    renderSourceList();
  }

  function renderSourceList() {
    const target = $("researchSourceList");
    if (!target) return;
    if (!state.sources.length) {
      target.innerHTML = '<p class="muted">No evidence sources added.</p>';
      return;
    }
    target.innerHTML = state.sources.map((source, index) => `
      <article class="research-source-card">
        <div><strong>${esc(source.title)}</strong>${source.truncated ? ' <span class="bad-badge">analysis excerpt capped</span>' : ""}</div>
        <label>Citation label used in reconstruction (optional)
          <input data-source-citation="${index}" type="text" maxlength="500" value="${esc(source.citation)}" placeholder="e.g. Anderson et al. (2004)" />
        </label>
        <div class="muted">${source.text.length.toLocaleString()} characters available to this beta workspace.</div>
        <button data-remove-source="${index}" type="button">Remove</button>
      </article>
    `).join("");
    target.querySelectorAll("[data-source-citation]").forEach((input) => {
      input.addEventListener("input", () => {
        const index = Number(input.dataset.sourceCitation);
        if (state.sources[index]) state.sources[index].citation = input.value.trim();
      });
    });
    target.querySelectorAll("[data-remove-source]").forEach((button) => {
      button.addEventListener("click", () => {
        state.sources.splice(Number(button.dataset.removeSource), 1);
        state.evidenceLinks = [];
        renderSourceList();
        renderEvidenceLinks();
      });
    });
  }

  async function alignEvidence() {
    syncArgumentMapFromDom();
    if (!state.argumentMap?.nodes?.length) return setStudioStatus("Build and review the argument map first.", "error");
    if (!state.sources.length) return setStudioStatus("Add at least one source before evidence alignment.", "error");
    setStudioStatus("Retrieving and evaluating relevant source passages…");
    try {
      const data = await postJson("/api/research/evidence-align", { argumentMap: state.argumentMap, sources: state.sources });
      state.evidenceLinks = data.links || [];
      renderEvidenceLinks();
      setStudioStatus(`Evidence alignment complete: ${state.evidenceLinks.length} passage-to-argument link(s). ${data.mode === "lexical_retrieval_only" ? "Interpretive classification is unavailable until the LLM is configured." : ""}`);
    } catch (err) {
      setStudioStatus(`Evidence alignment failed: ${err.message}`, "error");
    }
  }

  function renderEvidenceLinks() {
    const target = $("evidenceAlignmentResults");
    if (!target) return;
    if (!state.evidenceLinks.length) {
      target.innerHTML = '<p class="muted">No evidence links yet.</p>';
      return;
    }
    const grouped = new Map();
    for (const link of state.evidenceLinks) {
      if (!grouped.has(link.argument_id)) grouped.set(link.argument_id, []);
      grouped.get(link.argument_id).push(link);
    }
    target.innerHTML = `<h4>Evidence relationships</h4>${[...grouped.entries()].map(([argumentId, links]) => `
      <details open class="evidence-argument-group">
        <summary><strong>${esc(argumentId)}</strong> · ${links.length} passage(s)</summary>
        ${links.map((link, index) => `
          <article class="evidence-link ${esc(link.relationship)}">
            <div><strong>${esc(link.relationship)}</strong> · ${esc(link.source_title || link.source_id)} · ${esc(link.locator || "")}</div>
            ${link.citation ? `<div class="muted">Citation label: ${esc(link.citation)}</div>` : ""}
            <p>${esc(link.explanation || "")}</p>
            <details><summary>Source excerpt</summary><p>${esc(link.excerpt || "")}</p></details>
            <label>Your decision
              <select data-evidence-status="${esc(link.id)}">
                <option value="unreviewed" ${link.researcher_status === "unreviewed" ? "selected" : ""}>Unreviewed</option>
                <option value="accepted" ${link.researcher_status === "accepted" ? "selected" : ""}>Accept link</option>
                <option value="modified" ${link.researcher_status === "modified" ? "selected" : ""}>Accept with my interpretation</option>
                <option value="rejected" ${link.researcher_status === "rejected" ? "selected" : ""}>Reject link</option>
              </select>
            </label>
          </article>
        `).join("")}
      </details>
    `).join("")}`;
    target.querySelectorAll("[data-evidence-status]").forEach((select) => {
      select.addEventListener("change", () => {
        const link = state.evidenceLinks.find((item) => item.id === select.dataset.evidenceStatus);
        if (link) link.researcher_status = select.value;
      });
    });
  }

  async function challengeArgument() {
    syncArgumentMapFromDom();
    if (!state.argumentMap?.nodes?.length) return setStudioStatus("Build the argument map before challenge mode.", "error");
    setStudioStatus("Testing the argument for the highest-value unresolved issues…");
    try {
      const data = await postJson("/api/research/challenge", {
        argumentMap: state.argumentMap,
        evidenceLinks: state.evidenceLinks,
        researchContext: $("sourceText")?.value || "",
      });
      state.challenges = data.questions || [];
      const target = $("researchChallengeResults");
      if (!state.challenges.length) {
        target.innerHTML = '<p class="muted">No high-value challenge question was generated from the current map.</p>';
      } else {
        target.innerHTML = `<h4>Challenge questions</h4>${state.challenges.map((q) => `
          <article class="challenge-card">
            <strong>${esc(q.question)}</strong>
            <p>${esc(q.why_it_matters || "")}</p>
            ${q.evidence_gap ? `<p class="muted">Evidence issue: ${esc(q.evidence_gap)}</p>` : ""}
            <textarea data-challenge-answer="${esc(q.argument_id)}" rows="3" placeholder="Answer in your own words. Use this answer to revise the relevant argument node above."></textarea>
          </article>
        `).join("")}`;
      }
      setStudioStatus("Challenge mode complete. The questions are prompts for researcher judgment, not automatic changes.");
    } catch (err) {
      setStudioStatus(`Challenge mode failed: ${err.message}`, "error");
    }
  }

  async function reconstruct() {
    syncArgumentMapFromDom();
    if (!state.argumentMap?.nodes?.length) return setStudioStatus("Build and review the argument map first.", "error");
    setStudioStatus("Reconstructing academic prose under the approved argument constraints…");
    try {
      const data = await postJson("/api/research/reconstruct", {
        argumentMap: state.argumentMap,
        evidenceLinks: state.evidenceLinks,
        styleFilters: styleFilters(),
        section: $("section")?.value || "",
        constraints: $("researchReconstructConstraints")?.value || "",
      });
      state.reconstructedDraft = data.draft || "";
      $("researchDraft").value = state.reconstructedDraft;
      $("researchDraftMeta").innerHTML = `
        ${data.agency_note ? `<p><strong>Agency note:</strong> ${esc(data.agency_note)}</p>` : ""}
        ${data.warnings?.length ? `<div class="warning-item bad"><strong>Warnings:</strong> ${data.warnings.map(esc).join(" · ")}</div>` : ""}
        <p class="muted">Argument nodes used: ${(data.used_argument_ids || []).map(esc).join(", ") || "not reported"} · Evidence links used: ${(data.used_evidence_ids || []).map(esc).join(", ") || "none reported"}</p>`;
      setStudioStatus("Controlled reconstruction complete. Review the prose; the argument map remains the governing record.");
    } catch (err) {
      setStudioStatus(`Reconstruction failed: ${err.message}`, "error");
    }
  }

  function copyDraftToRevised() {
    const draft = $("researchDraft")?.value || "";
    if (!draft) return setStudioStatus("There is no Researcher Studio draft to copy yet.", "error");
    const revised = $("revisedText");
    if (revised) {
      revised.value = draft;
      revised.dispatchEvent(new Event("input", { bubbles: true }));
      setStudioStatus("Researcher Studio draft copied to the Revised editor for further review/testing.");
    }
  }

  async function runIntegrity() {
    syncArgumentMapFromDom();
    const candidateText = $("integrityCandidate")?.value.trim() || "";
    if (!state.argumentMap?.nodes?.length) return setStudioStatus("An approved argument map is required for integrity checking.", "error");
    if (!candidateText) return setStudioStatus("Paste or load a later polished version first.", "error");
    setStudioStatus("Comparing intellectual content against the approved argument map…");
    try {
      const data = await postJson("/api/research/integrity", { argumentMap: state.argumentMap, candidateText });
      const target = $("integrityResults");
      target.innerHTML = `
        <div class="integrity-overall ${esc(data.overall || "")}"><strong>Overall: ${esc(data.overall || "unreported")}</strong> — ${esc(data.summary || "")}</div>
        <div class="integrity-grid">
          ${(data.node_results || []).map((row) => `<div class="integrity-node"><strong>${esc(row.argument_id)} · ${esc(row.status)}</strong><span>${esc(row.explanation || "")}</span></div>`).join("")}
        </div>
        ${(data.new_claims || []).length ? `<h5>New/unlicensed claims</h5><ul>${data.new_claims.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${(data.lost_boundaries || []).length ? `<h5>Lost boundaries</h5><ul>${data.lost_boundaries.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${(data.epistemic_drift || []).length ? `<h5>Epistemic drift</h5><ul>${data.epistemic_drift.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
      setStudioStatus(`Argument Integrity Check complete: ${data.overall || "result available"}.`);
    } catch (err) {
      setStudioStatus(`Integrity check failed: ${err.message}`, "error");
    }
  }

  function clearStudio() {
    state.argumentMap = null;
    state.evidenceLinks = [];
    state.sources = [];
    state.challenges = [];
    state.reconstructedDraft = "";
    if ($("researcherThoughts")) $("researcherThoughts").value = "";
    if ($("researchDraft")) $("researchDraft").value = "";
    if ($("integrityCandidate")) $("integrityCandidate").value = "";
    renderArgumentMap();
    renderSourceList();
    renderEvidenceLinks();
    if ($("researchChallengeResults")) $("researchChallengeResults").innerHTML = "";
    if ($("researchDraftMeta")) $("researchDraftMeta").innerHTML = "";
    if ($("integrityResults")) $("integrityResults").innerHTML = "";
    setStudioStatus("Researcher Studio cleared. Existing Source/Revised editor text was left untouched.");
  }

  function bindEvents() {
    $("buildArgumentMapBtn")?.addEventListener("click", buildArgumentMap);
    $("clearResearchStudioBtn")?.addEventListener("click", clearStudio);
    $("researchEvidenceFiles")?.addEventListener("change", importEvidenceFiles);
    $("alignEvidenceBtn")?.addEventListener("click", alignEvidence);
    $("challengeArgumentBtn")?.addEventListener("click", challengeArgument);
    $("reconstructResearchBtn")?.addEventListener("click", reconstruct);
    $("copyResearchDraftBtn")?.addEventListener("click", copyDraftToRevised);
    $("useRevisedForIntegrityBtn")?.addEventListener("click", () => {
      if ($("integrityCandidate")) $("integrityCandidate").value = $("revisedText")?.value || "";
    });
    $("runIntegrityBtn")?.addEventListener("click", runIntegrity);
  }

  const style = document.createElement("style");
  style.textContent = `
    .research-studio-intro{margin-bottom:1rem;padding:1rem;border:1px solid #dfe4ea;border-radius:12px;background:#fafbfc}
    .research-studio-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1rem}
    .research-studio-card{margin:1rem 0;padding:1rem;border:1px solid #dfe4ea;border-radius:12px;background:#fff}
    .research-studio-card textarea,.research-studio-card input,.research-studio-card select{width:100%;box-sizing:border-box}
    .research-check{display:flex;gap:.5rem;align-items:center;margin:.6rem 0}.research-check input{width:auto}
    .research-summary-callout{padding:.8rem;border-left:4px solid currentColor;background:#f6f7f9;margin:.6rem 0}
    .argument-node{border-top:1px solid #e6e9ed;padding:.8rem 0}.argument-node:first-child{border-top:0}
    .argument-node-head{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem}
    .agency-origin{font-size:.78rem;border:1px solid #ccd2d9;border-radius:999px;padding:.15rem .45rem}
    .argument-node-controls{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:.5rem}
    .research-source-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.75rem;margin:.8rem 0}
    .research-source-card{border:1px solid #e1e5ea;border-radius:10px;padding:.75rem}
    .research-source-card button{margin-top:.5rem}
    .evidence-argument-group{margin:.65rem 0}.evidence-link{padding:.7rem;margin:.5rem 0;border-left:4px solid #aab2bd;background:#fafbfc}.evidence-link.supports{border-left-style:solid}.evidence-link.contradicts{border-left-style:double}.evidence-link.insufficient{opacity:.8}
    .challenge-card{padding:.8rem;margin:.6rem 0;border:1px solid #e1e5ea;border-radius:10px}
    .integrity-grid{display:grid;gap:.5rem;margin-top:.7rem}.integrity-node{display:grid;gap:.2rem;padding:.6rem;border:1px solid #e1e5ea;border-radius:8px}
    .integrity-overall{padding:.8rem;border-radius:8px;background:#f6f7f9}.integrity-overall.material_drift{font-weight:600}
    @media(max-width:800px){.research-studio-grid,.argument-node-controls{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  insertStudioTab();
  hardenDetectorUi();
  bindEvents();
  renderArgumentMap();
  renderSourceList();
  renderEvidenceLinks();
})();
