(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MAX_BANK_BYTES = 25 * 1024 * 1024;
  const MAX_BANK_ROWS = 10000;
  const TRANSFER_LIMIT = 8;
  const state = {
    fileName: "",
    sheetName: "",
    headers: [],
    records: [],
    filtered: [],
    selected: new Set(),
    mapping: {},
  };

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function norm(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function splitSpreadsheetText(text) {
    const sections = String(text || "").split(/(?=\[Sheet:\s*[^\]]+\]\n)/g).filter(Boolean);
    const parsed = [];
    for (const section of sections) {
      const match = section.match(/^\[Sheet:\s*([^\]]+)\]\n([\s\S]*)$/);
      if (!match) continue;
      const sheetName = match[1].trim();
      const lines = match[2].split("\n").filter((line) => line.trim());
      if (!lines.length) continue;
      const headers = lines[0].split("\t").map((cell, i) => cell.trim() || `Column ${i + 1}`);
      const records = lines.slice(1).map((line, rowIndex) => {
        const cells = line.split("\t");
        const values = {};
        headers.forEach((header, i) => { values[header] = String(cells[i] || "").trim(); });
        return { id: `${sheetName}-${rowIndex + 2}`, rowNumber: rowIndex + 2, values };
      });
      parsed.push({ sheetName, headers, records });
    }
    return parsed;
  }

  const fieldPatterns = {
    title: [/^title$/, /article title/, /paper title/, /study title/, /publication title/],
    authors: [/authors?/, /author names?/, /researchers?/],
    year: [/^year$/, /publication year/, /date published/, /publication date/],
    abstract: [/abstract/, /summary/, /study abstract/],
    journal: [/journal/, /source title/, /publication name/],
    volume: [/^volume$/, /^vol$/],
    issue: [/^issue$/, /^no$/, /number/],
    pages: [/pages?/, /page range/],
    doi: [/doi/],
    url: [/url/, /link/, /web address/],
    country: [/country/, /setting/, /location/],
    methodology: [/methodology/, /^method$/, /research design/, /analysis method/],
    findings: [/findings?/, /results?/, /key findings/],
  };

  function autoMap(headers) {
    const mapping = {};
    for (const [field, patterns] of Object.entries(fieldPatterns)) {
      mapping[field] = headers.find((header) => patterns.some((pattern) => pattern.test(norm(header)))) || "";
    }
    return mapping;
  }

  function mapped(record, field) {
    const header = state.mapping[field];
    return header ? String(record?.values?.[header] || "").trim() : "";
  }

  function firstAuthorLabel(authors) {
    const raw = String(authors || "").trim();
    if (!raw) return "";
    const first = raw.split(/;|\band\b|\s&\s|\|/i)[0].trim();
    const surname = first.includes(",") ? first.split(",")[0].trim() : first.split(/\s+/).slice(-1)[0];
    return surname || first;
  }

  function inTextCitation(record) {
    const authors = mapped(record, "authors");
    const year = mapped(record, "year").match(/(?:18|19|20)\d{2}/)?.[0] || mapped(record, "year");
    const first = firstAuthorLabel(authors);
    if (first && year) return `${first} et al. (${year})`;
    if (first) return first;
    if (year) return `(${year})`;
    return "";
  }

  function apaCandidate(record) {
    const authors = mapped(record, "authors");
    const year = mapped(record, "year").match(/(?:18|19|20)\d{2}/)?.[0] || mapped(record, "year");
    const title = mapped(record, "title");
    const journal = mapped(record, "journal");
    const volume = mapped(record, "volume");
    const issue = mapped(record, "issue");
    const pages = mapped(record, "pages");
    const doi = mapped(record, "doi");
    const url = mapped(record, "url");
    const parts = [];
    if (authors) parts.push(authors.replace(/[.\s]+$/, "") + ".");
    if (year) parts.push(`(${year}).`);
    if (title) parts.push(title.replace(/[.\s]+$/, "") + ".");
    if (journal) {
      let source = journal;
      if (volume) source += `, ${volume}`;
      if (issue) source += `(${issue})`;
      if (pages) source += `, ${pages}`;
      parts.push(source.replace(/[.\s]+$/, "") + ".");
    }
    if (doi) parts.push(/^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi.replace(/^doi:\s*/i, "")}`);
    else if (url) parts.push(url);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function recordText(record) {
    const ordered = ["title", "authors", "year", "journal", "country", "methodology", "findings", "abstract", "doi", "url"];
    const lines = [];
    for (const field of ordered) {
      const value = mapped(record, field);
      if (value) lines.push(`${field.replace(/_/g, " ").toUpperCase()}: ${value}`);
    }
    const mappedHeaders = new Set(Object.values(state.mapping).filter(Boolean));
    for (const header of state.headers) {
      if (mappedHeaders.has(header)) continue;
      const value = String(record.values[header] || "").trim();
      if (value) lines.push(`${header}: ${value}`);
    }
    const apa = apaCandidate(record);
    if (apa) lines.unshift(`APA 7 REFERENCE CANDIDATE: ${apa}`);
    return lines.join("\n");
  }

  function install() {
    const studio = $("tab-researchstudio");
    const evidenceWorkspace = $("researchEvidenceFiles")?.closest("section.research-studio-card");
    if (!studio || !evidenceWorkspace || $("literatureEvidenceBank")) return false;

    const card = document.createElement("section");
    card.id = "literatureEvidenceBank";
    card.className = "research-studio-card evidence-bank-card";
    card.innerHTML = `
      <div class="evidence-bank-head">
        <div>
          <h4>Independent Literature Evidence Bank</h4>
          <p class="muted">Upload a large CSV/XLSX literature summary independently of the eight-source alignment workspace. The workbook stays in this browser session. Search thousands of abstract/metadata rows, then send only the most relevant records into Evidence Alignment.</p>
        </div>
        <span class="evidence-bank-badge">Excel/CSV · local index</span>
      </div>
      <div class="file-toolbar">
        <label class="file-button" for="literatureBankFile">Upload literature bank</label>
        <input id="literatureBankFile" class="visually-hidden" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" />
        <span id="literatureBankStatus" class="file-status">No workbook loaded. Up to 25 MB / ${MAX_BANK_ROWS.toLocaleString()} rows in this build.</span>
      </div>
      <div id="literatureBankMapping"></div>
      <div id="literatureBankTools" hidden>
        <div class="evidence-bank-search-row">
          <input id="literatureBankSearch" type="search" placeholder="Search title, abstract, authors, methods, findings, country, DOI…" />
          <button id="literatureBankSearchBtn" type="button">Search bank</button>
          <button id="literatureBankUseReasoningBtn" type="button">Find evidence for current reasoning</button>
          <button id="literatureBankClearSearchBtn" type="button">Reset</button>
        </div>
        <div class="action-row">
          <button id="literatureBankTransferBtn" class="primary" type="button">Send selected to Evidence Workspace</button>
          <button id="literatureBankSelectTopBtn" type="button">Select top results</button>
          <span id="literatureBankSelectionStatus" class="file-status">0 selected</span>
        </div>
        <div id="literatureBankResults"></div>
      </div>`;
    evidenceWorkspace.parentNode.insertBefore(card, evidenceWorkspace);

    $("literatureBankFile")?.addEventListener("change", loadBank);
    $("literatureBankSearchBtn")?.addEventListener("click", runSearch);
    $("literatureBankSearch")?.addEventListener("keydown", (event) => { if (event.key === "Enter") runSearch(); });
    $("literatureBankUseReasoningBtn")?.addEventListener("click", searchFromReasoning);
    $("literatureBankClearSearchBtn")?.addEventListener("click", resetSearch);
    $("literatureBankSelectTopBtn")?.addEventListener("click", selectTop);
    $("literatureBankTransferBtn")?.addEventListener("click", transferSelected);
    return true;
  }

  async function loadBank(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const status = $("literatureBankStatus");
    if (!file) return;
    if (status) status.textContent = `Reading ${file.name}…`;
    try {
      const result = await window.AcademicFileImport.readAcademicFile(file, MAX_BANK_BYTES);
      const sheets = splitSpreadsheetText(result.text || "");
      if (!sheets.length) throw new Error("No worksheet rows could be parsed.");
      const sheet = sheets.reduce((best, current) => current.records.length > best.records.length ? current : best, sheets[0]);
      state.fileName = file.name;
      state.sheetName = sheet.sheetName;
      state.headers = sheet.headers;
      state.records = sheet.records.slice(0, MAX_BANK_ROWS);
      state.filtered = state.records.slice(0, 50);
      state.selected.clear();
      state.mapping = autoMap(state.headers);
      renderMapping();
      renderResults();
      if ($("literatureBankTools")) $("literatureBankTools").hidden = false;
      if (status) status.textContent = `${file.name} · ${state.records.length.toLocaleString()} indexed record(s) from sheet “${state.sheetName}”. Nothing has been sent to the server.`;
    } catch (err) {
      if (status) status.textContent = `Could not load literature bank: ${err.message}`;
    }
  }

  function renderMapping() {
    const target = $("literatureBankMapping");
    if (!target) return;
    const fields = ["title", "authors", "year", "abstract", "journal", "volume", "issue", "pages", "doi", "url", "country", "methodology", "findings"];
    target.innerHTML = `
      <details open class="evidence-bank-mapping">
        <summary><strong>Column mapping</strong> · review the automatic matches so APA/retrieval fields are interpreted correctly</summary>
        <div class="evidence-bank-map-grid">
          ${fields.map((field) => `<label>${esc(field.replace(/_/g, " "))}<select data-bank-map="${esc(field)}"><option value="">Not mapped</option>${state.headers.map((header) => `<option value="${esc(header)}" ${state.mapping[field] === header ? "selected" : ""}>${esc(header)}</option>`).join("")}</select></label>`).join("")}
        </div>
      </details>`;
    target.querySelectorAll("[data-bank-map]").forEach((select) => {
      select.addEventListener("change", () => {
        state.mapping[select.dataset.bankMap] = select.value;
        renderResults();
      });
    });
  }

  function searchableText(record) {
    return Object.values(record.values || {}).join(" ").toLowerCase();
  }

  function tokens(text) {
    return [...new Set(String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [])]
      .filter((token) => !["the","and","for","with","from","this","that","were","was","are","have","has","study","research","using","among","into","their"].includes(token));
  }

  function scoreRecord(record, queryTokens) {
    if (!queryTokens.length) return 0;
    const hay = searchableText(record);
    let score = 0;
    for (const token of queryTokens) {
      if (hay.includes(token)) score += 1;
      if (mapped(record, "title").toLowerCase().includes(token)) score += 2;
      if (mapped(record, "findings").toLowerCase().includes(token)) score += 1.2;
      if (mapped(record, "abstract").toLowerCase().includes(token)) score += 0.8;
    }
    return score;
  }

  function search(query) {
    const queryTokens = tokens(query);
    if (!queryTokens.length) return state.records.slice(0, 50);
    return state.records
      .map((record) => ({ record, score: scoreRecord(record, queryTokens) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.record.rowNumber - b.record.rowNumber)
      .slice(0, 100)
      .map((row) => ({ ...row.record, relevanceScore: Number(row.score.toFixed(1)) }));
  }

  function runSearch() {
    state.filtered = search($("literatureBankSearch")?.value || "");
    renderResults();
  }

  function searchFromReasoning() {
    const query = [$("researcherThoughts")?.value || "", $("sourceText")?.value || ""].join(" ").slice(0, 12000);
    if (!query.trim()) {
      if ($("literatureBankSelectionStatus")) $("literatureBankSelectionStatus").textContent = "Add reasoning/manuscript context first.";
      return;
    }
    state.filtered = search(query);
    renderResults();
  }

  function resetSearch() {
    if ($("literatureBankSearch")) $("literatureBankSearch").value = "";
    state.filtered = state.records.slice(0, 50);
    renderResults();
  }

  function renderResults() {
    const target = $("literatureBankResults");
    if (!target) return;
    if (!state.records.length) {
      target.innerHTML = "";
      return;
    }
    const rows = state.filtered.slice(0, 50);
    target.innerHTML = `
      <div class="evidence-bank-result-head"><strong>${rows.length.toLocaleString()} displayed</strong><span>${state.records.length.toLocaleString()} total indexed</span></div>
      <div class="evidence-bank-results">
        ${rows.map((record) => {
          const title = mapped(record, "title") || `Row ${record.rowNumber}`;
          const authors = mapped(record, "authors");
          const year = mapped(record, "year");
          const abstract = mapped(record, "abstract") || mapped(record, "findings") || recordText(record);
          const apa = apaCandidate(record);
          return `<article class="evidence-bank-record">
            <label class="evidence-bank-select"><input type="checkbox" data-bank-select="${esc(record.id)}" ${state.selected.has(record.id) ? "checked" : ""} /> <strong>${esc(title)}</strong></label>
            <div class="muted">${esc([authors, year].filter(Boolean).join(" · "))}${Number.isFinite(record.relevanceScore) ? ` · relevance ${esc(record.relevanceScore)}` : ""}</div>
            <p>${esc(abstract.slice(0, 650))}${abstract.length > 650 ? "…" : ""}</p>
            ${apa ? `<details><summary>APA 7 reference candidate</summary><p>${esc(apa)}</p></details>` : ""}
          </article>`;
        }).join("")}
      </div>`;
    target.querySelectorAll("[data-bank-select]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) state.selected.add(input.dataset.bankSelect);
        else state.selected.delete(input.dataset.bankSelect);
        updateSelectionStatus();
      });
    });
    updateSelectionStatus();
  }

  function updateSelectionStatus(message = "") {
    const status = $("literatureBankSelectionStatus");
    if (!status) return;
    status.textContent = message || `${state.selected.size} selected · up to ${TRANSFER_LIMIT} can be transferred at once`;
  }

  function selectTop() {
    state.selected.clear();
    state.filtered.slice(0, TRANSFER_LIMIT).forEach((record) => state.selected.add(record.id));
    renderResults();
  }

  async function waitForImportedCards(expected, timeoutMs = 3500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const inputs = [...document.querySelectorAll("#researchSourceList [data-source-citation]")];
      if (inputs.length >= expected) return inputs;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return [...document.querySelectorAll("#researchSourceList [data-source-citation]")];
  }

  async function transferSelected() {
    const selected = [...state.selected]
      .map((id) => state.records.find((record) => record.id === id))
      .filter(Boolean)
      .slice(0, TRANSFER_LIMIT);
    const input = $("researchEvidenceFiles");
    if (!selected.length || !input) {
      updateSelectionStatus("Select at least one literature record first.");
      return;
    }
    const existing = document.querySelectorAll("#researchSourceList .research-source-card").length;
    const remaining = Math.max(0, TRANSFER_LIMIT - existing);
    if (!remaining) {
      updateSelectionStatus("Evidence Workspace already contains eight active sources. Remove some before transferring more records.");
      return;
    }
    const chosen = selected.slice(0, remaining);
    const dt = new DataTransfer();
    chosen.forEach((record, index) => {
      const safeTitle = (mapped(record, "title") || `literature-row-${record.rowNumber}`).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80);
      dt.items.add(new File([recordText(record)], `${safeTitle || `source-${index + 1}`}.txt`, { type: "text/plain" }));
    });
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const inputs = await waitForImportedCards(existing + chosen.length);
    chosen.forEach((record, index) => {
      const citationInput = inputs[existing + index];
      if (!citationInput) return;
      citationInput.value = inTextCitation(record);
      citationInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    state.selected.clear();
    renderResults();
    updateSelectionStatus(`${chosen.length} literature record(s) transferred with citation labels. Align them when your argument map is ready.`);
  }

  const style = document.createElement("style");
  style.textContent = `
    .evidence-bank-card{border-color:#4e6b85!important}.evidence-bank-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.evidence-bank-head h4{margin-top:0}.evidence-bank-badge{white-space:nowrap;border:1px solid #526b83;border-radius:999px;padding:.3rem .6rem;font-size:.82em}.evidence-bank-mapping{margin:.8rem 0;padding:.7rem;border:1px solid #405269;border-radius:8px}.evidence-bank-map-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.6rem;margin-top:.7rem}.evidence-bank-map-grid label{display:flex;flex-direction:column;gap:.25rem}.evidence-bank-search-row{display:grid;grid-template-columns:minmax(220px,1fr) auto auto auto;gap:.5rem;margin:.8rem 0}.evidence-bank-result-head{display:flex;justify-content:space-between;gap:1rem;margin:.75rem 0}.evidence-bank-results{display:grid;gap:.65rem;max-height:620px;overflow:auto;padding-right:.25rem}.evidence-bank-record{padding:.75rem;border:1px solid #405269;border-radius:8px;background:rgba(8,16,28,.28)}.evidence-bank-record p{margin:.45rem 0}.evidence-bank-select{display:flex;gap:.45rem;align-items:flex-start}.evidence-bank-select input{width:auto!important;margin-top:.25rem}@media(max-width:900px){.evidence-bank-search-row{grid-template-columns:1fr}.evidence-bank-head{flex-direction:column}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 100) clearInterval(timer);
  }, 50);
})();
