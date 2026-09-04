import { test } from "node:test";
import assert from "node:assert/strict";
import { llmProvider } from "../server/lib/llmProvider.js";

test("request-scoped provider accounting totals calls, tokens and estimated Sonnet cost", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousModel = process.env.ANTHROPIC_MODEL;
  const previousFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
  global.fetch = async () => new Response(JSON.stringify({
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 60, output_tokens: 25 },
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const snapshot = await llmProvider.withUsageTracking(async () => {
      await llmProvider.callAnthropic({ system: "test", messages: [{ role: "user", content: "one" }] });
      await llmProvider.callAnthropic({ system: "test", messages: [{ role: "user", content: "two" }] });
      return llmProvider.usageSnapshot();
    }, { maxCalls: 4 });

    assert.equal(snapshot.attempted_calls, 2);
    assert.equal(snapshot.successful_calls, 2);
    assert.equal(snapshot.failed_calls, 0);
    assert.equal(snapshot.input_tokens, 120);
    assert.equal(snapshot.output_tokens, 50);
    assert.equal(snapshot.max_calls, 4);
    assert.equal(snapshot.estimated_cost_usd, 0.00111);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = previousModel;
  }
});

test("request-scoped provider accounting blocks calls beyond the configured ceiling", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key";
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 10, output_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const snapshot = await llmProvider.withUsageTracking(async () => {
      await llmProvider.callAnthropic({ system: "test", messages: [{ role: "user", content: "one" }] });
      await assert.rejects(
        llmProvider.callAnthropic({ system: "test", messages: [{ role: "user", content: "two" }] }),
        (error) => error.code === "PROVIDER_CALL_BUDGET_EXCEEDED"
      );
      return llmProvider.usageSnapshot();
    }, { maxCalls: 1 });

    assert.equal(fetchCalls, 1);
    assert.equal(snapshot.attempted_calls, 1);
    assert.equal(snapshot.successful_calls, 1);
    assert.equal(snapshot.budget_blocked_calls, 1);
    assert.equal(snapshot.max_calls, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

test("request-scoped provider accounting stops new calls after the wall-clock budget", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key";
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 });
  };

  try {
    const snapshot = await llmProvider.withUsageTracking(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await assert.rejects(
        llmProvider.callAnthropic({ system: "test", messages: [{ role: "user", content: "late" }] }),
        (error) => error.code === "PROVIDER_TIME_BUDGET_EXCEEDED"
      );
      return llmProvider.usageSnapshot();
    }, { maxCalls: 4, maxDurationMs: 1 });

    assert.equal(fetchCalls, 0);
    assert.equal(snapshot.attempted_calls, 0);
    assert.equal(snapshot.time_budget_blocked_calls, 1);
    assert.equal(snapshot.max_duration_ms, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});
