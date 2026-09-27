import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(new URL("../server/routes/rewrite.js", import.meta.url), "utf8");
const pipeline = fs.readFileSync(new URL("../server/lib/pipeline.js", import.meta.url), "utf8");
const browser = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("a slow full rewrite is not restarted from the beginning after NETWORK_TIMEOUT", () => {
  const transientBlock = route.match(/const TRANSIENT_STATES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
  assert.doesNotMatch(transientBlock, /NETWORK_TIMEOUT/);
});

test("near-limit primary rewrites receive one bounded provider window longer than 90 seconds", () => {
  assert.match(pipeline, /primaryPassTimeoutMs/);
  assert.match(pipeline, /Math\.min\(150000, Math\.max\(90000, sourceWords \* 100\)\)/);
  assert.match(pipeline, /timeoutOverrideMs: primaryPassTimeoutMs/);
});

test("the editor reports truthful waiting stages instead of an undifferentiated timer", () => {
  assert.match(browser, /provider is composing the first complete candidate/i);
  assert.match(browser, /full request will not be restarted/i);
});
