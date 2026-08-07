(function () {
  const DOCX_EXT = /\.docx$/i;
  const PDF_EXT = /\.pdf$/i;
  const TEXT_EXT = /\.(txt|md|markdown)$/i;

  function extensionOf(file) {
    const name = file?.name || "";
    const match = name.toLowerCase().match(/\.([^.]+)$/);
    return match ? match[1] : "";
  }

  async function readPlain(file) {
    return (await file.text()).replace(/\r\n/g, "\n").trim();
  }

  async function readDocx(file) {
    if (!window.mammoth?.extractRawText) {
      throw new Error("Word-file reader did not load. Refresh the page and try again.");
    }
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    const text = String(result.value || "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("No readable text was found in this Word document.");
    return { text, warnings: result.messages || [] };
  }

  async function readPdf(file) {
    if (!window.pdfjsLib?.getDocument) {
      throw new Error("PDF reader did not load. Refresh the page and try again.");
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = [];
      let current = "";
      let lastY = null;
      for (const item of content.items || []) {
        const y = item.transform?.[5] ?? null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 4 && current.trim()) {
          lines.push(current.trim());
          current = "";
        }
        current += `${item.str || ""} `;
        lastY = y;
      }
      if (current.trim()) lines.push(current.trim());
      pages.push(lines.join("\n"));
    }
    const text = pages.filter(Boolean).join("\n\n").trim();
    if (!text) {
      throw new Error("No selectable text was found in this PDF. Scanned/image-only PDFs are not supported in this build.");
    }
    return { text, warnings: [] };
  }

  async function readAcademicFile(file, maxBytes) {
    if (!file) throw new Error("Choose a file first.");
    if (maxBytes && file.size > maxBytes) {
      throw new Error(`File is too large. Current upload limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`);
    }

    if (TEXT_EXT.test(file.name) || file.type === "text/plain" || file.type === "text/markdown") {
      return { text: await readPlain(file), warnings: [] };
    }
    if (DOCX_EXT.test(file.name)) return readDocx(file);
    if (PDF_EXT.test(file.name) || file.type === "application/pdf") return readPdf(file);

    throw new Error(`Unsupported file type .${extensionOf(file) || "unknown"}. Use TXT, MD, DOCX, or a text-based PDF.`);
  }

  window.AcademicFileImport = { readAcademicFile };
})();
