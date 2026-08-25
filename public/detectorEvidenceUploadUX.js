(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let observer = null;

  function installUploadControls() {
    const input = $("detectorScreenshotInput");
    if (!input) return false;

    const card = input.closest(".detector-screenshot-card") || input.parentElement;
    if (!card) return false;

    const controls = card.querySelector(".detector-screenshot-controls") || input.parentElement;
    if (!controls) return false;

    // Replace the visually ambiguous label-only file picker with a real button.
    let chooseButton = $("chooseDetectorEvidenceScreenshotBtn");
    if (!chooseButton) {
      chooseButton = document.createElement("button");
      chooseButton.id = "chooseDetectorEvidenceScreenshotBtn";
      chooseButton.type = "button";
      chooseButton.className = "detector-evidence-upload-button primary";
      chooseButton.textContent = "Choose detector report file(s)";
      chooseButton.setAttribute("aria-controls", "detectorScreenshotInput");
      chooseButton.addEventListener("click", () => input.click());

      const readButton = $("analyseDetectorScreenshotBtn") || controls.querySelector("button");
      if (readButton) controls.insertBefore(chooseButton, readButton);
      else controls.appendChild(chooseButton);
    }
    chooseButton.textContent = "Choose detector report file(s)";

    const legacyLabel = card.querySelector('label[for="detectorScreenshotInput"]');
    if (legacyLabel) {
      legacyLabel.classList.add("legacy-detector-file-label-hidden");
      legacyLabel.setAttribute("aria-hidden", "true");
    }

    const detectorSelect = $("detectorScreenshotDetector");
    if (detectorSelect) {
      const selectLabel = detectorSelect.closest("label");
      if (selectLabel) selectLabel.classList.add("detector-selector-field");
      detectorSelect.classList.add("detector-selector-control");
      detectorSelect.setAttribute("aria-label", "Detector shown in report");
    }

    const readButton = $("analyseDetectorScreenshotBtn");
    if (readButton) {
      readButton.classList.add("detector-read-button");
      readButton.textContent = "Read selected report file(s)";
    }

    const status = $("detectorScreenshotStatus");
    if (status) status.classList.add("detector-upload-status");

    // The primary gateway owns validation and the multi-file cost status. This
    // fallback binding is only for legacy pages that do not mount that gateway.
    if (card.id !== "detectorScreenshotGateway" && !input.dataset.explicitUploadBound) {
      input.dataset.explicitUploadBound = "true";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!status) return;
        status.textContent = file
          ? `Selected: ${file.name} · ${(file.size / 1024).toFixed(0)} KB. Press “Read selected report file(s)”.`
          : "No detector report file selected.";
      });
    }

    return true;
  }

  function start() {
    if (installUploadControls()) return;
    observer = new MutationObserver(() => {
      if (installUploadControls()) {
        observer?.disconnect();
        observer = null;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const style = document.createElement("style");
  style.textContent = `
    .legacy-detector-file-label-hidden{display:none!important}
    .detector-screenshot-card .detector-screenshot-controls{
      display:grid!important;
      grid-template-columns:minmax(250px,360px) minmax(260px,auto) auto!important;
      gap:14px!important;
      align-items:end!important;
      margin-top:18px!important;
    }
    .detector-screenshot-card .detector-selector-field{
      display:flex!important;
      flex-direction:column!important;
      gap:7px!important;
      min-width:250px!important;
      font-weight:600!important;
      line-height:1.25!important;
    }
    .detector-screenshot-card .detector-selector-control{
      display:block!important;
      width:100%!important;
      min-width:250px!important;
      min-height:44px!important;
      padding:8px 38px 8px 12px!important;
      border:1px solid #53677f!important;
      border-radius:8px!important;
      background:#0f141c!important;
      color:#f1f4f8!important;
      font:inherit!important;
    }
    .detector-evidence-upload-button,.detector-read-button{
      display:inline-flex!important;
      align-items:center!important;
      justify-content:center!important;
      min-height:44px!important;
      padding:10px 16px!important;
      border-radius:8px!important;
      white-space:nowrap!important;
      cursor:pointer!important;
    }
    .detector-evidence-upload-button{
      border:1px solid #67e0b2!important;
      background:#173c33!important;
      color:#f6fffb!important;
      font-weight:700!important;
    }
    .detector-evidence-upload-button:hover{background:#1d4b40!important}
    .detector-upload-status{
      grid-column:1 / -1!important;
      display:block!important;
      margin-top:0!important;
      color:#aebbd0!important;
    }
    @media(max-width:900px){
      .detector-screenshot-card .detector-screenshot-controls{grid-template-columns:1fr!important}
      .detector-screenshot-card .detector-selector-field,.detector-screenshot-card .detector-selector-control{min-width:0!important;width:100%!important}
      .detector-evidence-upload-button,.detector-read-button{width:100%!important}
    }
  `;
  document.head.appendChild(style);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
