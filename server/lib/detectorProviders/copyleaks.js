import { randomUUID } from "node:crypto";

const LOGIN_URL = "https://id.copyleaks.com/v3/account/login/api";
const DETECTOR_BASE = "https://api.copyleaks.com/v2/writer-detector";
let tokenCache = null;

export const DetectorHealthState = Object.freeze({
  READY: "READY",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  AUTH_FAILED: "AUTH_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  PROVIDER_ERROR: "PROVIDER_ERROR",
});

function getConfig() {
  return {
    email: process.env.COPYLEAKS_EMAIL,
    apiKey: process.env.COPYLEAKS_API_KEY,
    timeoutMs: Number(process.env.DETECTOR_TIMEOUT_MS || 20000),
    sensitivity: Math.max(1, Math.min(3, Number(process.env.COPYLEAKS_SENSITIVITY || 2))),
  };
}

export function isConfigured() {
  const { email, apiKey } = getConfig();
  return Boolean(email?.trim() && apiKey?.trim());
}

function providerError(message, state) {
  const err = new Error(message);
  err.healthState = state;
  return err;
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { response, body };
  } catch (err) {
    if (err.name === "AbortError") throw providerError("Copyleaks request timed out", DetectorHealthState.NETWORK_TIMEOUT);
    throw providerError(`Network error calling Copyleaks: ${err.message}`, DetectorHealthState.NETWORK_TIMEOUT);
  } finally {
    clearTimeout(timer);
  }
}

function tokenStillValid() {
  return Boolean(tokenCache?.token && tokenCache.expiresAt && tokenCache.expiresAt - Date.now() > 5 * 60 * 1000);
}

async function getAccessToken() {
  if (tokenStillValid()) return tokenCache.token;
  const { email, apiKey, timeoutMs } = getConfig();
  if (!email || !apiKey) throw providerError("Copyleaks not configured", DetectorHealthState.NOT_CONFIGURED);

  const { response, body } = await fetchJson(LOGIN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, key: apiKey }),
  }, timeoutMs);

  if (response.status === 401 || response.status === 403) throw providerError("Copyleaks rejected the configured credentials", DetectorHealthState.AUTH_FAILED);
  if (response.status === 429) throw providerError("Copyleaks authentication was rate-limited", DetectorHealthState.RATE_LIMITED);
  if (!response.ok || !body?.access_token) throw providerError(`Copyleaks authentication error ${response.status}`, DetectorHealthState.PROVIDER_ERROR);

  const parsedExpiry = Date.parse(body[".expires"] || "");
  tokenCache = {
    token: body.access_token,
    expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 47 * 60 * 60 * 1000,
  };
  return tokenCache.token;
}

function flattenMatches(result) {
  const matches = [];
  for (const match of result?.matches || []) {
    const starts = match?.text?.chars?.starts || [];
    const lengths = match?.text?.chars?.lengths || [];
    for (let i = 0; i < Math.min(starts.length, lengths.length); i++) {
      matches.push({ start: Number(starts[i]), length: Number(lengths[i]) });
    }
  }
  return matches.filter((m) => Number.isFinite(m.start) && Number.isFinite(m.length));
}

export function normalizeCopyleaksResponse(raw) {
  const sections = (raw?.results || []).map((result) => ({
    classification: result.classification === 2 ? "ai" : result.classification === 1 ? "human" : "unknown",
    probability: Number.isFinite(Number(result.probability)) ? Number(result.probability) : null,
    matches: flattenMatches(result),
  }));
  const explain = raw?.explain?.patterns || null;
  const explainSpans = [];
  const starts = explain?.text?.chars?.starts || [];
  const lengths = explain?.text?.chars?.lengths || [];
  for (let i = 0; i < Math.min(starts.length, lengths.length); i++) {
    explainSpans.push({ start: Number(starts[i]), length: Number(lengths[i]) });
  }
  return {
    provider: "copyleaks",
    modelVersion: raw?.modelVersion || null,
    summary: {
      human: Number.isFinite(Number(raw?.summary?.human)) ? Number(raw.summary.human) : null,
      ai: Number.isFinite(Number(raw?.summary?.ai)) ? Number(raw.summary.ai) : null,
    },
    sections,
    explain: explain ? {
      statistics: explain.statistics || null,
      spans: explainSpans.filter((m) => Number.isFinite(m.start) && Number.isFinite(m.length)),
    } : null,
    raw,
  };
}

async function callCopyleaks(text) {
  const { timeoutMs, sensitivity } = getConfig();
  const token = await getAccessToken();
  const scanId = `ave-${randomUUID()}`.slice(0, 36);
  const { response, body } = await fetchJson(`${DETECTOR_BASE}/${scanId}/check`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, sandbox: false, explain: true, sensitivity }),
  }, timeoutMs);

  if (response.status === 401 || response.status === 403) {
    tokenCache = null;
    throw providerError("Copyleaks rejected the access token", DetectorHealthState.AUTH_FAILED);
  }
  if (response.status === 429) throw providerError("Copyleaks rate-limited this request", DetectorHealthState.RATE_LIMITED);
  if (!response.ok) throw providerError(`Copyleaks error ${response.status}`, DetectorHealthState.PROVIDER_ERROR);
  return body;
}

async function checkHealth() {
  if (!isConfigured()) return { state: DetectorHealthState.NOT_CONFIGURED, message: "COPYLEAKS_EMAIL and COPYLEAKS_API_KEY are not set." };
  try {
    await getAccessToken();
    return { state: DetectorHealthState.READY, message: "Copyleaks credentials are configured and authenticated." };
  } catch (err) {
    return { state: err.healthState || DetectorHealthState.PROVIDER_ERROR, message: err.message };
  }
}

async function scanText(text) {
  if (String(text || "").length < 255) {
    throw providerError("Copyleaks requires at least 255 characters for AI text detection.", DetectorHealthState.PROVIDER_ERROR);
  }
  return normalizeCopyleaksResponse(await callCopyleaks(text));
}

export const copyleaksProvider = {
  id: "copyleaks",
  label: "Copyleaks",
  isConfigured,
  checkHealth,
  scanText,
};
