// Server-side only. This module is never sent to the browser.
// Provider adapter for the LLM used by the revision pipeline.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const HealthState = Object.freeze({
  READY: "READY",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  AUTH_FAILED: "AUTH_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  PROVIDER_OVERLOADED: "PROVIDER_OVERLOADED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_BILLING_REQUIRED: "PROVIDER_BILLING_REQUIRED",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  PROVIDER_ERROR: "PROVIDER_ERROR",
});

function getConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 90000);
  return { apiKey, model, timeoutMs };
}

function isConfigured() {
  const { apiKey } = getConfig();
  return Boolean(apiKey && apiKey.trim().length > 0);
}

// Fast configuration-only status used by page startup. `READY` here means the
// application is configured to accept provider-backed work; live provider reachability
// is deliberately not probed on every page load. The response tells callers whether
// a live probe was actually performed.
function configurationHealth() {
  if (!isConfigured()) {
    return {
      state: HealthState.NOT_CONFIGURED,
      message: "ANTHROPIC_API_KEY is not set.",
      live_probe_performed: false,
    };
  }
  return {
    state: HealthState.READY,
    message: "Provider credentials are configured. Live connectivity is checked during model work or by an explicit diagnostic probe.",
    live_probe_performed: false,
  };
}

function providerFailure(status, bodyText, retryAfter = null) {
  let healthState = HealthState.PROVIDER_ERROR;
  let message = `Provider error ${status}: ${bodyText.slice(0, 500)}`;

  if (/credit balance is too low|purchase credits|plans\s*&\s*billing|billing.*credit/i.test(bodyText)) {
    healthState = HealthState.PROVIDER_BILLING_REQUIRED;
    message = "Anthropic API credits are exhausted. Add provider credits before continuing this job.";
  } else if (status === 429) {
    healthState = HealthState.RATE_LIMITED;
    message = "Provider rate-limited this request";
  } else if (status === 529 || /overloaded_error|\"Overloaded\"/i.test(bodyText)) {
    healthState = HealthState.PROVIDER_OVERLOADED;
    message = "Provider is temporarily overloaded";
  } else if ([500, 502, 503, 504].includes(status)) {
    healthState = HealthState.PROVIDER_UNAVAILABLE;
    message = `Provider is temporarily unavailable (${status})`;
  }

  const err = new Error(message);
  err.healthState = healthState;
  err.status = status;
  err.retryAfterMs = retryAfter ? Math.max(0, Number(retryAfter) * 1000) : null;
  return err;
}

async function callAnthropic({ system, messages, maxTokens = 4096, timeoutOverrideMs = null }) {
  const { apiKey, model, timeoutMs } = getConfig();

  if (!apiKey) {
    const err = new Error("LLM not configured");
    err.healthState = HealthState.NOT_CONFIGURED;
    throw err;
  }

  const effectiveTimeoutMs = timeoutOverrideMs || timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  let response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
      signal: controller.signal,
    });
  } catch (networkErr) {
    clearTimeout(timer);
    if (networkErr.name === "AbortError") {
      const err = new Error(`LLM request timed out after ${Math.round(effectiveTimeoutMs / 1000)}s`);
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

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw providerFailure(response.status, bodyText, response.headers.get("retry-after"));
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((block) => block.type === "text");
  return {
    text: textBlock ? textBlock.text : "",
    raw: data,
    usage: data.usage,
  };
}

async function checkHealth() {
  if (!isConfigured()) {
    return { state: HealthState.NOT_CONFIGURED, message: "ANTHROPIC_API_KEY is not set.", live_probe_performed: true };
  }
  try {
    await callAnthropic({
      system: "Reply with the single word: ok",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
      timeoutOverrideMs: 10000,
    });
    return { state: HealthState.READY, message: "Provider reachable and authenticated.", live_probe_performed: true };
  } catch (err) {
    return {
      state: err.healthState || HealthState.PROVIDER_ERROR,
      message: err.message,
      live_probe_performed: true,
    };
  }
}

export const llmProvider = {
  isConfigured,
  configurationHealth,
  checkHealth,
  callAnthropic,
};
