import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const safeDom = fs.readFileSync(new URL("../public/safeDom.js", import.meta.url), "utf8");

test("safe DOM preserves the form elements required by Research Studio", () => {
  for (const tag of ["INPUT", "LABEL", "SELECT", "OPTION", "TEXTAREA", "BUTTON"]) {
    assert.match(safeDom, new RegExp(`\\"${tag}\\"`), `Expected ${tag} to be allowed by safeDom`);
  }
  assert.doesNotMatch(safeDom, /dropEntirely[^;]*INPUT/s);
  assert.match(safeDom, /safeInputTypes/);
  assert.match(safeDom, /safeButtonTypes/);
});

test("safe DOM preserves interaction attributes but still strips executable event attributes", () => {
  for (const attribute of ["type", "placeholder", "disabled", "selected", "for", "accept", "multiple", "maxlength"]) {
    assert.match(safeDom, new RegExp(`\\"${attribute}\\"`), `Expected ${attribute} to be preserved`);
  }
  assert.match(safeDom, /name\.startsWith\("on"\)/);
  assert.match(safeDom, /dropEntirely = new Set\(\["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "FORM"\]\)/);
});