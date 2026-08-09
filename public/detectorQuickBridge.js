(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const OBSERVATION_STORAGE_KEY = "academicVoice.detectorObservations.v1";
  const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
  const ALLOWED_SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg"]);
  const DETECTORS = ["GPTZero", "Turnitin", "Copyleaks", "Originality.ai", "Stealthwriter", "Other"];
  const upstreamFetch = window.fetch.bind(window);
  let latestExtractedObservation = null;

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function detectorOptions({ includeAuto = false } = {}) {
    return `${includeAuto ? '<option value="auto">Auto-detect from screenshot</option>' : ""}${DETECTORS.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}`;
  }

  function loadObservations() {
    try {
      const parsed = JSON.parse(localStorage.getItem(OBSERVATION_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(-20) : [];
    } catch { return []; }
  }

  function saveObservation(observation) {
    const current = loadObservations();
    current.push({
      detector: observation.detector || "Other",
      version: observation.version || null,
      classification: observation.classification || "uncertain",
      aiScore: numberOrNull(observation.aiScore),
      humanScore: numberOrNull(observation.humanScore),
      paraphrasedScore: numberOrNull(observation.paraphrasedScore),
      flaggedSentenceIndices: Array.isArray(observation.flaggedSentenceIndices) ? observation.flaggedSentenceIndices : [],
      notes: observation.notes || null,
      recordedAt: new Date().toISOString(),
    });
    try { localStorage.setItem(OBSERVATION_STORAGE_KEY, JSON.stringify(current.slice(-20))); } catch {}
  }

  function latestObservationSummary() {
    const latest = loadObservations().slice(-1)[0];
    if (!latest) return "No external detector result saved for this browser yet.";
    const bits = [latest.detector || "External detector"];
    if (latest.version) bits.push(latest.version);
    if (Number.isFinite(Number(latest.aiScore))) bits.push(`AI ${latest.aiScore}%`);
    if (Number.isFinite(Number(latest.humanScore))) bits.push(`Human ${latest.humanScore}%`);
    if (Number.isFinite(Number(latest.paraphrasedScore))) bits.push(`Mixed/paraphrased ${latest.paraphrasedScore}%`);
    return bits.join(" · ");
  }

  function formatMetric(value, kind) {
    if (!Number.isFinite(Number(value))) return "n/a";
    if (kind === "ratio") return `${(Number(value) * 100).toFixed(1)}%`;
    return Number(value).toFixed(2);
  }

  function formatDelta(value, kind) {
    if (!Number.isFinite(Number(value))) return "n/a";
    const n = Number(value);
    const prefix = n > 0 ? "+" : "";
    if (kind === "ratio") return `${prefix}${(n * 100).toFixed(1)} pp`;
    return `${prefix}${n.toFixed(2)}`;
  }

  function waitForElement(id, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const element = $(id);
        if (element || Date.now() - started > timeoutMs) {
          clearInterval(timer);
          resolve(element || null);
        }
      }, 80);
    });
  }

  async function openDetectorLab(action = "view") {
    document.querySelector('.tab-header[data-tab="detectorqa"]')?.click();
    if (action === "record") {
      const add = await waitForElement("addDetectorObservationBtn");
      const entry = add?.closest(".research-entry") || document.querySelector("#tab-detectorqa .research-entry");
      if (entry) {
        entry.open = true;
        entry.scrollIntoView({ behavior: "smooth", block: "start" });
        $("manualDetector")?.focus();
      }
    } else if (action === "screenshot") {
      await waitForElement("detectorScreenshotInput");
      $("detectorScreenshotDetector")?.focus();
      $("detectorScreenshotInput")?.closest(".detector-screenshot-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function requestComparison(source, candidate, reason = "manual") {
    if (!source && !candidate) return;
    try {
      const response = await upstreamFetch("/api/detector-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceText: source || "", candidateText: candidate || "", observations: loadObservations() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Comparison failed");
      renderAutomaticComparison(data, reason);
      const status = $("detectorStatus");
      if (status && reason === "rewrite") status.textContent = "Quick source ↔ revised diagnostics refreshed automatically.";
    } catch (err) {
      const status = $("detectorStatus");
      if (status && reason === "rewrite") status.textContent = `Quick comparison could not refresh: ${err.message}`;
    }
  }

  function quickManualMarkup() {
    return `
      <div id="quickDetectorEntry" class="quick-detector-entry" hidden>
        <div class="quick-detector-form-grid">
          <label>Detector<select id="quickDetectorName">${detectorOptions()}</select></label>
          <label>Model/version<input id="quickDetectorVersion" type="text" maxlength="80" placeholder="e.g. Model 4.8b" /></label>
          <label>Classification<select id="quickDetectorClass"><option value="ai">AI</option><option value="ai_paraphrased">AI paraphrased / rewritten</option><option value="mixed">Mixed</option><option value="human">Human</option><option value="uncertain" selected>Uncertain</option></select></label>
          <label>AI %<input id="quickDetectorAi" type="number" min="0" max="100" step="0.1" /></label>
          <label>Human %<input id="quickDetectorHuman" type="number" min="0" max="100" step="0.1" /></label>
          <label>Mixed / paraphrased %<input id="quickDetectorMixed" type="number" min="0" max="100" step="0.1" /></label>
        </div>
        <label class="quick-detector-notes">Notes<input id="quickDetectorNotes" type="text" maxlength="1000" placeholder="e.g. overall label likely human; 3 sentences impacted" /></label>
        <div class="action-row">
          <button id="saveQuickDetectorResult" class="primary" type="button">Save external result</button>
          <button id="cancelQuickDetectorResult" type="button">Cancel</button>
          <span id="quickDetectorSaveStatus" class="file-status"></span>
        </div>
      </div>`;
  }

  function bindQuickManual(compact) {
    compact.querySelector("[data-record-detector-result]")?.addEventListener("click", () => {
      const form = $("quickDetectorEntry");
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) $("quickDetectorName")?.focus();
    });
    $("cancelQuickDetectorResult")?.addEventListener("click", () => { if ($("quickDetectorEntry")) $("quickDetectorEntry").hidden = true; });
    $("saveQuickDetectorResult")?.addEventListener("click", async () => {
      const observation = {
        detector: $("quickDetectorName")?.value || "Other",
        version: $("quickDetectorVersion")?.value.trim() || null,
        classification: $("quickDetectorClass")?.value || "uncertain",
        aiScore: numberOrNull($("quickDetectorAi")?.value),
        humanScore: numberOrNull($("quickDetectorHuman")?.value),
        paraphrasedScore: numberOrNull($("quickDetectorMixed")?.value),
        notes: $("quickDetectorNotes")?.value.trim() || null,
      };
      if (observation.aiScore === null && observation.humanScore === null && observation.paraphrasedScore === null && !observation.notes) {
        if ($("quickDetectorSaveStatus")) $("quickDetectorSaveStatus").textContent = "Enter at least one score or a note before saving.";
        return;
      }
      saveObservation(observation);
      if ($("quickDetectorSaveStatus")) $("quickDetectorSaveStatus").textContent = `Saved ${observation.detector} result.`;
      const source = $("sourceText")?.value || "";
      const revised = $("revisedText")?.value || source;
      await requestComparison(source, revised, "external-result");
    });
    compact.querySelector("[data-open-detector-tab]")?.addEventListener("click", () => openDetectorLab("view"));
    compact.querySelector("[data-upload-detector-result]")?.addEventListener("click", () => openDetectorLab("screenshot"));
  }

  function renderAutomaticComparison(report, reason = "manual") {
    const comparison = report?.comparison;
    if (!comparison) return;
    ensureDetectorEnhancements();
    const target = $("detectorAutoComparison");
    if (target) {
      const rows = (comparison.metrics || []).map((row) => `
        <tr><td>${esc(row.label)}</td><td>${esc(formatMetric(row.source, row.kind))}</td><td>${esc(formatMetric(row.revised, row.kind))}</td><td class="delta-${esc(row.direction)}">${esc(formatDelta(row.delta, row.kind))}</td><td>${esc(formatMetric(comparison.revised_opening_two_paragraphs?.[row.key], row.kind))}</td></tr>`).join("");
      target.innerHTML = `
        <section class="auto-comparison-card">
          <div class="auto-comparison-title"><div><strong>Quick source → revision diagnostics</strong><span>${reason === "rewrite" ? " refreshed automatically after this rewrite" : " current comparison"}</span></div><span class="comparison-badge">before/after · not an authorship score</span></div>
          <p class="muted">The editor and detector remain linked. This lightweight comparison runs after revision without loading the heavier Research & Evidence Studio.</p>
          <table class="research-table comparison-table"><thead><tr><th>Metric</th><th>Source</th><th>Revised</th><th>Change</th><th>Opening 2 prose paragraphs</th></tr></thead><tbody>${rows}</tbody></table>
          ${(comparison.interpretations || []).length ? `<div class="comparison-notes"><strong>What changed:</strong><ul>${comparison.interpretations.map((note) => `<li>${esc(note)}</li>`).join("")}</ul></div>` : ""}
          <p class="muted">${esc(comparison.note || "")}</p>
        </section>`;
    }

    const changes = $("tab-changes");
    if (!changes) return;
    let compact = $("quickDetectorSummary");
    if (!compact) {
      compact = document.createElement("section");
      compact.id = "quickDetectorSummary";
      compact.className = "quick-detector-summary";
      changes.appendChild(compact);
    }
    const candidate = report?.candidate_profiles?.whole_document || {};
    const reference = report?.corpus_reference || {};
    compact.innerHTML = `
      <div><strong>Writing pattern diagnostics</strong><span>linked to the current revision</span></div>
      <div class="quick-detector-grid">
        <span>Mean sentence words <strong>${esc(candidate.mean_sentence_words ?? "n/a")}</strong></span>
        <span>Sentence-length CV <strong>${esc(candidate.sentence_length_cv ?? "n/a")}</strong></span>
        <span>Short sentences <strong>${Number.isFinite(candidate.short_sentence_share) ? `${(candidate.short_sentence_share * 100).toFixed(1)}%` : "n/a"}</strong></span>
        <span>Corpus reference <strong>${esc(reference.evidence_strength || "n/a")}</strong></span>
      </div>
      <div class="external-evidence-quick">
        <div><strong>External detector evidence</strong><span>${esc(latestObservationSummary())}</span></div>
        <div class="action-row">
          <button type="button" data-record-detector-result>+ Add external result</button>
          <button type="button" data-upload-detector-result>+ Upload result screenshot</button>
          <button type="button" data-open-detector-tab>View test history / full lab</button>
        </div>
        ${quickManualMarkup()}
      </div>`;
    bindQuickManual(compact);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the screenshot."));
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const comma = dataUrl.indexOf(",");
        if (comma < 0) return reject(new Error("Could not decode the screenshot."));
        resolve(dataUrl.slice(comma + 1));
      };
      reader.readAsDataURL(file);
    });
  }

  function populateManualObservation(observation) {
    const detectorSelect = $("manualDetector");
    if (detectorSelect) {
      const match = [...detectorSelect.options].find((option) => option.value.toLowerCase() === String(observation.detector || "").toLowerCase());
      detectorSelect.value = match ? match.value : "Other";
    }
    if ($("manualDetectorVersion")) $("manualDetectorVersion").value = observation.version || "";
    if ($("manualDetectorClass")) $("manualDetectorClass").value = observation.classification || "uncertain";
    if ($("manualAiScore")) $("manualAiScore").value = Number.isFinite(Number(observation.aiScore)) ? observation.aiScore : "";
    if ($("manualHumanScore")) $("manualHumanScore").value = Number.isFinite(Number(observation.humanScore)) ? observation.humanScore : "";
    if ($("manualParaphraseScore")) $("manualParaphraseScore").value = Number.isFinite(Number(observation.paraphrasedScore)) ? observation.paraphrasedScore : "";
    if ($("manualFlaggedSentences")) $("manualFlaggedSentences").value = (observation.flaggedSentenceIndices || []).map((n) => Number(n) + 1).join(",");
    if ($("manualDetectorNotes")) $("manualDetectorNotes").value = observation.notes || "";
  }

  function populateQuickObservation(observation) {
    if ($("quickDetectorName")) {
      const known = DETECTORS.includes(observation.detector) ? observation.detector : "Other";
      $("quickDetectorName").value = known;
    }
    if ($("quickDetectorVersion")) $("quickDetectorVersion").value = observation.version || "";
    if ($("quickDetectorClass")) $("quickDetectorClass").value = observation.classification || "uncertain";
    if ($("quickDetectorAi")) $("quickDetectorAi").value = Number.isFinite(Number(observation.aiScore)) ? observation.aiScore : "";
    if ($("quickDetectorHuman")) $("quickDetectorHuman").value = Number.isFinite(Number(observation.humanScore)) ? observation.humanScore : "";
    if ($("quickDetectorMixed")) $("quickDetectorMixed").value = Number.isFinite(Number(observation.paraphrasedScore)) ? observation.paraphrasedScore : "";
    if ($("quickDetectorNotes")) $("quickDetectorNotes").value = observation.notes || "";
  }

  async function saveExtractedObservation() {
    if (!latestExtractedObservation) return;
    saveObservation(latestExtractedObservation);
    const status = $("detectorScreenshotStatus");
    if (status) status.textContent = `${latestExtractedObservation.detector || "Detector"} result saved to external detector evidence.`;
    const source = $("sourceText")?.value || "";
    const revised = $("revisedText")?.value || source;
    await requestComparison(source, revised, "external-screenshot");
  }

  async function analyseDetectorScreenshot() {
    const input = $("detectorScreenshotInput");
    const status = $("detectorScreenshotStatus");
    const preview = $("detectorScreenshotPreview");
    const file = input?.files?.[0];
    if (!file) return void (status && (status.textContent = "Choose one PNG or JPEG screenshot first."));
    if (!ALLOWED_SCREENSHOT_TYPES.has(file.type)) {
      if (status) status.textContent = "Only PNG or JPEG screenshots are accepted.";
      input.value = "";
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      if (status) status.textContent = "Screenshot is larger than 2 MB. Crop/compress the result summary and try again.";
      input.value = "";
      return;
    }
    if (status) status.textContent = "Reading the visible detector summary…";
    try {
      const base64 = await fileToBase64(file);
      const response = await upstreamFetch("/api/detector-screenshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: file.type, imageBase64: base64 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Screenshot analysis failed");
      const observation = { ...(data.observation || {}) };
      const chosenDetector = $("detectorScreenshotDetector")?.value || "auto";
      if (chosenDetector !== "auto") observation.detector = chosenDetector;
      observation.notes = `Screenshot extraction (${observation.confidence || "unknown"} confidence): ${observation.visibleSummary || ""}`.slice(0, 1000);
      latestExtractedObservation = observation;
      populateManualObservation(observation);
      populateQuickObservation(observation);
      if (preview) preview.innerHTML = `
        <div class="screenshot-observation-result">
          <strong>${esc(observation.detector || "Detector result")}</strong>
          ${Number.isFinite(Number(observation.aiScore)) ? `<span>AI ${esc(observation.aiScore)}%</span>` : ""}
          ${Number.isFinite(Number(observation.humanScore)) ? `<span>Human ${esc(observation.humanScore)}%</span>` : ""}
          ${Number.isFinite(Number(observation.paraphrasedScore)) ? `<span>Mixed/paraphrased ${esc(observation.paraphrasedScore)}%</span>` : ""}
          <p>${esc(observation.visibleSummary || "")}</p>
          <button id="saveExtractedDetectorResultBtn" class="primary" type="button">Save extracted result</button>
        </div>`;
      $("saveExtractedDetectorResultBtn")?.addEventListener("click", saveExtractedObservation);
      if (status) status.textContent = "Screenshot read. Review the extracted values, then click Save extracted result.";
    } catch (err) {
      if (status) status.textContent = `Screenshot analysis failed: ${err.message}`;
    }
  }

  function ensureDetectorEnhancements() {
    const panel = $("tab-detectorqa");
    if (!panel) return;
    if (!$("detectorAutoComparison")) {
      const comparison = document.createElement("div");
      comparison.id = "detectorAutoComparison";
      const results = $("detectorResearchResults");
      if (results) panel.insertBefore(comparison, results);
      else panel.appendChild(comparison);
    }
    if (!$("detectorScreenshotInput")) {
      const manual = panel.querySelector(".research-entry");
      const box = document.createElement("section");
      box.className = "detector-screenshot-card";
      box.innerHTML = `
        <h4>Upload one detector-result screenshot</h4>
        <p class="muted">Choose the detector explicitly or leave Auto-detect selected, then upload one PNG/JPEG summary screenshot (maximum 2 MB). Upload the result summary screen, not a Turnitin report/PDF.</p>
        <div class="detector-screenshot-controls">
          <label>Detector shown in screenshot<select id="detectorScreenshotDetector">${detectorOptions({ includeAuto: true })}</select></label>
          <label class="file-button" for="detectorScreenshotInput">Choose detector screenshot</label>
          <input id="detectorScreenshotInput" class="visually-hidden" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" />
          <button id="analyseDetectorScreenshotBtn" type="button">Read screenshot</button>
          <span id="detectorScreenshotStatus" class="file-status">No image selected.</span>
        </div>
        <div id="detectorScreenshotPreview"></div>`;
      if (manual) panel.insertBefore(box, manual); else panel.prepend(box);
      $("detectorScreenshotInput")?.addEventListener("change", () => {
        const file = $("detectorScreenshotInput")?.files?.[0];
        if ($("detectorScreenshotStatus")) $("detectorScreenshotStatus").textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : "No image selected.";
      });
      $("analyseDetectorScreenshotBtn")?.addEventListener("click", analyseDetectorScreenshot);
    }
  }

  window.fetch = async function detectorQuickBridgeFetch(input, init) {
    const response = await upstreamFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (/\/api\/rewrite(?:\?|$)/.test(url) && response.ok) {
      response.clone().json().then((data) => {
        const source = $("sourceText")?.value || "";
        const revised = data.revised_text || $("revisedText")?.value || "";
        window.setTimeout(() => requestComparison(source, revised, "rewrite"), 50);
      }).catch(() => {});
    }
    if (/\/api\/detector-research(?:\?|$)/.test(url) && response.ok) {
      response.clone().json().then((data) => renderAutomaticComparison(data, "manual")).catch(() => {});
    }
    return response;
  };

  const style = document.createElement("style");
  style.textContent = `
    .auto-comparison-card,.detector-screenshot-card,.quick-detector-summary{margin:1rem 0;padding:1rem;border:1px solid #405269;border-radius:10px;background:rgba(22,31,44,.42)}
    .auto-comparison-title{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}.auto-comparison-title>div{display:flex;gap:.5rem;align-items:baseline;flex-wrap:wrap}.auto-comparison-title span{opacity:.72;font-size:.86em}.comparison-badge{border:1px solid #52617a;border-radius:999px;padding:.25rem .55rem}
    .comparison-table{width:100%;border-collapse:collapse}.comparison-table th,.comparison-table td{padding:.55rem;border-bottom:1px solid #405269;text-align:left}.comparison-table td:nth-child(n+2){font-variant-numeric:tabular-nums}.delta-up::before{content:"↑ ";opacity:.65}.delta-down::before{content:"↓ ";opacity:.65}.delta-same::before{content:"→ ";opacity:.65}
    .comparison-notes{margin-top:.8rem}.comparison-notes ul{margin:.35rem 0 .2rem 1.2rem}.screenshot-observation-result{display:flex;gap:.7rem;flex-wrap:wrap;align-items:center;margin-top:.7rem;padding:.75rem;border-left:3px solid #5d79a4;background:rgba(5,11,18,.32)}.screenshot-observation-result p{flex:1 0 100%}
    .quick-detector-summary>div:first-child{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.quick-detector-summary>div:first-child span{opacity:.68}.quick-detector-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.5rem!important;margin:.7rem 0}.quick-detector-grid span{padding:.5rem;background:rgba(4,10,18,.35);border-radius:6px}.quick-detector-grid strong{display:block;margin-top:.2rem}.external-evidence-quick{margin-top:.8rem;padding-top:.8rem;border-top:1px solid #405269}.external-evidence-quick>div:first-child{display:flex;gap:.7rem;align-items:baseline;flex-wrap:wrap}.external-evidence-quick>div:first-child span{opacity:.72}
    .quick-detector-entry{margin-top:.7rem;padding:.75rem;border:1px solid #405269;border-radius:8px;background:rgba(5,11,18,.3)}.quick-detector-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:.6rem}.quick-detector-entry label,.detector-screenshot-controls label:not(.file-button){display:flex;flex-direction:column;gap:.25rem}.quick-detector-entry select,.quick-detector-entry input,.detector-screenshot-controls select{min-height:38px;padding:.4rem .5rem;border:1px solid #4d5d70;border-radius:6px;background:#0f1216;color:#e6e9ee}.quick-detector-notes{display:flex!important;margin:.65rem 0}.detector-screenshot-controls{display:flex;align-items:end;gap:.65rem;flex-wrap:wrap;margin-top:.7rem}.detector-screenshot-controls>label:first-child{min-width:230px}.detector-screenshot-controls .file-button{min-height:38px;margin:0}.detector-screenshot-controls button{min-height:38px}
    @media(max-width:800px){.comparison-table{display:block;overflow-x:auto}.auto-comparison-title{align-items:flex-start}.detector-screenshot-controls{display:grid;grid-template-columns:1fr}.detector-screenshot-controls>label:first-child{min-width:0}}
  `;
  document.head.appendChild(style);
  ensureDetectorEnhancements();
})();
