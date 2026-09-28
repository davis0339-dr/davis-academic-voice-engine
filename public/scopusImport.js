(() => {
  "use strict";

  // Reads a Scopus CSV export ("Export > CSV") into study records. Each row is
  // one publication; its Abstract column is the authors' own published wording.

  // RFC 4180: quoted fields may contain commas, doubled quotes and line breaks.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const input = String(text || "").replace(/^﻿/, "");
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if (quoted) {
        if (char === '"') {
          if (input[index + 1] === '"') { field += '"'; index += 1; } else { quoted = false; }
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && input[index + 1] === "\n") index += 1;
        row.push(field);
        field = "";
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
      } else {
        field += char;
      }
    }
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
    return rows;
  }

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function surnamesFromFullNames(value) {
    // "Anderson, Ronald C. (7402953476); Mansi, Sattar A. (6603617285)"
    return String(value || "").split(";").map((name) => clean(name.split(",")[0])).filter(Boolean);
  }

  function surnamesFromAuthors(value) {
    // Newer exports: "Anderson R.C.; Mansi S.A."  Older: "Anderson R.C., Mansi S.A."
    const text = clean(value);
    if (!text || /no author name available/i.test(text)) return [];
    const names = text.includes(";") ? text.split(";") : text.split(/,\s*(?=[^,]*?\s(?:[A-Z]\.-?)+(?:,|$))/);
    return names.map((name) => clean(name).replace(/\s+(?:[A-Z]\.-?\s*)+$/, "").trim()).filter(Boolean);
  }

  // Author field in in-text citation form, which the server uses verbatim:
  // "Anderson", "Anderson and Mansi" or "Anderson et al.".
  function citationAuthor(authors, fullNames) {
    const surnames = surnamesFromFullNames(fullNames).length ? surnamesFromFullNames(fullNames) : surnamesFromAuthors(authors);
    if (!surnames.length) return "";
    if (surnames.length === 1) return surnames[0];
    if (surnames.length === 2) return `${surnames[0]} and ${surnames[1]}`;
    return `${surnames[0]} et al.`;
  }

  // Scopus appends publisher notices ("© 2021 Elsevier B.V. All rights
  // reserved.") that are not part of the authors' abstract.
  function cleanAbstract(value) {
    let text = clean(value);
    if (!text || /^\[no abstract available\]$/i.test(text)) return "";
    for (let pass = 0; pass < 3; pass += 1) {
      const match = text.match(/(?:^|[.!?]\s+|\s)((?:©|\(c\)\s|Copyright\b)[^]*)$/i);
      if (!match || match[1].length > 300) break;
      text = text.slice(0, text.length - match[1].length).trim();
    }
    return text.replace(/\s*All rights reserved\.?$/i, "").trim();
  }

  function parseScopusCsv(text) {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("No rows were found in this CSV file.");
    const headers = rows[0].map((cell) => clean(cell).replace(/^﻿/, ""));
    const column = (...names) => {
      for (const name of names) {
        const index = headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
        if (index >= 0) return index;
      }
      return -1;
    };
    const cols = {
      authors: column("Authors"),
      fullNames: column("Author full names"),
      title: column("Title"),
      year: column("Year"),
      source: column("Source title"),
      volume: column("Volume"),
      issue: column("Issue"),
      pageStart: column("Page start"),
      pageEnd: column("Page end"),
      doi: column("DOI"),
      link: column("Link"),
      abstract: column("Abstract"),
      authorKeywords: column("Author Keywords"),
      indexKeywords: column("Index Keywords"),
      documentType: column("Document Type"),
      eid: column("EID"),
    };
    if (cols.title < 0 || cols.year < 0 || cols.abstract < 0 || (cols.authors < 0 && cols.fullNames < 0)) {
      throw new Error("This CSV is not a Scopus export. It needs the Scopus columns Authors, Title, Year and Abstract; in Scopus choose Export › CSV and include “Abstract & keywords”.");
    }
    const cell = (row, index) => (index >= 0 ? clean(row[index]) : "");
    const records = [];
    let withoutAbstract = 0;
    rows.slice(1).forEach((row, index) => {
      const title = cell(row, cols.title);
      if (!title) return;
      const abstract = cleanAbstract(row[cols.abstract]);
      if (!abstract) { withoutAbstract += 1; return; }
      const volume = cell(row, cols.volume);
      const issue = cell(row, cols.issue);
      const pages = [cell(row, cols.pageStart), cell(row, cols.pageEnd)].filter(Boolean).join("–");
      const publication = [
        cell(row, cols.source),
        volume ? `${volume}${issue ? `(${issue})` : ""}` : "",
        pages,
      ].filter(Boolean).join(", ");
      records.push({
        id: `scopus-${cell(row, cols.eid) || index + 1}`,
        title,
        author: citationAuthor(cell(row, cols.authors), row[cols.fullNames]),
        allAuthors: cell(row, cols.authors),
        year: (cell(row, cols.year).match(/(?:19|20)\d{2}/) || [""])[0],
        publication,
        journal: cell(row, cols.source),
        doi: cell(row, cols.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
        url: cell(row, cols.link),
        abstract,
        keywords: [cell(row, cols.authorKeywords), cell(row, cols.indexKeywords)].filter(Boolean).join("; "),
        documentType: cell(row, cols.documentType),
      });
    });
    return { records, withoutAbstract, totalRows: rows.length - 1 };
  }

  window.ScopusImport = { parseCsv, parseScopusCsv, citationAuthor, cleanAbstract };
})();
