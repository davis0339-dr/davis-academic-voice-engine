(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const OBSERVATION_STORAGE_KEY = "academicVoice.detectorObservations.v1";
  const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
  const ALLOWED_SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg"]);
  const upstreamFetch = window.fetch.bind(window);
  let voiceRecognition = null;
  let voiceFinalTranscript = "";

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function loadObservations() {
    try {
      const parsed = JSON.parse(localStorage.getItem(OBSERVATION_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(-20) : [];
    } catch {
      return [];
    }
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

  function renderAutomaticComparison(report, reason = "manual") {
    const comparison = report?.comparison;
    if (!comparison) return;
    ensureDetectorEnhancements();
    const target = $("detectorAutoComparison");
    if (!target) return;
    const rows = (comparison.metrics || []).map((row) => `
      <tr>
        <td>${esc(row.label)}</td>
        <td>${esc(formatMetric(row.source, row.kind))}</td>
        <td>${esc(formatMetric(row.revised, row.kind))}</td>
        <td class="delta-${esc(row.direction)}">${esc(formatDelta(row.delta, row.kind))}</td>
        <td>${esc(formatMetric(comparison.revised_opening_two_paragraphs?.[row.key], row.kind))}</td>
      </tr>`).join("");
    target.innerHTML = `
      <section class="auto-comparison-card">
        <div class="auto-comparison-title">
          <div><strong>Automatic original → revised comparison</strong><span>${reason === "rewrite" ? " refreshed after this rewrite" : " current comparison"}</span></div>
          <span class="comparison-badge">before/after · not an authorship score</span>
        </div>
        <p class="muted">This compares the exact Source text with the current Revised candidate. External Turnitin/GPTZero/etc. observations are shown separately and never converted into a hidden generation target.</p>
        <table class="research-table comparison-table">
          <thead><tr><th>Metric</th><th>Original source</th><th>Revised candidate</th><th>Change</th><th>Revised opening 2 prose paragraphs</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${(comparison.interpretations || []).length ? `<div class="comparison-notes"><strong>What changed:</strong><ul>${comparison.interpretations.map((note) => `<li>${esc(note)}</li>`).join("")}</ul></div>` : ""}
        <p class="muted">${esc(comparison.note || "")}</p>
      </section>`;
  }

  async function requestComparison(source, candidate, reason = "manual") {
    if (!source && !candidate) return;
    try {
      const response = await upstreamFetch("/api/detector-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceText: source || "",
          candidateText: candidate || "",
          observations: loadObservations(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Comparison failed");
      renderAutomaticComparison(data, reason);
      const status = $("detectorStatus");
      if (status && reason === "rewrite") status.textContent = "Source ↔ revised comparison refreshed automatically.";
    } catch (err) {
      const status = $("detectorStatus");
      if (status && reason === "rewrite") status.textContent = `Automatic comparison could not refresh: ${err.message}`;
    }
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
      const known = [...detectorSelect.options].some((option) => option.value.toLowerCase() === String(observation.detector || "").toLowerCase());
      detectorSelect.value = known ? [...detectorSelect.options].find((option) => option.value.toLowerCase() === String(observation.detector || "").toLowerCase()).value : "Other";
    }
    if ($("manualDetectorVersion")) $("manualDetectorVersion").value = observation.version || "";
    if ($("manualDetectorClass")) $("manualDetectorClass").value = observation.classification || "uncertain";
    if ($("manualAiScore")) $("manualAiScore").value = Number.isFinite(Number(observation.aiScore)) ? observation.aiScore : "";
    if ($("manualHumanScore")) $("manualHumanScore").value = Number.isFinite(Number(observation.humanScore)) ? observation.humanScore : "";
    if ($("manualParaphraseScore")) $("manualParaphraseScore").value = Number.isFinite(Number(observation.paraphrasedScore)) ? observation.paraphrasedScore : "";
    if ($("manualFlaggedSentences")) $("manualFlaggedSentences").value = (observation.flaggedSentenceIndices || []).map((n) => Number(n) + 1).join(",");
    if ($("manualDetectorNotes")) $("manualDetectorNotes").value = `Screenshot extraction (${observation.confidence || "unknown"} confidence): ${observation.visibleSummary || ""}`.slice(0, 1000);
  }

  async function analyseDetectorScreenshot() {
    const input = $("detectorScreenshotInput");
    const status = $("detectorScreenshotStatus");
    const preview = $("detectorScreenshotPreview");
    const file = input?.files?.[0];
    if (!file) {
      if (status) status.textContent = "Choose one PNG or JPEG screenshot first.";
      return;
    }
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
      const observation = data.observation || {};
      populateManualObservation(observation);
      if (preview) {
        preview.innerHTML = `
          <div class="screenshot-observation-result">
            <strong>${esc(observation.detector || "Detector result")}</strong>
            ${Number.isFinite(Number(observation.aiScore)) ? `<span>AI ${esc(observation.aiScore)}%</span>` : ""}
            ${Number.isFinite(Number(observation.humanScore)) ? `<span>Human ${esc(observation.humanScore)}%</span>` : ""}
            ${Number.isFinite(Number(observation.paraphrasedScore)) ? `<span>Paraphrased ${esc(observation.paraphrasedScore)}%</span>` : ""}
            <p>${esc(observation.visibleSummary || "")}</p>
            ${(observation.warnings || []).length ? `<p class="muted">${observation.warnings.map(esc).join(" · ")}</p>` : ""}
          </div>`;
      }
      if (status) status.textContent = "Screenshot read. The extracted values were loaded into the observation form; review them, then save the observation.";
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
        <p class="muted">Optional shortcut for a result summary from Turnitin, GPTZero or another detector. One PNG/JPEG only, maximum 2 MB. Upload the summary screen, not a Turnitin report/PDF. Davis extracts only visible scores/labels so you do not have to count highlighted words manually.</p>
        <div class="file-toolbar">
          <label class="file-button" for="detectorScreenshotInput">Choose detector screenshot</label>
          <input id="detectorScreenshotInput" class="visually-hidden" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" />
          <button id="analyseDetectorScreenshotBtn" type="button">Read screenshot</button>
          <span id="detectorScreenshotStatus" class="file-status">No image selected.</span>
        </div>
        <div id="detectorScreenshotPreview"></div>
        <p class="muted">Privacy: the image is request-scoped and is not stored by Davis. Screenshot observations remain research evidence and are not automatically fed back into manuscript generation.</p>`;
      if (manual) panel.insertBefore(box, manual);
      else panel.prepend(box);
      $("detectorScreenshotInput")?.addEventListener("change", () => {
        const file = $("detectorScreenshotInput")?.files?.[0];
        if ($("detectorScreenshotStatus")) $("detectorScreenshotStatus").textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : "No image selected.";
      });
      $("analyseDetectorScreenshotBtn")?.addEventListener("click", analyseDetectorScreenshot);
    }
  }

  function voiceStatus(message, isError = false) {
    const el = $("voiceReasoningStatus");
    if (!el) return;
    el.textContent = message;
    el.className = isError ? "file-status voice-error" : "file-status";
  }

  function stopVoiceReasoning() {
    try { voiceRecognition?.stop(); } catch {}
  }

  function startVoiceReasoning() {
    if (!$("voiceReasoningConsent")?.checked) {
      voiceStatus("Confirm the microphone/privacy notice before recording.", true);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      voiceStatus("Voice transcription is not supported by this browser. You can still type your reasoning normally.", true);
      return;
    }
    voiceFinalTranscript = $("voiceReasoningTranscript")?.value.trim() || "";
    const recognition = new SpeechRecognition();
    voiceRecognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en";
    recognition.onstart = () => {
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = true;
      if ($("stopVoiceReasoningBtn")) $("stopVoiceReasoningBtn").disabled = false;
      voiceStatus("Listening… speak naturally. You can edit the transcript before using it.");
    };
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) voiceFinalTranscript = `${voiceFinalTranscript} ${text}`.trim();
        else interim += text;
      }
      const transcript = $("voiceReasoningTranscript");
      if (transcript) transcript.value = `${voiceFinalTranscript}${interim ? ` ${interim}` : ""}`.trim();
    };
    recognition.onerror = (event) => voiceStatus(`Voice capture stopped: ${event.error || "speech recognition error"}.`, true);
    recognition.onend = () => {
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = false;
      if ($("stopVoiceReasoningBtn")) $("stopVoiceReasoningBtn").disabled = true;
      if (!$("voiceReasoningStatus")?.classList.contains("voice-error")) voiceStatus("Voice capture stopped. Review the transcript before adding it to your reasoning.");
      voiceRecognition = null;
    };
    try { recognition.start(); } catch (err) { voiceStatus(`Could not start microphone capture: ${err.message}`, true); }
  }

  function addVoiceTranscriptToThoughts() {
    const transcript = $("voiceReasoningTranscript")?.value.trim() || "";
    const thoughts = $("researcherThoughts");
    if (!transcript || !thoughts) return voiceStatus("There is no transcript to add yet.", true);
    thoughts.value = `${thoughts.value.trim()}${thoughts.value.trim() ? "\n\n" : ""}${transcript}`;
    thoughts.dispatchEvent(new Event("input", { bubbles: true }));
    voiceStatus("Transcript added to your reasoning box. Edit it freely before building the argument map.");
  }

  function ensureVoiceReasoning() {
    const thoughts = $("researcherThoughts");
    if (!thoughts || $("voiceReasoningBox")) return;
    const box = document.createElement("div");
    box.id = "voiceReasoningBox";
    box.className = "voice-reasoning-box";
    box.innerHTML = `
      <div class="voice-reasoning-head"><strong>Voice Reasoning</strong><span>optional</span></div>
      <p class="muted">Explain the idea aloud before academic reconstruction. Davis does not store raw audio. Browser speech recognition may send audio to your browser/vendor speech service; only continue if you accept that processing. The transcript stays editable and is not added to your argument map until you choose to use it.</p>
      <label class="research-check"><input id="voiceReasoningConsent" type="checkbox" /> I understand and want to enable microphone transcription for this session.</label>
      <div class="action-row">
        <button id="startVoiceReasoningBtn" type="button" disabled>Start speaking</button>
        <button id="stopVoiceReasoningBtn" type="button" disabled>Stop</button>
        <button id="addVoiceTranscriptBtn" type="button">Add transcript to my reasoning</button>
        <button id="clearVoiceTranscriptBtn" type="button">Clear transcript</button>
      </div>
      <textarea id="voiceReasoningTranscript" rows="5" placeholder="Your editable voice transcript will appear here…"></textarea>
      <span id="voiceReasoningStatus" class="file-status">Microphone is off.</span>`;
    thoughts.insertAdjacentElement("afterend", box);
    $("voiceReasoningConsent")?.addEventListener("change", () => {
      const enabled = Boolean($("voiceReasoningConsent")?.checked);
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = !enabled;
      if (!enabled) stopVoiceReasoning();
    });
    $("startVoiceReasoningBtn")?.addEventListener("click", startVoiceReasoning);
    $("stopVoiceReasoningBtn")?.addEventListener("click", stopVoiceReasoning);
    $("addVoiceTranscriptBtn")?.addEventListener("click", addVoiceTranscriptToThoughts);
    $("clearVoiceTranscriptBtn")?.addEventListener("click", () => {
      stopVoiceReasoning();
      voiceFinalTranscript = "";
      if ($("voiceReasoningTranscript")) $("voiceReasoningTranscript").value = "";
      voiceStatus("Transcript cleared. Microphone is off.");
    });
  }

  window.fetch = async function researchEnhancedFetch(input, init) {
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
    .auto-comparison-card,.detector-screenshot-card,.voice-reasoning-box{margin:1rem 0;padding:1rem;border:1px solid #405269;border-radius:10px;background:rgba(22,31,44,.42)}
    .auto-comparison-title{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}.auto-comparison-title>div{display:flex;gap:.5rem;align-items:baseline;flex-wrap:wrap}.auto-comparison-title span{opacity:.72;font-size:.86em}.comparison-badge{border:1px solid #52617a;border-radius:999px;padding:.25rem .55rem}
    .comparison-table{width:100%;border-collapse:collapse}.comparison-table th,.comparison-table td{padding:.55rem;border-bottom:1px solid #405269;text-align:left}.comparison-table td:nth-child(n+2){font-variant-numeric:tabular-nums}.delta-up::before{content:"↑ ";opacity:.65}.delta-down::before{content:"↓ ";opacity:.65}.delta-same::before{content:"→ ";opacity:.65}
    .comparison-notes{margin-top:.8rem}.comparison-notes ul{margin:.35rem 0 .2rem 1.2rem}
    .screenshot-observation-result{display:flex;gap:.7rem;flex-wrap:wrap;align-items:center;margin-top:.7rem;padding:.75rem;border-left:3px solid #5d79a4;background:rgba(5,11,18,.32)}.screenshot-observation-result p{flex-basis:100%;margin:.1rem 0}
    .voice-reasoning-box{margin:.7rem 0}.voice-reasoning-head{display:flex;justify-content:space-between;gap:1rem}.voice-reasoning-head span{opacity:.65}.voice-reasoning-box textarea{width:100%;box-sizing:border-box}.voice-error{color:#d66}
    @media(max-width:800px){.comparison-table{display:block;overflow-x:auto}.auto-comparison-title{align-items:flex-start}}
  `;
  document.head.appendChild(style);

  ensureDetectorEnhancements();
  ensureVoiceReasoning();
  const observer = new MutationObserver(() => {
    ensureDetectorEnhancements();
    ensureVoiceReasoning();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
