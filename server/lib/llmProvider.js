// Server-side only. This module is never sent to the browser.
// Provider adapter for the LLM used by the revision pipeline.
// Currently implements the Anthropic Messages API over plain fetch (no SDK
// dependency) so the health-check/timeout/error-state contract in Section 19
// of the build handoff is fully under our control.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const HealthState = Object.freeze({
  READY: "READY",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  AUTH_FAILED: "AUTH_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  PROVIDER_ERROR: "PROVIDER_ERROR",
});

function getConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 30000);
  return { apiKey, model, timeoutMs };
}

function isConfigured() {
  const { apiKey } = getConfig();
  return Boolean(apiKey && apiKey.trim().length > 0);
}

async function callAnthropic({ system, messages, maxTokens = 4096 }) {
  const { apiKey, model, timeoutMs } = getConfig();

  if (!apiKey) {
    const err = new Error("LLM not configured");
    err.healthState = HealthState.NOT_CONFIGURED;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages,
      }),
      signal: controller.signal,
    });
  } catch (networkErr) {
    clearTimeout(timer);
    if (networkErr.name === "AbortError") {
      const err = new Error("LLM request timed out");
      err.healthState = HealthState.NETWORK_TIMEOUT;
      throw err;
    }
    const err = new Error(`Network error calling provider: ${networkErr.message}`);
    err.healthState = HealthState.NETWORK_TIMEOUT;
    throw err;
  }
  clearTimeout(timer);

  if (response.status === 401 || response.status === 403) {
    const err = new Error("Provider rejected the API key");
    err.healthState = HealthState.AUTH_FAILED;
    throw err;
  }
  if (response.status === 429) {
    const err = new Error("Provider rate-limited this request");
    err.healthState = HealthState.RATE_LIMITED;
    throw err;
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const err = new Error(`Provider error ${response.status}: ${bodyText.slice(0, 500)}`);
    err.healthState = HealthState.PROVIDER_ERROR;
    throw err;
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((block) => block.type === "text");
  return {
    text: textBlock ? textBlock.text : "",
    raw: data,
    usage: data.usage,
  };
}

// Cheap connection test: minimal max_tokens, minimal prompt. Used by
// GET /api/health/llm. Must fail fast, not hang -- see Section 19.3.
async function checkHealth() {
  if (!isConfigured()) {
    return { state: HealthState.NOT_CONFIGURED, message: "ANTHROPIC_API_KEY is not set." };
  }
  try {
    await callAnthropic({
      system: "Reply with the single word: ok",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
    });
    return { state: HealthState.READY, message: "Provider reachable and authenticated." };
  } catch (err) {
    return {
      state: err.healthState || HealthState.PROVIDER_ERROR,
      message: err.message,
    };
  }
}

export const llmProvider = {
  isConfigured,
  checkHealth,
  callAnthropic,
};
