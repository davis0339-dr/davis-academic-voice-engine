import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitiseProse } from "../server/lib/pipeline.js";

test("replaces a parenthetical em-dash pair with commas", () => {
  const input = "Strategic initiatives—expressed through diversification—provide mechanisms.";
  const out = sanitiseProse(input);
  assert.ok(!out.includes("—"));
  assert.equal(out, "Strategic initiatives, expressed through diversification, provide mechanisms.");
});

test("handles em-dashes with surrounding spaces", () => {
  const out = sanitiseProse("The result was clear — the model held.");
  assert.ok(!out.includes("—"));
  assert.match(out, /clear, the model/);
});

test("removes en-dashes used as clause connectors too", () => {
  const out = sanitiseProse("Firms adapt – or they fail.");
  assert.ok(!out.includes("–"));
});

test("does not create doubled commas when an em-dash sat beside a comma", () => {
  const out = sanitiseProse("initiatives, expressed—provide value");
  assert.ok(!out.includes(", ,"));
  assert.ok(!out.includes(",,"));
});

test("leaves ordinary hyphens in compound words untouched", () => {
  const out = sanitiseProse("mid-tier and quality-management firms");
  assert.equal(out, "mid-tier and quality-management firms");
});

test("leaves clean prose unchanged", () => {
  const clean = "The sample included 214 firms (Smith, 2020). Results were significant.";
  assert.equal(sanitiseProse(clean), clean);
});
