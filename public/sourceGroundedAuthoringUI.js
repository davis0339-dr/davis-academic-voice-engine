(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SOURCE_KEY = "academicVoice.workspace.source.v1";
  const REVISED_KEY = "academicVoice.workspace.revised.v1";
  const HANDOFF_KEY = "academicVoice.sourceAuthoring.handoff.v1";
  const LATEST_KEY = "academicVoice.sourceAuthoring.latest.v1";
  const CACHE_PREFIX = "academicVoice.sourceAuthoring.plan.";
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const state = {
    sources: [],
    assembly: null,
    capabilities: { singleEditorWordLimit: 1500, longDocumentWordLimit: 12000 },
  };

  function wordCount(value) {
    return (String(value || "").match(/[A-Za-z0-9']+/g) || []).length;
  }

  function inferredStudyMetadata(file, result) {
    const stem = file.name.replace(/\.[^.]+$/, "");
    const visible = String(result.text || "").slice(0, 8000);
    const metadata = result.metadata || {};
    const year = metadata.year || visible.match(/\b(?:19|20)\d{2}\b/)?.[0] || stem.match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
    const byline = visible.split(/\n+/).map((line) => line.trim()).find((line) => /^by\s+[A-Z][A-Za-z .,'’&\-]{3,180}$/i.test(line));
    const author = metadata.author || byline?.replace(/^by\s+/i, "") || "";
    const title = metadata.title || stem;
    const doi = metadata.doi || visible.match(/\b10\.\d{4,9}\/[\-._;()/:A-Z0-9]+\b/i)?.[0]?.replace(/[.,;:]$/, "") || "";
    return {
      title,
      author,
      year,
      publication: "",
      doi,
      url: "",
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
    state.sources.forEach((source, index) => {
      const row = document.createElement("div");
      row.className = "source-item";
      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${source.title}`;
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
          if (["author", "year", "title"].includes(key) && !source.citationManuallyEdited) source.citation = suggestedCitation(source);
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
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        state.sources.splice(index, 1);
        renderSources();
      });
      row.append(title, fields, remove);
      target.appendChild(row);
    });
  }

  async function importStudies(event) {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, 12 - state.sources.length));
    if (!files.length) return;
    const label = $("studyStatus");
    let added = 0;
    for (const file of files) {
      try {
        label.textContent = `Reading ${file.name}…`;
        const result = await readFile(file);
        const bibliographic = inferredStudyMetadata(file, result);
        state.sources.push({
          id: `source-${Date.now()}-${state.sources.length + 1}`,
          title: bibliographic.title,
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
      state.assembly = data;
      try {
        localStorage.setItem(`${CACHE_PREFIX}${data.cache_key}`, JSON.stringify(data));
        localStorage.setItem(LATEST_KEY, JSON.stringify({ entryMode: entryMode(), structureText, assembly: data }));
      } catch {}
      renderAssembly();
      const warning = data.warning ? ` ${data.warning}` : "";
      setStatus(`${data.extract_count} exact extract(s) arranged from ${data.source_count} source(s). Model calls used: ${data.model_calls}.${warning}`);
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
    assembly.sections.forEach((section, sectionIndex) => {
      const article = document.createElement("article");
      article.className = "assembly-section";
      const heading = document.createElement("h3");
      heading.textContent = section.heading;
      article.appendChild(heading);
      section.blocks.forEach((block, blockIndex) => {
        const card = document.createElement("div");
        card.className = `assembly-block ${block.type}`;
        const label = document.createElement("div");
        label.className = "block-label";
        const left = document.createElement("span");
        const right = document.createElement("span");
        if (block.type === "extract") {
          left.textContent = `LOCKED VERBATIM EXTRACT · ${block.source_title}`;
          right.textContent = [block.citation, block.locator].filter(Boolean).join(" · ") || "source retained internally";
          const body = document.createElement("div");
          body.className = "extract-text";
          body.textContent = block.text;
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove extract";
          remove.addEventListener("click", () => removeExtract(sectionIndex, blockIndex));
          label.append(left, right);
          card.append(label, body, remove);
        } else if (block.type === "author_text") {
          left.textContent = "AUTHOR TEXT PRESERVED";
          right.textContent = block.citation_anchors?.length ? `citation location: ${block.citation_anchors.join("; ")}` : "existing structure retained";
          const body = document.createElement("div");
          body.className = "extract-text author-text";
          body.textContent = block.text;
          label.append(left, right);
          card.append(label, body);
        } else {
          left.textContent = "EDITABLE CONNECTION";
          right.textContent = "author review required";
          const field = document.createElement("textarea");
          field.value = block.text || "";
          field.addEventListener("input", () => {
            block.text = field.value;
            refreshPreview();
            try { localStorage.setItem(LATEST_KEY, JSON.stringify({ entryMode: entryMode(), structureText: $("structureText").value, assembly: state.assembly })); } catch {}
          });
          label.append(left, right);
          card.append(label, field);
        }
        article.appendChild(card);
      });
      target.appendChild(article);
    });
    $("handoffCard").hidden = false;
    refreshPreview();
    renderReferences();
  }

  function assembledText() {
    return (state.assembly?.sections || []).map((section) => {
      const body = (section.blocks || []).map((block) => {
        const value = block.text?.trim();
        if (!value) return "";
        if (block.type === "extract" && block.parenthetical_citation) return `${value}\n${block.parenthetical_citation}`;
        return value;
      }).filter(Boolean).join("\n\n");
      return `${section.heading}\n\n${body}`.trim();
    }).filter(Boolean).join("\n\n");
  }

  function lockedExtracts() {
    return (state.assembly?.sections || []).flatMap((section) => section.blocks || []).filter((block) => block.type === "extract").map((block) => ({
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
    if (summary) summary.textContent = `${words.toLocaleString()} words · will open in ${destination}; no text will be trimmed.`;
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

  function handoff(destination) {
    const draft = assembledText();
    if (!draft) return setStatus("Build and review the source-led draft first.", true);
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      entryMode: entryMode(),
      structureText: $("structureText").value,
      assembledText: draft,
      lockedExtracts: lockedExtracts(),
      referenceRecords: state.assembly?.reference_records || [],
      wordCount: wordCount(draft),
      targetSurface: wordCount(draft) > state.capabilities.singleEditorWordLimit ? "longdoc" : "single",
      cacheKey: state.assembly?.cache_key || null,
    };
    try {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
      localStorage.setItem(SOURCE_KEY, wordCount(draft) <= state.capabilities.singleEditorWordLimit ? draft : "");
      localStorage.setItem(REVISED_KEY, "");
    } catch {}
    location.href = destination === "studio" ? "/studio?handoff=source-authoring" : "/editor?handoff=source-authoring";
  }

  function clearWorkspace() {
    state.sources = [];
    state.assembly = null;
    $("structureText").value = "";
    $("assemblyWorkspace").replaceChildren();
    $("handoffCard").hidden = true;
    renderSources();
    try { localStorage.removeItem(LATEST_KEY); } catch {}
    setStatus("Source-led workspace cleared.");
  }

  function restoreLatest() {
    try {
      const saved = JSON.parse(localStorage.getItem(LATEST_KEY) || "null");
      if (!saved?.assembly?.sections?.length) return;
      const mode = document.querySelector(`input[name="entryMode"][value="${saved.entryMode}"]`);
      if (mode) mode.checked = true;
      $("structureText").value = saved.structureText || "";
      state.assembly = saved.assembly;
      renderAssembly();
      setStatus("Previous source-led assembly restored. Extracts remain locked; connecting passages remain editable.");
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
    $("studyFiles").addEventListener("change", importStudies);
    $("buildLocalBtn").addEventListener("click", () => postAssembly(false));
    $("buildGuidedBtn").addEventListener("click", () => postAssembly(true));
    $("clearSourceAuthoringBtn").addEventListener("click", clearWorkspace);
    $("refreshDraftBtn").addEventListener("click", refreshPreview);
    $("sendSourceEditorBtn").addEventListener("click", () => handoff("editor"));
    $("sendSourceStudioBtn").addEventListener("click", () => handoff("studio"));
    loadBuild();
    restoreLatest();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
