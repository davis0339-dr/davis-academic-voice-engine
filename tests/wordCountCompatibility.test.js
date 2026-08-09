import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { countWords } from "../server/config/limits.js";

const browserCounter = fs.readFileSync(new URL("../public/wordCountCompatibility.js", import.meta.url), "utf8");

test("academic punctuation-bearing terms count as one lexical token rather than fragments", () => {
  const text = "U.S.-listed firms use bank-loan financing in the S&P 1500 during 2015–2024 (Board of Governors, n.d.-a).";
  assert.equal(countWords(text), 15);
});

test("standalone punctuation and ampersands do not inflate the count", () => {
  assert.equal(countWords("Board independence & CEO duality"), 4);
  assert.equal(countWords("... --- !!!"), 0);
});

test("server and browser counters use the same whitespace lexical rule", () => {
  assert.match(browserCounter, /split\(\/\\s\+\/u\)/);
  assert.match(browserCounter, /\\p\{L\}/);
  assert.match(browserCounter, /\\p\{N\}/);
});
