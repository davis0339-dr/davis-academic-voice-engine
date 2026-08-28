(function () {
  const DOCX_EXT = /\.docx$/i;
  const PDF_EXT = /\.pdf$/i;
  const TEXT_EXT = /\.(txt|md|markdown)$/i;
  const CSV_EXT = /\.csv$/i;
  const XLSX_EXT = /\.xlsx$/i;
  const MAMMOTH_SRC = "https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js";
  const PDFJS_SRC = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
  const PDFJS_WORKER_SRC = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const XLSX_SRC = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  const loading = new Map();

  function extensionOf(file) {
    const name = file?.name || "";
    const match = name.toLowerCase().match(/\.([^.]+)$/);
    return match ? match[1] : "";
  }

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    if (loading.has(src)) return loading.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => ready() ? resolve() : reject(new Error(`Library loaded from ${src} but did not initialise.`));
      script.onerror = () => reject(new Error("Could not load the document reader library. Check your connection and try again."));
      document.head.appendChild(script);
    }).finally(() => loading.delete(src));
    loading.set(src, promise);
    return promise;
  }

  function cleanInlineText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();
  }

  // Mammoth's extractRawText is convenient but discards too much document
  // structure for academic long-form editing: Word headings lose their role
  // and table cells become ambiguous loose lines. Convert to HTML first, then
  // serialize academic block structure deliberately. This keeps headings and
  // table rows distinct while preserving the exact text inside cells (including
  // numeric ranges such as 2015-2024 and NAICS 31-33).
  function htmlToAcademicText(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const out = [];

    function emitBlock(text) {
      const cleaned = cleanInlineText(text);
      if (cleaned) out.push(cleaned, "");
    }

    function visit(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        emitBlock(node.textContent);
        return;
      }

      if (tag === "table") {
        const rows = Array.from(node.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tr"));
        const usableRows = rows.length ? rows : Array.from(node.querySelectorAll("tr"));
        for (const row of usableRows) {
          const cells = Array.from(row.children)
            .filter((cell) => /^(td|th)$/i.test(cell.tagName))
            .map((cell) => cleanInlineText(cell.textContent));
          if (cells.some(Boolean)) out.push(cells.join("\t"));
        }
        out.push("");
        return;
      }

      if (tag === "p" || tag === "blockquote") {
        emitBlock(node.textContent);
        return;
      }

      if (tag === "ul" || tag === "ol") {
        for (const li of Array.from(node.children).filter((child) => child.tagName?.toLowerCase() === "li")) {
          const text = cleanInlineText(li.textContent);
          if (text) out.push(`- ${text}`);
        }
        out.push("");
        return;
      }

      // Mammoth can wrap blocks in div/section-like containers. Traverse those
      // without flattening their descendants into one line.
      for (const child of Array.from(node.children || [])) visit(child);
    }

    for (const child of Array.from(doc.body.children)) visit(child);
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function readPlain(file) {
    return (await file.text()).replace(/\r\n/g, "\n").trim();
  }

  async function readDocx(file) {
    await loadScript(MAMMOTH_SRC, () => Boolean(window.mammoth?.convertToHtml || window.mammoth?.extractRawText));
    const arrayBuffer = await file.arrayBuffer();

    if (window.mammoth?.convertToHtml) {
      const result = await window.mammoth.convertToHtml({ arrayBuffer });
      const text = htmlToAcademicText(result.value);
      if (text) return { text, warnings: result.messages || [], structure: "word_blocks" };
    }

    // Conservative fallback for unusual DOCX files where HTML conversion
    // yields no usable content.
    const fallback = await window.mammoth.extractRawText({ arrayBuffer });
    const text = String(fallback.value || "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("No readable text was found in this Word document.");
    return { text, warnings: fallback.messages || [], structure: "word_raw_text" };
  }

  async function readPdf(file) {
    await loadScript(PDFJS_SRC, () => Boolean(window.pdfjsLib?.getDocument));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const pages = [];
    let pdfMetadata = {};
    try {
      const metadata = await pdf.getMetadata();
      const info = metadata?.info || {};
      pdfMetadata = {
        title: cleanInlineText(info.Title),
        author: cleanInlineText(info.Author),
        subject: cleanInlineText(info.Subject),
        keywords: cleanInlineText(info.Keywords),
        creationDate: cleanInlineText(info.CreationDate),
      };
    } catch {}
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
      if (lines.length) pages.push(`[Page ${pageNumber}]\n${lines.join("\n")}`);
    }
    const text = pages.filter(Boolean).join("\n\n").trim();
    if (!text) {
      throw new Error("No selectable text was found in this PDF. Scanned/image-only PDFs are not supported in this build.");
    }
    const doi = text.match(/\b10\.\d{4,9}\/[\-._;()/:A-Z0-9]+\b/i)?.[0]?.replace(/[.,;:]$/, "") || "";
    const visibleYear = text.slice(0, 8000).match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
    const metadataYear = pdfMetadata.creationDate.match(/(?:19|20)\d{2}/)?.[0] || "";
    return {
      text,
      warnings: [],
      structure: "pdf_pages",
      pageCount: pdf.numPages,
      metadata: { ...pdfMetadata, year: visibleYear || metadataYear, doi },
    };
  }

  async function readCsv(file) {
    const text = (await file.text()).replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error("No readable rows were found in this CSV file.");
    return { text: `[Sheet: CSV]\n${text}`, warnings: [], structure: "spreadsheet_rows", sheetNames: ["CSV"] };
  }

  async function readXlsx(file) {
    await loadScript(XLSX_SRC, () => Boolean(window.XLSX?.read && window.XLSX?.utils?.sheet_to_json));
    const arrayBuffer = await file.arrayBuffer();
    // SheetJS reads workbook structures; this importer never evaluates formulas,
    // executes macros, or writes workbook code. Macro-enabled .xlsm is deliberately
    // not accepted by this build.
    const workbook = window.XLSX.read(arrayBuffer, { type: "array", cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false });
    const sections = [];
    for (const sheetName of workbook.SheetNames || []) {
      const sheet = workbook.Sheets[sheetName];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: false });
      const serialized = rows
        .map((row) => row.map((cell) => String(cell ?? "").replace(/[\t\r\n]+/g, " ").trim()).join("\t"))
        .filter((row) => row.replace(/\t/g, "").trim())
        .join("\n");
      if (serialized) sections.push(`[Sheet: ${sheetName}]\n${serialized}`);
    }
    const text = sections.join("\n\n").trim();
    if (!text) throw new Error("No readable worksheet cells were found in this Excel workbook.");
    return { text, warnings: [], structure: "spreadsheet_rows", sheetNames: workbook.SheetNames || [] };
  }

  async function readAcademicFile(file, maxBytes) {
    if (!file) throw new Error("Choose a file first.");
    if (maxBytes && file.size > maxBytes) {
      throw new Error(`File is too large. Current upload limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`);
    }

    if (TEXT_EXT.test(file.name) || file.type === "text/plain" || file.type === "text/markdown") {
      return { text: await readPlain(file), warnings: [], structure: "plain_text" };
    }
    if (DOCX_EXT.test(file.name)) return readDocx(file);
    if (PDF_EXT.test(file.name) || file.type === "application/pdf") return readPdf(file);
    if (CSV_EXT.test(file.name) || file.type === "text/csv") return readCsv(file);
    if (XLSX_EXT.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return readXlsx(file);

    throw new Error(`Unsupported file type .${extensionOf(file) || "unknown"}. Use TXT, MD, DOCX, a text-based PDF, CSV, or XLSX.`);
  }

  window.AcademicFileImport = { readAcademicFile };
})();
