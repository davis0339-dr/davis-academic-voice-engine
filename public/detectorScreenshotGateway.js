(() => {
  "use strict";

  const STORAGE_KEY = "academicVoice.detectorObservations.v1";
  const MAX_BYTES = 2 * 1024 * 1024;
  const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);
  let pendingFile = null;
  let extractedObservation = null;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  function status(message, isError = false) {
    const el = $("detectorScreenshotStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", Boolean(isError));
    el.classList.toggle("ready", !isError && Boolean(message));
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the screenshot."));
      reader.onload = () => {
        const text = String(reader.result || "");
        const comma = text.indexOf(",");
        if (comma < 0) return reject(new Error("Could not decode the screenshot."));
        resolve(text.slice(comma + 1));
      };
      reader.readAsDataURL(file);
    });
  }

  function validateFile(file) {
    if (!file) throw new Error("Choose one PNG or JPEG detector-result screenshot first.");
    if (!ALLOWED_TYPES.has(file.type)) throw new Error("Only PNG or JPEG screenshots are accepted.");
    if (file.size > MAX_BYTES) throw new Error("Screenshot is larger than 2 MB. Crop or compress the visible result summary and try again.");
    return file;
  }

  function acceptFile(file) {
    try {
      pendingFile = validateFile(file);
      status(`Selected: ${pendingFile.name} · ${(pendingFile.size / 1024).toFixed(0)} KB. Press “Read selected screenshot”.`);
      const drop = $("detectorScreenshotDropZone");
      if (drop) drop.dataset.hasFile = "true";
    } catch (err) {
      pendingFile = null;
      status(err.message, true);
    }
  }

  function loadObservations() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(-20) : [];
    } catch { return []; }
  }

  function saveObservation(observation) {
    const rows = loadObservations();
    const row = {
      detector: observation.detector || "Other",
      version: observation.version || null,
      classification: observation.classification || "uncertain",
      aiScore: Number.isFinite(Number(observation.aiScore)) ? Number(observation.aiScore) : null,
      humanScore: Number.isFinite(Number(observation.humanScore)) ? Number(observation.humanScore) : null,
      paraphrasedScore: Number.isFinite(Number(observation.paraphrasedScore)) ? Number(observation.paraphrasedScore) : null,
      flaggedSentenceIndices: Array.isArray(observation.flaggedSentenceIndices) ? observation.flaggedSentenceIndices : [],
      flaggedExcerpts: Array.isArray(observation.flaggedExcerpts) ? observation.flaggedExcerpts : [],
      notes: observation.notes || null,
      recordedAt: new Date().toISOString(),
      evidenceSource: "uploaded_detector_screenshot",
    };
    rows.push(window.AcademicRewriteLineage?.annotateObservation
      ? window.AcademicRewriteLineage.annotateObservation(row, $("revisedText")?.value || "")
      : row);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-20))); } catch {}
  }

  function populateManualForm(observation) {
    const detector = $("manualDetector");
    if (detector) {
      const option = [...detector.options].find((row) => row.value.toLowerCase() === String(observation.detector || "").toLowerCase());
      detector.value = option ? option.value : "Other";
    }
    if ($("manualDetectorVersion")) $("manualDetectorVersion").value = observation.version || "";
    if ($("manualDetectorClass")) $("manualDetectorClass").value = observation.classification || "uncertain";
    if ($("manualAiScore")) $("manualAiScore").value = Number.isFinite(Number(observation.aiScore)) ? observation.aiScore : "";
    if ($("manualHumanScore")) $("manualHumanScore").value = Number.isFinite(Number(observation.humanScore)) ? observation.humanScore : "";
    if ($("manualParaphraseScore")) $("manualParaphraseScore").value = Number.isFinite(Number(observation.paraphrasedScore)) ? observation.paraphrasedScore : "";
    if ($("manualDetectorNotes")) $("manualDetectorNotes").value = observation.notes || "";
  }

  function renderExtracted(observation) {
    const preview = $("detectorScreenshotPreview");
    if (!preview) return;
    preview.innerHTML = `
      <div class="detector-gateway-result">
        <div><strong>${esc(observation.detector || "Detector result")}</strong><span>${esc(observation.classification || "uncertain")}</span></div>
        <div class="detector-gateway-metrics">
          ${Number.isFinite(Number(observation.aiScore)) ? `<span>AI <strong>${esc(observation.aiScore)}%</strong></span>` : ""}
          ${Number.isFinite(Number(observation.humanScore)) ? `<span>Human <strong>${esc(observation.humanScore)}%</strong></span>` : ""}
          ${Number.isFinite(Number(observation.paraphrasedScore)) ? `<span>Mixed/paraphrased <strong>${esc(observation.paraphrasedScore)}%</strong></span>` : ""}
        </div>
        ${observation.visibleSummary ? `<p>${esc(observation.visibleSummary)}</p>` : ""}
        <button id="saveGatewayDetectorResultBtn" class="primary" type="button">Save this external result</button>
      </div>`;
    $("saveGatewayDetectorResultBtn")?.addEventListener("click", () => {
      if (!extractedObservation) return;
      saveObservation(extractedObservation);
      populateManualForm(extractedObservation);
      status(`${extractedObservation.detector || "Detector"} result saved to this browser's external detector evidence.`);
      window.dispatchEvent(new CustomEvent("academicVoice:detector-observation-saved", { detail: extractedObservation }));
    });
  }

  async function analyseSelected() {
    try {
      const file = validateFile(pendingFile || $("detectorScreenshotInput")?.files?.[0]);
      pendingFile = file;
      status("Reading the visible detector summary…");
      const imageBase64 = await fileToBase64(file);
      const response = await fetch("/api/detector-screenshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: file.type, imageBase64 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Screenshot analysis failed.");
      const observation = { ...(data.observation || {}) };
      const selectedDetector = $("detectorScreenshotDetector")?.value || "auto";
      if (selectedDetector !== "auto") observation.detector = selectedDetector;
      observation.notes = `Screenshot extraction (${observation.confidence || "unknown"} confidence): ${observation.visibleSummary || ""}`.slice(0, 1000);
      extractedObservation = observation;
      populateManualForm(observation);
      renderExtracted(observation);
      status("Screenshot read. Verify the extracted values, then save the external result.");
    } catch (err) {
      status(err.message || "Screenshot analysis failed.", true);
    }
  }

  function openPicker() {
    document.querySelector('.tab-header[data-tab="detectorqa"]')?.click();
    const input = $("detectorScreenshotInput");
    if (input) {
      $("detectorScreenshotGateway")?.scrollIntoView({ behavior: "smooth", block: "start" });
      input.click();
    }
  }

  function bind() {
    const input = $("detectorScreenshotInput");
    const choose = $("chooseDetectorEvidenceScreenshotBtn");
    const read = $("analyseDetectorScreenshotBtn");
    const drop = $("detectorScreenshotDropZone");
    if (!input || !choose || !read || !drop) return;

    choose.addEventListener("click", openPicker);
    input.addEventListener("change", () => acceptFile(input.files?.[0]));
    read.addEventListener("click", analyseSelected);

    ["dragenter", "dragover"].forEach((eventName) => drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((eventName) => drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.remove("dragging");
    }));
    drop.addEventListener("drop", (event) => acceptFile(event.dataTransfer?.files?.[0]));
    drop.addEventListener("click", openPicker);
    drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPicker(); }
    });
    drop.addEventListener("paste", (event) => {
      const item = [...(event.clipboardData?.items || [])].find((row) => row.type === "image/png" || row.type === "image/jpeg");
      if (!item) return status("Clipboard does not contain a PNG/JPEG screenshot.", true);
      event.preventDefault();
      acceptFile(item.getAsFile());
    });

    // This is intentionally delegated: the compact “Upload result screenshot”
    // button is created later after a rewrite. It must still open a real device
    // picker without depending on an optional enhancer having mounted correctly.
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-upload-detector-result]");
      if (!button) return;
      event.preventDefault();
      openPicker();
    });
  }

  const style = document.createElement("style");
  style.textContent = `
    #detectorScreenshotGateway{margin:1rem 0;padding:1rem;border:1px solid #4c647d;border-radius:10px;background:rgba(17,27,40,.62)}
    .detector-gateway-title{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}.detector-gateway-version{font-size:.76rem;border:1px solid #5f7590;border-radius:999px;padding:.2rem .5rem;opacity:.8}
    .detector-gateway-controls{display:grid;grid-template-columns:minmax(220px,1fr) minmax(260px,1.2fr) auto auto;gap:.7rem;align-items:end;margin:.8rem 0}.detector-gateway-controls label{display:grid;gap:.35rem}.detector-gateway-controls input[type=file],.detector-gateway-controls select{width:100%;min-height:44px}
    #detectorScreenshotDropZone{padding:1rem;border:1px dashed #66809e;border-radius:8px;text-align:center;cursor:pointer;background:rgba(4,10,18,.35)}#detectorScreenshotDropZone.dragging{border-style:solid;background:rgba(45,112,91,.18)}#detectorScreenshotDropZone[data-has-file="true"]{border-color:#62e0b0}
    .detector-gateway-result{margin-top:.8rem;padding:.8rem;border:1px solid #405269;border-radius:8px}.detector-gateway-result>div:first-child{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.detector-gateway-metrics{display:flex;gap:.6rem;flex-wrap:wrap;margin:.6rem 0}.detector-gateway-metrics span{padding:.35rem .55rem;border:1px solid #405269;border-radius:6px}
    @media(max-width:900px){.detector-gateway-controls{grid-template-columns:1fr}.detector-gateway-controls button{width:100%}}
  `;
  document.head.appendChild(style);

  window.DetectorScreenshotGateway = { openPicker, analyseSelected };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
