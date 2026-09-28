import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { deterministicSourceAssembly, limitSources, verifyAssemblyExtracts, SCOPUS_ABSTRACT } from "../server/lib/sourceGroundedAuthoring.js";

async function loadScopusImport() {
  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(new URL("../public/scopusImport.js", import.meta.url), "utf8"), sandbox);
  return sandbox.window.ScopusImport;
}

const HEADER = '"Authors","Author full names","Author(s) ID","Title","Year","Source title","Volume","Issue","Art. No.","Page start","Page end","Page count","Cited by","DOI","Link","Abstract","Author Keywords","Index Keywords","Document Type","Source","EID"';
const row = (cells) => cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",");
const SAMPLE = `﻿${HEADER}\r\n${[
  row(["Anderson R.C.; Mansi S.A.; Reeb D.M.", "Anderson, Ronald C. (1); Mansi, Sattar A. (2); Reeb, David M. (3)", "1;2;3", "Board characteristics, accounting report integrity, and the cost of debt", "2004", "Journal of Accounting and Economics", "37", "3", "", "315", "342", "28", "2100", "10.1016/j.jacceco.2004.01.004", "https://www.scopus.com/x", "We find that the cost of debt financing is inversely related to board independence. Fully independent audit committees are associated with a significantly lower cost of debt financing. © 2004 Elsevier B.V. All rights reserved.", "Board independence; Cost of debt", "Debt financing", "Article", "Scopus", "2-s2.0-1"]),
  row(["Okafor C.", "Okafor, Chinedu (5)", "5", "Board independence and debt pricing, \"emerging\" markets", "2021", "Corporate Governance", "29", "2", "", "101", "120", "20", "5", "https://doi.org/10.1111/corg.12345", "", "This study finds that board independence is associated with a lower cost of debt only where ownership concentration is low.\nWhen controlling shareholders dominate, independent directors have little effect on loan spreads.", "Emerging markets", "", "Article", "Scopus", "2-s2.0-2"]),
  row(["Lee K., Park J.", "", "6;7", "Audit committees and bond yields", "2018", "Accounting Horizons", "32", "1", "", "", "", "", "0", "", "", "[No abstract available]", "", "", "Article", "Scopus", "2-s2.0-3"]),
].join("\r\n")}\r\n`;

test("a Scopus CSV export becomes one record per paper with its published abstract", async () => {
  const scopus = await loadScopusImport();
  const { records, withoutAbstract, totalRows } = scopus.parseScopusCsv(SAMPLE);
  assert.equal(totalRows, 3);
  assert.equal(withoutAbstract, 1);
  assert.equal(records.length, 2);
  const [anderson, okafor] = records;
  assert.equal(anderson.author, "Anderson et al.");
  assert.equal(anderson.year, "2004");
  assert.equal(anderson.publication, "Journal of Accounting and Economics, 37(3), 315–342");
  assert.equal(anderson.doi, "10.1016/j.jacceco.2004.01.004");
  assert.doesNotMatch(anderson.abstract, /©|Elsevier|rights reserved/);
  assert.match(anderson.abstract, /lower cost of debt financing\.$/);
  assert.equal(okafor.author, "Okafor");
  assert.equal(okafor.title, 'Board independence and debt pricing, "emerging" markets');
  assert.equal(okafor.doi, "10.1111/corg.12345");
  assert.match(okafor.abstract, /is low\. When controlling/);
});

test("Scopus author lists become in-text citation authors in either export format", async () => {
  const scopus = await loadScopusImport();
  assert.equal(scopus.citationAuthor("Lee K., Park J.", ""), "Lee and Park");
  assert.equal(scopus.citationAuthor("Van der Berg J.A.; Smith K.; Ng L.", ""), "Van der Berg et al.");
  assert.equal(scopus.citationAuthor("", "Okafor, Chinedu (5)"), "Okafor");
  assert.equal(scopus.citationAuthor("[No author name available]", ""), "");
});

test("a CSV without the Scopus columns is rejected with a plain explanation", async () => {
  const scopus = await loadScopusImport();
  assert.throws(() => scopus.parseScopusCsv("Name,Value\nA,1\n"), /not a Scopus export/);
});

test("an assembly takes up to 12 full-text studies plus 50 Scopus abstracts", () => {
  const abstracts = Array.from({ length: 60 }, (_, index) => ({ id: `a${index}`, origin: SCOPUS_ABSTRACT }));
  const fullText = Array.from({ length: 15 }, (_, index) => ({ id: `f${index}` }));
  const kept = limitSources([...fullText, ...abstracts]);
  assert.equal(kept.filter((source) => source.origin === SCOPUS_ABSTRACT).length, 50);
  assert.equal(kept.filter((source) => source.origin !== SCOPUS_ABSTRACT).length, 12);
});

test("Scopus abstract extracts are verbatim, cited and located as the abstract", async () => {
  const scopus = await loadScopusImport();
  const sources = scopus.parseScopusCsv(SAMPLE).records.map((record) => ({
    id: record.id,
    origin: SCOPUS_ABSTRACT,
    title: record.title,
    bibliographic: { title: record.title, author: record.author, year: record.year, metadata_confidence: "researcher_reviewed" },
    text: record.abstract,
  }));
  const assembly = deterministicSourceAssembly({
    entryMode: "rebuild",
    structureText: "Literature Review\n\nIndependent audit committees are associated with a lower cost of debt (Anderson et al., 2004).",
    sources,
  });
  const extracts = assembly.sections.flatMap((section) => section.blocks).filter((block) => block.type === "extract");
  assert.ok(extracts.length > 0);
  assert.equal(verifyAssemblyExtracts(assembly, sources).exact, true);
  for (const block of extracts) {
    assert.equal(block.origin, SCOPUS_ABSTRACT);
    assert.equal(block.locator, "Scopus abstract");
    assert.equal(block.parenthetical_citation, "(Anderson et al., 2004)");
  }
});

test("a section never offers two passages that repeat the same sentence from one study", async () => {
  const scopus = await loadScopusImport();
  const sources = scopus.parseScopusCsv(SAMPLE).records.map((record) => ({
    id: record.id,
    origin: SCOPUS_ABSTRACT,
    title: record.title,
    bibliographic: { title: record.title, author: record.author, year: record.year, metadata_confidence: "researcher_reviewed" },
    text: record.abstract,
  }));
  const assembly = deterministicSourceAssembly({ entryMode: "develop", structureText: "Literature review\nBoard independence, audit committees, ownership concentration and the cost of debt.", sources });
  for (const section of assembly.sections) {
    const seen = new Map();
    for (const block of section.blocks.filter((row) => row.type === "extract")) {
      for (const sentence of block.text.split(/(?<=[.!?])\s+/).filter((value) => value.length >= 30)) {
        const key = `${block.source_id}:${sentence.toLowerCase()}`;
        assert.ok(!seen.has(key), `repeated sentence: ${sentence}`);
        seen.set(key, true);
      }
    }
  }
});
