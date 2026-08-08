(() => {
  "use strict";

  let attempts = 0;
  const maxAttempts = 80;

  function syncCapabilities() {
    const input = document.getElementById("researchEvidenceFiles");
    const status = document.getElementById("researchEvidenceStatus");
    const intro = document.querySelector("#tab-researchstudio .research-studio-intro .muted");
    if (!input || !status) return false;

    input.accept = [
      ".txt", ".md", ".markdown", ".docx", ".pdf", ".csv", ".xlsx",
      "text/plain", "text/markdown", "text/csv", "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].join(",");
    status.textContent = "Add up to 8 TXT, DOCX, text-based PDF, CSV or XLSX sources (5 MB per file).";
    if (intro) {
      intro.textContent = "Current beta: TXT/Markdown, Word, text-based PDF, CSV and XLSX evidence sources, up to 8 files. Source text is analysed per request and is not persisted by the Researcher Studio API. Image-only PDFs and image files remain deliberately unsupported until the isolated OCR/vision path is added.";
    }
    return true;
  }

  function start() {
    if (syncCapabilities()) return;
    const timer = setInterval(() => {
      attempts += 1;
      if (syncCapabilities() || attempts >= maxAttempts) clearInterval(timer);
    }, 50);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
