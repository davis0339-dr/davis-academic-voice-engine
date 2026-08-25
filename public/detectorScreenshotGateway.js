(() => {
  "use strict";

  const STORAGE_KEY = "academicVoice.detectorObservations.v1";
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const MAX_PDF_BYTES = 5 * 1024 * 1024;
  const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "application/pdf"]);
  const MAX_FILES = 6;
  let pendingFiles = [];
  let extractedObservations = [];

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
      reader.onerror = () => reject(new Error("Could not read the detector report file."));
      reader.onload = () => {
        const text = String(reader.result || "");
        const comma = text.indexOf(",");
        if (comma < 0) return reject(new Error("Could not decode the detector report file."));
        resolve(text.slice(comma + 1));
      };
      reader.readAsDataURL(file);
    });
  }

  function normaliseMimeType(file) {
    if (file?.type) return file.type;
    return /\.pdf$/i.test(file?.name || "") ? "application/pdf" : "";
  }

  function validateFile(file) {
    if (!file) throw new Error("Choose at least one PNG, JPEG or PDF detector-result file first.");
    const mimeType = normaliseMimeType(file);
    if (!ALLOWED_TYPES.has(mimeType)) throw new Error("Only PNG/JPEG screenshots and PDF detector reports are accepted.");
    const maximumBytes = mimeType === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maximumBytes) throw new Error(mimeType === "application/pdf"
      ? "PDF report is larger than 5 MB. Download a smaller report or split it before uploading."
      : "Screenshot is larger than 2 MB. Crop or compress the visible result summary and try again.");
    return { file, mimeType };
  }

  function acceptFiles(files) {
    try {
      const selected = [...(files || [])].slice(0, MAX_FILES).map(validateFile);
      if (!selected.length) throw new Error("Choose at least one PNG, JPEG or PDF detector-result file first.");
      pendingFiles = selected;
      const calls = pendingFiles.length;
      status(`Selected ${calls} detector report file${calls === 1 ? "" : "s"}. Reading them will use ${calls} provider call${calls === 1 ? "" : "s"}.`);
      const drop = $("detectorScreenshotDropZone");
      if (drop) drop.dataset.hasFile = "true";
    } catch (err) {
      pendingFiles = [];
      status(err.message, true);
    }
  }

  function canonicalDetector(value) {
    const text = String(value || "").trim();
    const lower = text.toLowerCase();
    if (lower.includes("gptzero")) return "GPTZero";
    if (lower.includes("turnitin")) return "Turnitin";
    if (lower.includes("copyleaks")) return "Copyleaks";
    if (lower.includes("originality")) return "Originality.ai";
    if (lower.includes("stealthwriter")) return "Stealthwriter";
    return text || "Other";
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
      detector: canonicalDetector(observation.detector),
      version: observation.version || null,
      classification: observation.classification || "uncertain",
      aiScore: Number.isFinite(Number(observation.aiScore)) ? Number(observation.aiScore) : null,
      humanScore: Number.isFinite(Number(observation.humanScore)) ? Number(observation.humanScore) : null,
      paraphrasedScore: Number.isFinite(Number(observation.paraphrasedScore)) ? Number(observation.paraphrasedScore) : null,
      flaggedSentenceIndices: Array.isArray(observation.flaggedSentenceIndices) ? observation.flaggedSentenceIndices : [],
      flaggedExcerpts: Array.isArray(observation.flaggedExcerpts) ? observation.flaggedExcerpts : [],
      highlightedPassages: Array.isArray(observation.highlightedPassages) ? observation.highlightedPassages : [],
      notes: observation.notes || null,
      recordedAt: new Date().toISOString(),
      evidenceSource: "uploaded_detector_report",
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

  function renderExtracted(observations) {
    const preview = $("detectorScreenshotPreview");
    if (!preview) return;
    preview.innerHTML = observations.map((observation, index) => `
      <div class="detector-gateway-result">
        <div><strong>${esc(observation.detector || "Detector result")} · report file ${index + 1}</strong><span>${esc(observation.classification || "uncertain")}</span></div>
        <div class="detector-gateway-metrics">
          ${Number.isFinite(Number(observation.aiScore)) ? `<span>AI <strong>${esc(observation.aiScore)}%</strong></span>` : ""}
          ${Number.isFinite(Number(observation.humanScore)) ? `<span>Human <strong>${esc(observation.humanScore)}%</strong></span>` : ""}
          ${Number.isFinite(Number(observation.paraphrasedScore)) ? `<span>Mixed/paraphrased <strong>${esc(observation.paraphrasedScore)}%</strong></span>` : ""}
        </div>
        ${observation.visibleSummary ? `<p>${esc(observation.visibleSummary)}</p>` : ""}
        ${Array.isArray(observation.highlightedPassages) && observation.highlightedPassages.length
          ? `<details><summary>${esc(observation.highlightedPassages.length)} colour-coded passage(s) extracted</summary><ul>${observation.highlightedPassages.slice(0, 30).map((passage) => `<li><strong>${esc(passage.classification || "uncertain")}</strong>${passage.colour ? ` · ${esc(passage.colour)}` : ""}${passage.page ? ` · page ${esc(passage.page)}` : ""}: “${esc(passage.text)}”</li>`).join("")}</ul></details>`
          : '<p class="warning-text">No sentence-level colour passages were extracted. This file currently supplies only document-level evidence and cannot guide local targeting.</p>'}
      </div>`).join("") + '<button id="saveGatewayDetectorResultsBtn" class="primary" type="button">Save and link this evidence bundle</button>';
    $("saveGatewayDetectorResultsBtn")?.addEventListener("click", () => {
      if (!extractedObservations.length) return;
      const candidateText = $("revisedText")?.value || "";
      const preflight = window.AcademicRewriteLineage?.refinementPreflight?.(candidateText);
      if (!preflight?.exact_candidate) {
        status("This evidence cannot be linked because the Revised box no longer contains the exact retained candidate. Restore that revision from version history, then save again.", true);
        return;
      }
      extractedObservations.forEach(saveObservation);
      populateManualForm(extractedObservations[extractedObservations.length - 1]);
      status(`Saved and linked ${extractedObservations.length} detector observation${extractedObservations.length === 1 ? "" : "s"} to the exact revision currently shown. The feedback-guided refinement preflight is now ready.`);
      window.dispatchEvent(new CustomEvent("academicVoice:detector-observation-saved", { detail: { observations: extractedObservations } }));
      const button = $("saveGatewayDetectorResultsBtn");
      if (button) { button.disabled = true; button.textContent = "Evidence bundle saved and linked"; }
    });
  }

  function resetForNewCandidate() {
    if (!extractedObservations.length && !pendingFiles.length) return;
    extractedObservations = [];
    pendingFiles = [];
    const preview = $("detectorScreenshotPreview");
    if (preview) preview.innerHTML = "";
    const input = $("detectorScreenshotInput");
    if (input) input.value = "";
    const drop = $("detectorScreenshotDropZone");
    if (drop) delete drop.dataset.hasFile;
    status("A new revision is now shown. Evidence saved for the previous revision was consumed there; test and upload the new revision before another refinement.");
  }

  async function analyseSelected() {
    try {
      const selected = pendingFiles.length ? pendingFiles : [...($("detectorScreenshotInput")?.files || [])].slice(0, MAX_FILES).map(validateFile);
      if (!selected.length) throw new Error("Choose at least one PNG, JPEG or PDF detector-result file first.");
      extractedObservations = [];
      for (let index = 0; index < selected.length; index += 1) {
        const { file, mimeType } = selected[index];
        status(`Reading detector file ${index + 1} of ${selected.length}…`);
        const imageBase64 = await fileToBase64(file);
        const response = await fetch("/api/detector-screenshot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mimeType, fileBase64: imageBase64 }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`Detector file ${index + 1}: ${data.message || data.error || "analysis failed"}`);
        const observation = { ...(data.observation || {}) };
        const selectedDetector = $("detectorScreenshotDetector")?.value || "auto";
        observation.detector = selectedDetector !== "auto" ? selectedDetector : canonicalDetector(observation.detector);
        observation.notes = `${mimeType === "application/pdf" ? "PDF report" : "Screenshot"} extraction (${observation.confidence || "unknown"} confidence): ${observation.visibleSummary || ""}`.slice(0, 1000);
        extractedObservations.push(observation);
      }
      populateManualForm(extractedObservations[extractedObservations.length - 1]);
      renderExtracted(extractedObservations);
      status(`Read ${extractedObservations.length} detector report file${extractedObservations.length === 1 ? "" : "s"}. Review the extracted evidence, then click “Save and link this evidence bundle”. Nothing is linked until that button is pressed.`);
    } catch (err) {
      status(err.message || "Screenshot analysis failed.", true);
    }
  }

  window.addEventListener("academicVoice:rewrite-lineage-updated", resetForNewCandidate);

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
    input.addEventListener("change", () => acceptFiles(input.files));
    read.addEventListener("click", analyseSelected);

    ["dragenter", "dragover"].forEach((eventName) => drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((eventName) => drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.remove("dragging");
    }));
    drop.addEventListener("drop", (event) => acceptFiles(event.dataTransfer?.files));
    drop.addEventListener("click", openPicker);
    drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPicker(); }
    });
    drop.addEventListener("paste", (event) => {
      const item = [...(event.clipboardData?.items || [])].find((row) => row.type === "image/png" || row.type === "image/jpeg");
      if (!item) return status("Clipboard does not contain a PNG/JPEG screenshot. Choose PDF reports using the file picker.", true);
      event.preventDefault();
      acceptFiles([item.getAsFile()]);
    });

    // This is intentionally delegated: the compact “Upload detector result”
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
