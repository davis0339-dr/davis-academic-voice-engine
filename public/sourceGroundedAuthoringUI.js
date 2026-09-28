(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SOURCE_KEY = "academicVoice.workspace.source.v1";
  const REVISED_KEY = "academicVoice.workspace.revised.v1";
  const HANDOFF_KEY = "academicVoice.sourceAuthoring.handoff.v1";
  const LATEST_KEY = "academicVoice.sourceAuthoring.latest.v2";
  const SYNTHESIS_KEY = "academicVoice.sourceAuthoring.synthesis.v1";
  const CACHE_PREFIX = "academicVoice.sourceAuthoring.plan.v2.";
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_FULL_TEXT_STUDIES = 12;
  const MAX_SCOPUS_ABSTRACTS = 50;
  const SCOPUS_ABSTRACT = "scopus_abstract";
  const state = {
    sources: [],
    scopus: null,
    assembly: null,
    synthesis: null,
    capabilities: { singleEditorWordLimit: 1500, longDocumentWordLimit: 12000 },
  };

  function wordCount(value) {
    return (String(value || "").match(/[A-Za-z0-9']+/g) || []).length;
  }

  // Author-led assembly: nothing enters the draft until the researcher chooses it.
  // Extracts start unselected, and machine-written links become suggestions that
  // stay outside the draft until the researcher accepts or replaces them.
  function prepareAuthorLed(assembly) {
    if (!assembly?.sections || assembly.author_led) return assembly;
    assembly.sections.forEach((section) => {
      section.author_intro = section.author_intro || "";
      (section.blocks || []).forEach((block) => {
        if (block.type === "extract") block.included = false;
        if (block.type === "link") {
          block.suggestion = block.text || "";
          block.text = "";
          block.accepted_suggestion = false;
        }
      });
    });
    assembly.author_led = true;
    return assembly;
  }

  // Bulk choices. Accepting only fills connection boxes the researcher left
  // empty, and clearing only removes accepted suggestions, never their writing.
  function setPassages(sections, include) {
    sections.forEach((section) => section.blocks.forEach((block) => { if (block.type === "extract") block.included = include; }));
  }

  function setSuggestions(sections, accept) {
    sections.forEach((section) => section.blocks.forEach((block) => {
      if (block.type !== "link" || !block.suggestion) return;
      if (accept && !block.text?.trim()) {
        block.text = block.suggestion;
        block.accepted_suggestion = true;
      } else if (!accept && block.accepted_suggestion) {
        block.text = "";
        block.accepted_suggestion = false;
      }
    }));
  }

  function selectionCounts(sections) {
    const blocks = sections.flatMap((section) => section.blocks);
    const passages = blocks.filter((block) => block.type === "extract");
    const suggestions = blocks.filter((block) => block.type === "link" && block.suggestion);
    return {
      passages: passages.length,
      usedPassages: passages.filter((block) => block.included).length,
      suggestions: suggestions.length,
      acceptedSuggestions: suggestions.filter((block) => block.accepted_suggestion).length,
      openSuggestions: suggestions.filter((block) => !block.text?.trim()).length,
    };
  }

  function bulkButton(label, onClick, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (primary) button.className = "primary";
    button.addEventListener("click", () => {
      onClick();
      saveAssembly();
      renderAssembly();
    });
    return button;
  }

  function saveAssembly() {
    try { localStorage.setItem(LATEST_KEY, JSON.stringify({ entryMode: entryMode(), structureText: $("structureText").value, assembly: state.assembly })); } catch {}
  }

  function inferredStudyMetadata(file, result) {
    const stem = file.name.replace(/\.[^.]+$/, "");
    const visible = String(result.text || "").slice(0, 8000);
    const metadata = result.metadata || {};
    const lines = visible.split(/\n+/).map((line) => line.replace(/^\[(?:Page|Line)\s+\d+\]\s*/i, "").trim()).filter(Boolean);
    const authorLike = (value) => {
      const candidate = String(value || "").replace(/^by\s+/i, "").replace(/[∗*†‡]+/g, "").trim();
      if (candidate.length < 5 || candidate.length > 220 || /[?!:]|\b(?:evidence|effect|relationship|analysis|theory|governance|debt|cost|study|quality|firm|board)\b/i.test(candidate)) return false;
      if (/(?:university|department|school|faculty|downloaded|repository|microsoft|ssrn|http|@)/i.test(candidate)) return false;
      const pieces = candidate.split(/\s*(?:,|\band\b|&)\s*/i).filter(Boolean);
      const personName = /^(?:[A-Z][A-Za-z'’\-]+|[A-Z]\.)(?:\s+(?:[A-Z][A-Za-z'’\-]+|[A-Z]\.)){1,4}$/;
      return (pieces.length >= 2 && pieces.every((piece) => personName.test(piece))) || personName.test(candidate);
    };
    const credibleTitle = (value) => {
      const candidate = String(value || "").trim();
      return candidate.length >= 18 && candidate.length <= 300 && !authorLike(candidate) && !/(?:microsoft word|\.docx?$|\.pdf$|ssrn[#\s-]?\d+|untitled|draft[_-])/i.test(candidate);
    };
    const credibleAuthor = (value) => {
      const candidate = String(value || "").replace(/^by\s+/i, "").trim();
      return authorLike(candidate);
    };
    const explicitTitle = lines.find((line) => /^title\s*:/i.test(line))?.replace(/^title\s*:\s*/i, "") || "";
    const titleCandidate = lines.slice(0, 45).find((line) => credibleTitle(line) && wordCount(line) >= 4 && wordCount(line) <= 28 && !/[.!?]$/.test(line) && !/(?:abstract|keywords?|journal|volume|copyright|doi|http|electronic copy)/i.test(line)) || "";
    const explicitAuthor = lines.find((line) => /^authors?\s*:/i.test(line))?.replace(/^authors?\s*:\s*/i, "") || "";
    const byline = lines.find((line) => /^by\s+[A-Z][A-Za-z .,'’&\-]{3,180}$/i.test(line)) || "";
    const titleIndex = lines.indexOf(titleCandidate);
    const nearbyAuthor = titleIndex >= 0 ? lines.slice(titleIndex + 1, titleIndex + 8).find(credibleAuthor) || "" : "";
    const title = credibleTitle(metadata.title) ? metadata.title : credibleTitle(explicitTitle) ? explicitTitle : titleCandidate;
    const author = credibleAuthor(metadata.author) ? metadata.author : credibleAuthor(explicitAuthor) ? explicitAuthor : credibleAuthor(byline) ? byline.replace(/^by\s+/i, "") : nearbyAuthor;
    const publicationYear = lines.slice(0, 100).map((line) => line.match(/(?:published|accepted|forthcoming|copyright|©)[^\n]{0,80}\b((?:19|20)\d{2})\b/i)?.[1]).find(Boolean) || "";
    const year = publicationYear || (author && title ? metadata.year || "" : "");
    const doi = metadata.doi || visible.match(/\b10\.\d{4,9}\/[\-._;()/:A-Z0-9]+\b/i)?.[0]?.replace(/[.,;:]$/, "") || "";
    return {
      title,
      author,
      year,
      publication: "",
      doi,
      url: "",
      metadata_confidence: title && author && year ? "auto_complete_review_required" : "needs_review",
      file_label: stem,
    };
  }

  function suggestedCitation(source) {
    const { author, year, title } = source.bibliographic || {};
    if (author && year) return `${author} (${year})`;
    if (author) return author;
    if (year) return `${title || source.title} (${year})`;
    return "";
  }

  function setStatus(message, error = false) {
    const node = $("sourceAuthoringStatus");
    if (!node) return;
    node.textContent = message;
    node.className = error ? "status-message error" : "status-message";
  }

  function updatePreflight() {
    const target = $("sourcePreflight");
    if (!target) return;
    const manuscript = $("structureText")?.value.replace(/\r\n/g, "\n").trim() || "";
    const visibleLines = manuscript.split("\n").filter((line) => line.trim()).length;
    const citationGroups = (manuscript.match(/\([^()]*(?:19|20)\d{2}[^()]*\)/g) || []).length;
    const reviewed = state.sources.filter((source) => source.bibliographic?.metadata_confidence === "researcher_reviewed").length;
    target.textContent = `Preflight: ${manuscript.length.toLocaleString()} manuscript characters · ${visibleLines.toLocaleString()} non-empty line(s) · ${citationGroups.toLocaleString()} citation group(s) · ${reviewed} of ${state.sources.length} source identity record(s) confirmed.`;
    target.className = manuscript.length > 500000 ? "warning" : "proof";
  }

  function entryMode() {
    return document.querySelector('input[name="entryMode"]:checked')?.value || "develop";
  }

  async function readFile(file) {
    if (!window.AcademicFileImport?.readAcademicFile) throw new Error("The document reader is not ready. Refresh and try again.");
    return window.AcademicFileImport.readAcademicFile(file, MAX_FILE_BYTES);
  }

  async function importStructure(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const label = $("structureStatus");
    try {
      label.textContent = `Reading ${file.name}…`;
      const result = await readFile(file);
      $("structureText").value = result.text;
      label.textContent = `${file.name} loaded · ${result.text.split(/\s+/).filter(Boolean).length.toLocaleString()} words`;
      updatePreflight();
    } catch (error) {
      label.textContent = error.message;
    } finally {
      event.target.value = "";
    }
  }

  function renderSources() {
    const target = $("sourceList");
    target.replaceChildren();
    if (!state.sources.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No studies loaded yet.";
      target.appendChild(empty);
      return;
    }
    const pendingScopus = state.sources.filter((source) => isScopus(source) && source.bibliographic?.metadata_confidence !== "researcher_reviewed");
    if (pendingScopus.length) {
      const confirmAll = document.createElement("button");
      confirmAll.type = "button";
      confirmAll.className = "primary";
      confirmAll.textContent = `Confirm all Scopus records (${pendingScopus.length})`;
      confirmAll.addEventListener("click", () => {
        let skipped = 0;
        pendingScopus.forEach((source) => {
          const bib = source.bibliographic || {};
          if (!bib.title?.trim() || !bib.author?.trim() || !/^(?:19|20)\d{2}[a-z]?$/i.test(bib.year?.trim() || "")) { skipped += 1; return; }
          bib.metadata_confidence = "researcher_reviewed";
          if (!source.citationManuallyEdited) source.citation = suggestedCitation(source);
        });
        renderSources();
        setStatus(skipped ? `${pendingScopus.length - skipped} Scopus record(s) confirmed; ${skipped} need an author, title or year before they can be confirmed.` : `${pendingScopus.length} Scopus record(s) confirmed for citation matching.`, Boolean(skipped));
      });
      target.appendChild(confirmAll);
    }
    state.sources.forEach((source, index) => {
      const row = document.createElement("div");
      row.className = "source-item";
      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${source.fileLabel || source.title}`;
      const confidence = document.createElement("span");
      const updateConfidence = () => {
        const reviewed = source.bibliographic?.metadata_confidence === "researcher_reviewed";
        confidence.className = reviewed ? "metadata-confidence" : "metadata-confidence warning";
        confidence.textContent = reviewed ? "Identity confirmed for citation matching" : "Identity quarantined — review and confirm before citation matching";
      };
      updateConfidence();
      const fields = document.createElement("div");
      fields.className = "bibliographic-fields";
      const field = (labelText, key, placeholder) => {
        const label = document.createElement("label");
        label.textContent = labelText;
        const input = document.createElement("input");
        input.type = "text";
        input.value = source.bibliographic?.[key] || "";
        input.placeholder = placeholder;
        input.addEventListener("input", () => {
          source.bibliographic[key] = input.value;
          source.bibliographic.metadata_confidence = "manual_edits_pending_review";
          if (["author", "year", "title"].includes(key) && !source.citationManuallyEdited) source.citation = suggestedCitation(source);
          citation.value = source.citation || "";
          updateConfidence();
          updatePreflight();
        });
        label.appendChild(input);
        return label;
      };
      fields.append(
        field("Article title", "title", "Full article title"),
        field("Author(s)", "author", "Author names as shown in the article"),
        field("Year", "year", "Publication year"),
        field("Journal / publisher", "publication", "Journal, volume and issue if available"),
        field("DOI", "doi", "10.xxxx/xxxxx"),
      );
      const citationLabel = document.createElement("label");
      citationLabel.textContent = "In-text citation label";
      const citation = document.createElement("input");
      citation.type = "text";
      citation.value = source.citation || suggestedCitation(source);
      citation.placeholder = "e.g. Anderson et al. (2004)";
      citation.addEventListener("input", () => { source.citation = citation.value; source.citationManuallyEdited = true; });
      citationLabel.appendChild(citation);
      fields.appendChild(citationLabel);
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.textContent = "Confirm source identity";
      confirm.addEventListener("click", () => {
        const bib = source.bibliographic || {};
        if (!bib.title?.trim() || !bib.author?.trim() || !/^(?:19|20)\d{2}[a-z]?$/i.test(bib.year?.trim() || "")) {
          return setStatus(`${source.fileLabel || source.title}: add a valid article title, author and publication year before confirming.`, true);
        }
        bib.metadata_confidence = "researcher_reviewed";
        if (!source.citationManuallyEdited) source.citation = suggestedCitation(source);
        citation.value = source.citation;
        updateConfidence();
        setStatus(`${source.fileLabel || source.title}: identity confirmed for citation matching.`);
        updatePreflight();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        state.sources.splice(index, 1);
        renderSources();
        renderScopusPicker();
      });
      const identity = document.createElement("div");
      identity.append(title, confidence);
      const actions = document.createElement("div");
      actions.append(confirm, remove);
      row.append(identity, fields, actions);
      target.appendChild(row);
    });
    updatePreflight();
  }

  const isScopus = (source) => source.origin === SCOPUS_ABSTRACT;

  async function importScopus(file) {
    try {
      if (!window.ScopusImport) throw new Error("The Scopus reader did not load; refresh the page and try again.");
      const { records, withoutAbstract, totalRows } = window.ScopusImport.parseScopusCsv(await file.text());
      state.scopus = { fileName: file.name, records, selected: new Set(), query: "" };
      renderScopusPicker();
      setStatus(`${file.name}: ${records.length} of ${totalRows} Scopus records have an abstract${withoutAbstract ? ` (${withoutAbstract} without an abstract were skipped)` : ""}. Search and tick the ones you want, then add them as studies.`);
    } catch (error) {
      setStatus(`${file.name}: ${error.message}`, true);
    }
  }

  function scopusMatches(record, query) {
    if (!query) return true;
    const haystack = `${record.title} ${record.allAuthors} ${record.author} ${record.year} ${record.journal} ${record.keywords} ${record.abstract}`.toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
  }

  function renderScopusPicker() {
    const target = $("scopusPicker");
    if (!target) return;
    target.replaceChildren();
    const scopus = state.scopus;
    target.hidden = !scopus;
    if (!scopus) return;
    const alreadyAdded = new Set(state.sources.filter(isScopus).map((source) => source.id));
    const room = MAX_SCOPUS_ABSTRACTS - alreadyAdded.size;
    const heading = document.createElement("h4");
    heading.textContent = `Scopus export · ${scopus.fileName} · ${scopus.records.length} records with abstracts`;
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `Passages from these rows come from each paper's published abstract, not the full paper. Up to ${MAX_SCOPUS_ABSTRACTS} abstracts per assembly (${alreadyAdded.size} added, room for ${Math.max(0, room)} more).`;
    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search title, authors, journal, keywords or abstract (all words must match)";
    search.value = scopus.query;
    const shown = scopus.records.filter((record) => !alreadyAdded.has(record.id) && scopusMatches(record, scopus.query));
    const count = document.createElement("p");
    count.className = "scopus-count";
    count.textContent = `${shown.length} matching · ${scopus.selected.size} ticked`;
    const list = document.createElement("div");
    list.className = "scopus-list";
    const renderRows = () => {
      list.replaceChildren();
      shown.slice(0, 200).forEach((record) => {
        const row = document.createElement("label");
        row.className = "scopus-row";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = scopus.selected.has(record.id);
        box.addEventListener("change", () => {
          if (box.checked) scopus.selected.add(record.id); else scopus.selected.delete(record.id);
          count.textContent = `${shown.length} matching · ${scopus.selected.size} ticked`;
        });
        const body = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = record.title;
        const meta = document.createElement("small");
        meta.textContent = [`${record.author || "Unknown author"} (${record.year || "n.d."})`, record.journal, record.documentType].filter(Boolean).join(" · ");
        const snippet = document.createElement("small");
        snippet.textContent = record.abstract.length > 260 ? `${record.abstract.slice(0, 260)}…` : record.abstract;
        body.append(title, meta, snippet);
        row.append(box, body);
        list.appendChild(row);
      });
      if (shown.length > 200) {
        const more = document.createElement("p");
        more.className = "muted";
        more.textContent = `Showing the first 200 of ${shown.length}. Narrow the search to see the rest.`;
        list.appendChild(more);
      }
    };
    renderRows();
    search.addEventListener("keydown", (event) => { if (event.key === "Enter") { scopus.query = search.value; renderScopusPicker(); } });
    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.textContent = "Search";
    searchBtn.addEventListener("click", () => { scopus.query = search.value; renderScopusPicker(); });
    const tickShown = document.createElement("button");
    tickShown.type = "button";
    tickShown.textContent = "Tick all matching (up to the limit)";
    tickShown.addEventListener("click", () => {
      for (const record of shown) {
        if (scopus.selected.size >= Math.max(0, room)) break;
        scopus.selected.add(record.id);
      }
      renderScopusPicker();
    });
    const clearTicks = document.createElement("button");
    clearTicks.type = "button";
    clearTicks.textContent = "Clear ticks";
    clearTicks.addEventListener("click", () => { scopus.selected.clear(); renderScopusPicker(); });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = "Add ticked abstracts as studies";
    add.addEventListener("click", addScopusSelected);
    const controls = document.createElement("div");
    controls.className = "action-row";
    controls.append(searchBtn, tickShown, clearTicks, add);
    target.append(heading, note, search, controls, count, list);
  }

  function addScopusSelected() {
    const scopus = state.scopus;
    if (!scopus?.selected.size) return setStatus("Tick at least one Scopus record first.", true);
    const room = MAX_SCOPUS_ABSTRACTS - state.sources.filter(isScopus).length;
    const chosen = scopus.records.filter((record) => scopus.selected.has(record.id));
    if (chosen.length > room) return setStatus(`Only ${Math.max(0, room)} more Scopus abstracts fit in one assembly (limit ${MAX_SCOPUS_ABSTRACTS}). Untick ${chosen.length - room}.`, true);
    chosen.forEach((record) => {
      state.sources.push({
        id: record.id,
        origin: SCOPUS_ABSTRACT,
        title: record.title,
        fileLabel: `Scopus abstract · ${record.title}`,
        citation: record.author && record.year ? `${record.author} (${record.year})` : "",
        bibliographic: { title: record.title, author: record.author, year: record.year, publication: record.publication, doi: record.doi, url: record.url, metadata_confidence: "needs_review" },
        text: record.abstract,
        structure: "scopus_abstract",
      });
    });
    scopus.selected.clear();
    renderSources();
    renderScopusPicker();
    setStatus(`${chosen.length} Scopus abstract(s) added as studies. Check the records below, then use “Confirm all Scopus records”.`);
  }

  async function importStudies(event) {
    const picked = Array.from(event.target.files || []);
    const csvFiles = picked.filter((file) => /\.csv$/i.test(file.name) || file.type === "text/csv");
    for (const file of csvFiles) await importScopus(file);
    const fullTextCount = state.sources.filter((source) => !isScopus(source)).length;
    const files = picked.filter((file) => !csvFiles.includes(file)).slice(0, Math.max(0, MAX_FULL_TEXT_STUDIES - fullTextCount));
    if (!files.length) { event.target.value = ""; return; }
    const label = $("studyStatus");
    let added = 0;
    for (const file of files) {
      try {
        label.textContent = `Reading ${file.name}…`;
        const result = await readFile(file);
        const bibliographic = inferredStudyMetadata(file, result);
        state.sources.push({
          id: `source-${Date.now()}-${state.sources.length + 1}`,
          title: bibliographic.title || `Source ${state.sources.length + 1}`,
          fileLabel: file.name,
          citation: bibliographic.author && bibliographic.year ? `${bibliographic.author} (${bibliographic.year})` : "",
          bibliographic,
          text: result.text,
          structure: result.structure || "text",
        });
        added += 1;
      } catch (error) {
        setStatus(`${file.name}: ${error.message}`, true);
      }
    }
    renderSources();
    label.textContent = `${added} study file(s) added · ${state.sources.length} currently loaded`;
    event.target.value = "";
  }

  async function postAssembly(guided) {
    const structureText = $("structureText").value.trim();
    if (!structureText) return setStatus("Add the template, existing draft or researcher guide first.", true);
    if (!state.sources.length) return setStatus("Upload at least one relevant study first.", true);
    const reviewed = state.sources.filter((source) => source.bibliographic?.metadata_confidence === "researcher_reviewed").length;
    if (guided && !reviewed) return setStatus("Confirm at least one source identity before spending a guided-selection call. No model call was made.", true);
    $("buildLocalBtn").disabled = true;
    $("buildGuidedBtn").disabled = true;
    setStatus(guided ? "Retrieving exact passages locally, then using one compact call to order them…" : "Retrieving and arranging exact passages locally…");
    try {
      const response = await fetch("/api/source-authoring/assemble", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryMode: entryMode(), structureText, sources: state.sources, guided }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Source assembly failed.");
      if (!data.extraction_verified?.exact) throw new Error("Exact-source verification failed; no assembly was accepted.");
      state.assembly = prepareAuthorLed(data);
      try { localStorage.setItem(LATEST_KEY, JSON.stringify({ entryMode: entryMode(), structureText, assembly: data })); } catch {}
      renderAssembly();
      const warning = data.warning ? ` ${data.warning}` : "";
      const gaps = (data.sections || []).flatMap((section) => section.blocks || []).filter((block) => block.type === "review_note").length;
      const audit = data.input_audit || {};
      const preservation = audit.complete ? `${Number(audit.processed_characters || 0).toLocaleString()} of ${Number(audit.submitted_characters || 0).toLocaleString()} characters processed` : "INPUT PRESERVATION FAILED";
      setStatus(`${preservation}; ${audit.section_count || 0} section(s), ${audit.paragraph_count || 0} paragraph(s), ${audit.citation_anchor_count || 0} citation anchor(s). ${data.extract_count} substantive exact extract(s) accepted from ${data.source_count} source(s); ${gaps} evidence gap(s). ${audit.reviewed_source_identities || 0} source identity record(s) confirmed. Model calls used: ${data.model_calls}.${warning} Nothing is in your draft yet: tick the passages you want to use and write your own connecting text. Suggested connections stay out of the draft until you accept them.`, !audit.complete);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      $("buildLocalBtn").disabled = false;
      $("buildGuidedBtn").disabled = false;
    }
  }

  function removeExtract(sectionIndex, blockIndex) {
    const section = state.assembly.sections[sectionIndex];
    section.blocks.splice(blockIndex, 1);
    if (section.blocks[blockIndex - 1]?.type === "link") section.blocks.splice(blockIndex - 1, 1);
    else if (section.blocks[blockIndex]?.type === "link") section.blocks.splice(blockIndex, 1);
    state.assembly.extract_count = state.assembly.sections.reduce((sum, item) => sum + item.blocks.filter((block) => block.type === "extract").length, 0);
    try { localStorage.setItem(LATEST_KEY, JSON.stringify({ entryMode: entryMode(), structureText: $("structureText").value, assembly: state.assembly })); } catch {}
    renderAssembly();
  }

  function renderAssembly() {
    const target = $("assemblyWorkspace");
    target.replaceChildren();
    const assembly = state.assembly;
    if (!assembly?.sections?.length) return;
    const all = selectionCounts(assembly.sections);
    const toolbar = document.createElement("div");
    toolbar.className = "bulk-toolbar";
    const summary = document.createElement("p");
    summary.className = "bulk-summary";
    summary.textContent = `All sections: ${all.usedPassages} of ${all.passages} passages in your draft · ${all.acceptedSuggestions} of ${all.suggestions} suggested connections accepted`;
    const bulkRow = document.createElement("div");
    bulkRow.className = "action-row";
    bulkRow.append(
      bulkButton("Use every passage (all sections)", () => setPassages(assembly.sections, true), true),
      bulkButton("Remove every passage (all sections)", () => setPassages(assembly.sections, false)),
      bulkButton("Accept every suggested connection (all sections)", () => setSuggestions(assembly.sections, true)),
      bulkButton("Clear accepted suggestions (all sections)", () => setSuggestions(assembly.sections, false)),
    );
    const bulkNote = document.createElement("p");
    bulkNote.className = "muted";
    bulkNote.textContent = "Accepting suggestions only fills connection boxes you left empty; clearing removes accepted suggestions but never text you wrote.";
    toolbar.append(summary, bulkRow, bulkNote);
    target.appendChild(toolbar);
    assembly.sections.forEach((section, sectionIndex) => {
      const article = document.createElement("article");
      article.className = "assembly-section";
      const heading = document.createElement("h3");
      heading.textContent = section.heading;
      article.appendChild(heading);
      const here = selectionCounts([section]);
      const sectionRow = document.createElement("div");
      sectionRow.className = "action-row";
      if (here.passages) {
        const allUsed = here.usedPassages === here.passages;
        sectionRow.appendChild(bulkButton(allUsed ? "Remove every passage in this section from my draft" : "Use every passage in this section", () => setPassages([section], !allUsed)));
      }
      if (here.suggestions) {
        const allAccepted = here.openSuggestions === 0 && here.acceptedSuggestions > 0;
        sectionRow.appendChild(bulkButton(allAccepted ? "Clear accepted suggestions in this section" : "Accept every suggested connection in this section", () => setSuggestions([section], !allAccepted)));
      }
      if (sectionRow.childNodes.length) article.appendChild(sectionRow);
      const intro = document.createElement("div");
      intro.className = "assembly-block link author-intro";
      const introLabel = document.createElement("div");
      introLabel.className = "block-label";
      introLabel.textContent = "YOUR OPENING TEXT FOR THIS SECTION · optional, in your own words";
      const introField = document.createElement("textarea");
      introField.value = section.author_intro || "";
      introField.placeholder = "Introduce the argument of this section in your own words, or leave empty.";
      introField.addEventListener("input", () => {
        section.author_intro = introField.value;
        refreshPreview();
        saveAssembly();
      });
      intro.append(introLabel, introField);
      article.appendChild(intro);
      section.blocks.forEach((block, blockIndex) => {
        const card = document.createElement("div");
        card.className = `assembly-block ${block.type}${block.type === "extract" && !block.included ? " excluded" : ""}`;
        const label = document.createElement("div");
        label.className = "block-label";
        const left = document.createElement("span");
        const right = document.createElement("span");
        if (block.type === "extract") {
          left.textContent = `${block.origin === SCOPUS_ABSTRACT ? "SCOPUS ABSTRACT · VERBATIM FROM THE PUBLISHED ABSTRACT" : "LOCKED VERBATIM EXTRACT"} · ${block.source_title}${block.included ? " · IN YOUR DRAFT" : " · not in your draft"}`;
          right.textContent = [block.citation, block.locator].filter(Boolean).join(" · ") || "source retained internally";
          const body = document.createElement("div");
          body.className = "extract-text";
          body.textContent = block.text;
          const reason = document.createElement("div");
          reason.className = "selection-reason";
          const roles = Array.isArray(block.research_functions) ? block.research_functions.join(", ").replaceAll("_", " ") : "substantive evidence";
          reason.textContent = `${block.relationship || "candidate for section"} · ${roles}. ${block.selection_reason || ""}`.trim();
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove extract";
          remove.addEventListener("click", () => removeExtract(sectionIndex, blockIndex));
          const use = document.createElement("label");
          use.className = "use-passage";
          const useBox = document.createElement("input");
          useBox.type = "checkbox";
          useBox.checked = Boolean(block.included);
          useBox.addEventListener("change", () => {
            block.included = useBox.checked;
            saveAssembly();
            renderAssembly();
          });
          use.append(useBox, document.createTextNode(" Use this passage in my draft"));
          label.append(left, right);
          card.append(label, use, body, reason, remove);
        } else if (block.type === "author_text") {
          left.textContent = "AUTHOR TEXT PRESERVED";
          right.textContent = block.citation_anchors?.length ? `citation location: ${block.citation_anchors.join("; ")}` : "existing structure retained";
          const body = document.createElement("div");
          body.className = "extract-text author-text";
          body.textContent = block.text;
          label.append(left, right);
          card.append(label, body);
        } else if (block.type === "review_note") {
          left.textContent = "EVIDENCE GAP — NO PASSAGE FORCED";
          right.textContent = "researcher action required";
          const body = document.createElement("div");
          body.className = "extract-text";
          body.textContent = block.text;
          label.append(left, right);
          card.append(label, body);
        } else {
          left.textContent = "YOUR CONNECTING TEXT";
          right.textContent = "only what you write or accept enters the draft";
          const field = document.createElement("textarea");
          field.value = block.text || "";
          field.placeholder = "Write the connection between these passages in your own words, or leave empty.";
          field.addEventListener("input", () => {
            block.text = field.value;
            block.accepted_suggestion = Boolean(block.suggestion) && field.value.trim() === block.suggestion.trim();
            refreshPreview();
            saveAssembly();
          });
          label.append(left, right);
          card.append(label);
          if (block.suggestion) {
            const suggestion = document.createElement("div");
            suggestion.className = "suggestion";
            const suggestionText = document.createElement("span");
            suggestionText.textContent = `Suggested connection (not in your draft): ${block.suggestion}`;
            const accept = document.createElement("button");
            accept.type = "button";
            accept.textContent = "Use this suggestion";
            accept.addEventListener("click", () => {
              block.text = block.suggestion;
              block.accepted_suggestion = true;
              field.value = block.text;
              refreshPreview();
              saveAssembly();
            });
            suggestion.append(suggestionText, accept);
            card.appendChild(suggestion);
          }
          card.appendChild(field);
        }
        article.appendChild(card);
      });
      target.appendChild(article);
    });
    $("handoffCard").hidden = false;
    refreshPreview();
    renderReferences();
  }

  function addMetric(target, label, value) {
    const cell = document.createElement("div");
    const caption = document.createElement("span");
    caption.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    cell.append(caption, strong);
    target.appendChild(cell);
  }

  function renderSynthesisReferences() {
    const target = $("synthesisReferences");
    target.replaceChildren();
    const records = state.synthesis?.reference_records || [];
    if (!records.length) return;
    const heading = document.createElement("h4");
    heading.textContent = "Cited source records — verify final reference formatting";
    target.appendChild(heading);
    records.forEach((record) => {
      const row = document.createElement("div");
      row.className = "reference-record";
      row.textContent = record.working_reference || [record.author, record.year, record.title].filter(Boolean).join(" · ");
      target.appendChild(row);
    });
  }

  function renderSynthesis() {
    const synthesis = state.synthesis;
    if (!synthesis?.synthesis_text) return;
    $("synthesisCard").hidden = false;
    $("synthesisDraft").value = synthesis.synthesis_text;

    const audit = synthesis.synthesis_audit || {};
    const auditTarget = $("synthesisAudit");
    auditTarget.replaceChildren();
    const verdict = document.createElement("p");
    verdict.className = audit.status === "complete" ? "proof synthesis-complete" : "warning synthesis-review";
    verdict.textContent = audit.status === "complete"
      ? "Controlled source and citation checks completed. Researcher review is still required for argument quality."
      : "The completed manuscript is visible, but the checks below identify items for researcher review; nothing was erased.";
    const metrics = document.createElement("div");
    metrics.className = "synthesis-audit";
    addMetric(metrics, "Output", `${Number(audit.output_words || 0).toLocaleString()} words`);
    addMetric(metrics, "Reasoning points", `${audit.used_points || 0}/${audit.planned_points || 0} used`);
    addMetric(metrics, "Evidence passages", audit.used_extracts || 0);
    addMetric(metrics, "Source citations", audit.citation_insertions || 0);
    addMetric(metrics, "Distinct sources", audit.cited_sources || 0);
    addMetric(metrics, "Verified quotations", audit.verified_quote_count || 0);
    addMetric(metrics, "Author paragraphs mapped", `${audit.author_paragraphs_mapped || 0}/${audit.author_paragraphs_submitted || 0}`);
    addMetric(metrics, "Repeated stock openings", (audit.repeated_transition_openings || []).reduce((sum, row) => sum + row.count, 0));
    auditTarget.append(verdict, metrics);

    const notebookTarget = $("synthesisNotebook");
    notebookTarget.replaceChildren();
    if (synthesis.notebook?.document_position) {
      const position = document.createElement("p");
      position.className = "proof";
      position.textContent = synthesis.notebook.document_position;
      notebookTarget.appendChild(position);
    }
    (synthesis.notebook?.sections || []).forEach((section) => {
      const card = document.createElement("section");
      card.className = "notebook-section";
      const heading = document.createElement("h4");
      heading.textContent = section.heading;
      const purpose = document.createElement("p");
      purpose.textContent = section.section_purpose || "Section purpose was not stated.";
      card.append(heading, purpose);
      (section.points || []).forEach((point) => {
        const row = document.createElement("div");
        row.className = "notebook-point";
        const proposition = document.createElement("strong");
        proposition.textContent = point.proposition;
        const reasoning = document.createElement("small");
        reasoning.textContent = [point.relationship?.replaceAll("_", " "), point.reasoning_note, point.tension_or_boundary].filter(Boolean).join(" · ");
        const evidence = document.createElement("small");
        evidence.textContent = `Evidence: ${(point.evidence_ids || []).join(", ") || "researcher reasoning only"}`;
        row.append(proposition, reasoning, evidence);
        card.appendChild(row);
      });
      notebookTarget.appendChild(card);
    });

    const warnings = $("synthesisWarnings");
    warnings.replaceChildren();
    if ((synthesis.warnings || []).length) {
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = `Researcher review notes (${synthesis.warnings.length})`;
      const list = document.createElement("ul");
      synthesis.warnings.forEach((warning) => {
        const item = document.createElement("li");
        item.textContent = warning;
        list.appendChild(item);
      });
      details.append(summary, list);
      warnings.appendChild(details);
    }
    renderSynthesisReferences();
  }

  async function postSynthesis() {
    const structureText = $("structureText").value.trim();
    if (!structureText) return setStatus("Add the template, existing draft or researcher guide first.", true);
    if (!state.sources.length) return setStatus("Upload the relevant studies before source synthesis.", true);
    const reviewed = state.sources.filter((source) => source.bibliographic?.metadata_confidence === "researcher_reviewed").length;
    if (!reviewed) return setStatus("Confirm at least one source identity before synthesis. No model call was made.", true);
    const targetWords = Math.max(400, Math.min(6000, Number.parseInt($("synthesisTargetWords").value, 10) || 1800));
    const quotePolicy = $("synthesisQuotePolicy").value || "selective";
    $("buildLocalBtn").disabled = true;
    $("buildGuidedBtn").disabled = true;
    $("buildSynthesisBtn").disabled = true;
    setStatus("Reading the author position, making a source-linked notebook, comparing the studies and composing one manuscript…");
    try {
      const response = await fetch("/api/source-authoring/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryMode: entryMode(), structureText, sources: state.sources, targetWords, quotePolicy }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Source synthesis failed.");
      if (!data.synthesis_text) throw new Error("No synthesized manuscript was returned; nothing was saved.");
      state.synthesis = data;
      try {
        localStorage.setItem(SYNTHESIS_KEY, JSON.stringify({ entryMode: entryMode(), structureText, synthesis: data }));
      } catch {}
      renderSynthesis();
      const audit = data.synthesis_audit || {};
      setStatus(`Source synthesis completed in ${data.model_calls || 1} model call(s): ${Number(audit.output_words || 0).toLocaleString()} words, ${audit.used_points || 0} reasoning point(s), ${audit.used_extracts || 0} evidence passage(s), ${audit.citation_insertions || 0} citation insertion(s), ${audit.verified_quote_count || 0} exact-verified quotation(s). Status: ${audit.status === "complete" ? "controlled checks complete" : "researcher review required"}.`);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      $("buildLocalBtn").disabled = false;
      $("buildGuidedBtn").disabled = false;
      $("buildSynthesisBtn").disabled = false;
    }
  }

  // The draft holds only what the researcher chose: ticked extracts (verbatim,
  // with their citation), their own writing, and suggestions they accepted.
  function assembledText() {
    return (state.assembly?.sections || []).map((section) => {
      const blocks = section.blocks || [];
      const parts = [section.author_intro?.trim()];
      blocks.forEach((block, index) => {
        const value = block.text?.trim();
        if (block.type === "review_note" || !value) return;
        if (block.type === "extract") {
          if (block.included) parts.push(block.parenthetical_citation ? `${value}\n${block.parenthetical_citation}` : value);
          return;
        }
        if (block.type === "link" && block.accepted_suggestion) {
          // An accepted suggestion joins two passages; drop it if either is unused.
          const before = blocks[index - 1];
          const after = blocks[index + 1];
          if ((before?.type === "extract" && !before.included) || (after?.type === "extract" && !after.included)) return;
        }
        parts.push(value);
      });
      const body = parts.filter(Boolean).join("\n\n");
      return body ? `${section.heading}\n\n${body}` : "";
    }).filter(Boolean).join("\n\n");
  }

  function lockedExtracts() {
    return (state.assembly?.sections || []).flatMap((section) => section.blocks || []).filter((block) => block.type === "extract" && block.included).map((block) => ({
      id: block.id,
      text: block.text,
      source_id: block.source_id,
      source_title: block.source_title,
      citation: block.citation,
      locator: block.locator,
    }));
  }

  function refreshPreview() {
    const draft = assembledText();
    $("assembledDraft").value = draft;
    const words = wordCount(draft);
    const destination = words > state.capabilities.singleEditorWordLimit ? "Long Document review" : "single-section Editor review";
    const summary = $("handoffSummary");
    const extracts = (state.assembly?.sections || []).flatMap((section) => section.blocks || []).filter((block) => block.type === "extract");
    const used = extracts.filter((block) => block.included).length;
    if (summary) summary.textContent = `${used} of ${extracts.length} passages in your draft · ${words.toLocaleString()} words · will open in ${destination}; no text will be trimmed.`;
  }

  function renderReferences() {
    const target = $("referenceWorkspace");
    if (!target) return;
    target.replaceChildren();
    const records = state.assembly?.reference_records || [];
    if (!records.length) return;
    const heading = document.createElement("h4");
    heading.textContent = "Working source records — verify before final referencing";
    target.appendChild(heading);
    records.forEach((record) => {
      const row = document.createElement("div");
      row.className = "reference-record";
      row.textContent = record.working_reference || [record.author, record.year, record.title].filter(Boolean).join(" · ");
      target.appendChild(row);
    });
  }

  function handoff(destination, outputKind = "assembly") {
    const synthesisDraft = $("synthesisDraft")?.value.trim() || "";
    const draft = outputKind === "synthesis" ? synthesisDraft : assembledText();
    if (!draft) return setStatus(outputKind === "synthesis" ? "Build and review the source-led draft first." : "Nothing is in your draft yet. Tick the passages you want to use or write your own text first.", true);
    const synthesisQuotes = (state.synthesis?.verified_quotes || []).map((quote) => ({
      id: quote.id,
      text: quote.text,
      source_id: quote.source_id,
      source_title: state.synthesis?.reference_records?.find((record) => record.source_id === quote.source_id)?.title || quote.source_id,
      citation: state.synthesis?.reference_records?.find((record) => record.source_id === quote.source_id)?.parenthetical_citation || "",
      locator: quote.locator,
    }));
    const payload = {
      version: 2,
      createdAt: new Date().toISOString(),
      entryMode: entryMode(),
      workflowMode: outputKind === "synthesis" ? "source_synthesis" : "exact_extract_assembly",
      structureText: $("structureText").value,
      assembledText: draft,
      lockedExtracts: outputKind === "synthesis" ? synthesisQuotes : lockedExtracts(),
      referenceRecords: outputKind === "synthesis" ? state.synthesis?.reference_records || [] : state.assembly?.reference_records || [],
      synthesisAudit: outputKind === "synthesis" ? state.synthesis?.synthesis_audit || null : null,
      synthesisNotebook: outputKind === "synthesis" ? state.synthesis?.notebook || null : null,
      wordCount: wordCount(draft),
      targetSurface: wordCount(draft) > state.capabilities.singleEditorWordLimit ? "longdoc" : "single",
      cacheKey: outputKind === "synthesis" ? state.synthesis?.cache_key || null : state.assembly?.cache_key || null,
    };
    try {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
      // Only the Editor's single-section surface has a word limit; it routes longer
      // drafts to Long Document from HANDOFF_KEY. The Studio takes the full draft.
      const fitsSource = destination === "studio" || wordCount(draft) <= state.capabilities.singleEditorWordLimit;
      localStorage.setItem(SOURCE_KEY, fitsSource ? draft : "");
      localStorage.setItem(REVISED_KEY, "");
    } catch {
      // Navigating now would open the destination without the draft.
      return setStatus("The draft could not be saved for handoff because browser storage is full or blocked. Copy the draft manually, or clear this workspace and try again.", true);
    }
    location.href = destination === "studio" ? "/studio?handoff=source-authoring" : "/editor?handoff=source-authoring";
  }

  function clearWorkspace() {
    state.sources = [];
    state.scopus = null;
    renderScopusPicker();
    state.assembly = null;
    state.synthesis = null;
    $("structureText").value = "";
    $("assemblyWorkspace").replaceChildren();
    $("handoffCard").hidden = true;
    $("synthesisCard").hidden = true;
    renderSources();
    try { localStorage.removeItem(LATEST_KEY); localStorage.removeItem(SYNTHESIS_KEY); } catch {}
    setStatus("Source-led workspace cleared.");
  }

  function purgeRetiredPlanCache() {
    // Earlier builds stored every assembly under CACHE_PREFIX and never read it
    // back; those entries only consume the storage quota the handoff needs.
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
      }
    } catch {}
  }

  function restoreLatest() {
    try {
      const saved = JSON.parse(localStorage.getItem(LATEST_KEY) || "null");
      if (saved?.assembly?.sections?.length) {
        const mode = document.querySelector(`input[name="entryMode"][value="${saved.entryMode}"]`);
        if (mode) mode.checked = true;
        $("structureText").value = saved.structureText || "";
        state.assembly = prepareAuthorLed(saved.assembly);
        renderAssembly();
        setStatus("Previous source-led assembly restored. Extracts remain locked; connecting passages remain editable.");
      }
    } catch {}
    try {
      const savedSynthesis = JSON.parse(localStorage.getItem(SYNTHESIS_KEY) || "null");
      if (!savedSynthesis?.synthesis?.synthesis_text) return;
      const mode = document.querySelector(`input[name="entryMode"][value="${savedSynthesis.entryMode}"]`);
      if (mode) mode.checked = true;
      if (!$("structureText").value) $("structureText").value = savedSynthesis.structureText || "";
      state.synthesis = savedSynthesis.synthesis;
      renderSynthesis();
      setStatus("Previous source synthesis restored. Its notebook, citation audit and manuscript remain available for researcher review.");
    } catch {}
  }

  async function loadBuild() {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      if (data.capabilities) state.capabilities = { ...state.capabilities, ...data.capabilities };
      $("sourceBuildBadge").textContent = `build: ${data.build?.commitShort || "unknown"}`;
      if (data.build?.githubUrl) $("sourceBuildBadge").href = data.build.githubUrl;
    } catch { $("sourceBuildBadge").textContent = "build: unavailable"; }
  }

  function init() {
    $("structureFile").addEventListener("change", importStructure);
    $("structureText").addEventListener("input", updatePreflight);
    $("studyFiles").addEventListener("change", importStudies);
    $("buildLocalBtn").addEventListener("click", () => postAssembly(false));
    $("buildGuidedBtn").addEventListener("click", () => postAssembly(true));
    $("buildSynthesisBtn").addEventListener("click", postSynthesis);
    $("clearSourceAuthoringBtn").addEventListener("click", clearWorkspace);
    $("refreshDraftBtn").addEventListener("click", refreshPreview);
    $("sendSourceEditorBtn").addEventListener("click", () => handoff("editor"));
    $("sendSourceStudioBtn").addEventListener("click", () => handoff("studio"));
    $("sendSynthesisEditorBtn").addEventListener("click", () => handoff("editor", "synthesis"));
    $("sendSynthesisStudioBtn").addEventListener("click", () => handoff("studio", "synthesis"));
    $("synthesisDraft").addEventListener("input", () => setStatus("The synthesis has researcher edits after generation; the displayed audit describes the generated version."));
    loadBuild();
    purgeRetiredPlanCache();
    restoreLatest();
    updatePreflight();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
