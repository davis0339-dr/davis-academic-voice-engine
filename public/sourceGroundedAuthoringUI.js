(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SOURCE_KEY = "academicVoice.workspace.source.v1";
  const REVISED_KEY = "academicVoice.workspace.revised.v1";
  const HANDOFF_KEY = "academicVoice.sourceAuthoring.handoff.v1";
  const LATEST_KEY = "academicVoice.sourceAuthoring.latest.v1";
  const CACHE_PREFIX = "academicVoice.sourceAuthoring.plan.";
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const state = { sources: [], assembly: null };

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
      const citation = document.createElement("input");
      citation.type = "text";
      citation.value = source.citation || "";
      citation.placeholder = "Optional citation label, e.g. Anderson et al. (2004)";
      citation.addEventListener("input", () => { source.citation = citation.value; });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        state.sources.splice(index, 1);
        renderSources();
      });
      row.append(title, citation, remove);
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
        state.sources.push({
          id: `source-${Date.now()}-${state.sources.length + 1}`,
          title: file.name.replace(/\.[^.]+$/, ""),
          citation: "",
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
    if (section.blocks[blockIndex]?.type === "link") section.blocks.splice(blockIndex, 1);
    if (section.blocks[blockIndex - 1]?.type === "link" && !section.blocks[blockIndex]) section.blocks.splice(blockIndex - 1, 1);
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
  }

  function assembledText() {
    return (state.assembly?.sections || []).map((section) => {
      const body = (section.blocks || []).map((block) => block.text?.trim()).filter(Boolean).join("\n\n");
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
    $("assembledDraft").value = assembledText();
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
      cacheKey: state.assembly?.cache_key || null,
    };
    try {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
      localStorage.setItem(SOURCE_KEY, draft);
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
