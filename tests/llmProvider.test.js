import { test } from "node:test";
import assert from "node:assert/strict";
import { llmProvider, HealthState } from "../server/lib/llmProvider.js";

function withProviderEnv(fn) {
  return async () => {
    const oldKey = process.env.ANTHROPIC_API_KEY;
    const oldFetch = global.fetch;
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      await fn();
    } finally {
      global.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = oldKey;
    }
  };
}

test(
  "Anthropic HTTP 529 overloaded_error is classified as PROVIDER_OVERLOADED",
  withProviderEnv(async () => {
    global.fetch = async () =>
      new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), {
        status: 529,
        headers: { "content-type": "application/json" },
      });

    await assert.rejects(
      () => llmProvider.callAnthropic({ system: "test", messages: [{ role: "user", content: "test" }], maxTokens: 8 }),
      (err) => err.healthState === HealthState.PROVIDER_OVERLOADED && err.status === 529
    );
  })
);

test(
  "temporary provider 503 responses are classified as PROVIDER_UNAVAILABLE",
  withProviderEnv(async () => {
    global.fetch = async () => new Response("temporarily unavailable", { status: 503 });

    await assert.rejects(
      () => llmProvider.callAnthropic({ system: "test", messages: [{ role: "user", content: "test" }], maxTokens: 8 }),
      (err) => err.healthState === HealthState.PROVIDER_UNAVAILABLE && err.status === 503
    );
  })
);

test(
  "exhausted Anthropic credits are classified as PROVIDER_BILLING_REQUIRED rather than generic provider error",
  withProviderEnv(async () => {
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );

    await assert.rejects(
      () => llmProvider.callAnthropic({ system: "test", messages: [{ role: "user", content: "test" }], maxTokens: 8 }),
      (err) =>
        err.healthState === HealthState.PROVIDER_BILLING_REQUIRED &&
        err.status === 400 &&
        /credits are exhausted/i.test(err.message)
    );
  })
);
