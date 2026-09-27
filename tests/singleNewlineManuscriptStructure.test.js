import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTextStructure, splitTextBlocks } from "../server/lib/textStructure.js";

const paragraphOne = "Corporate debt is a routine source of financing for firms, but lenders also assess how managers are monitored and whether financial information can be trusted. Governance therefore affects the uncertainty creditors face when they price borrowing and negotiate contractual protection.";
const paragraphTwo = "Debt contracts respond to that uncertainty through price and nonprice terms. Lenders may increase spreads, require collateral, tighten covenants, shorten maturities, or restrict credit when information and control problems become more serious for the borrowing firm.";
const paragraphThree = "The empirical question is not simply whether governance matters. It is which board mechanisms carry information for creditors, under what financial conditions those signals remain credible, and why apparently similar arrangements can produce different financing consequences.";

test("recognises substantial manuscript paragraphs separated by single newlines", () => {
  const text = `Introduction\n${paragraphOne}\nBackground of the Problem\n${paragraphTwo}\n${paragraphThree}\nProblem Statement\n${paragraphOne}`;
  const structure = parseTextStructure(text);
  assert.equal(structure.heading_count, 3);
  assert.equal(structure.paragraph_count, 4);
  assert.deepEqual(
    structure.blocks.map((block) => block.type),
    ["heading", "paragraph", "heading", "paragraph", "paragraph", "heading", "paragraph"]
  );
});

test("rejoins short visual line wraps instead of manufacturing paragraphs", () => {
  const wrapped = [
    "Corporate debt is a routine source of financing for firms, but",
    "lenders also assess how managers are monitored and whether",
    "financial information can be trusted before agreeing terms.",
  ].join("\n");
  const blocks = splitTextBlocks(wrapped);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /but lenders also assess/);
});
