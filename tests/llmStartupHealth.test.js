import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { llmProvider, HealthState } from "../server/lib/llmProvider.js";

function withApiKey(value, fn) {
  const previous = process.env.ANTHROPIC_API_KEY;
  if (value === null) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
}

test("startup LLM status is configuration-only and performs no provider probe", () => {
  withApiKey("test-key-not-used-for-network", () => {
    const result = llmProvider.configurationHealth();
    assert.equal(result.state, HealthState.READY);
    assert.equal(result.live_probe_performed, false);
    assert.match(result.message, /configured/i);
  });
});

test("startup LLM status reports missing configuration without network work", () => {
  withApiKey(null, () => {
    const result = llmProvider.configurationHealth();
    assert.equal(result.state, HealthState.NOT_CONFIGURED);
    assert.equal(result.live_probe_performed, false);
  });
});

test("live provider ping is explicit rather than part of ordinary page startup", () => {
  const routeSource = readFileSync(new URL("../server/routes/health.js", import.meta.url), "utf8");
  assert.match(routeSource, /req\.query\?\.probe/);
  assert.match(routeSource, /configurationHealth\(\)/);
  assert.match(routeSource, /checkHealth\(\)/);
});
