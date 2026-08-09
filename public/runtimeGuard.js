(() => {
  "use strict";

  // Keep same-origin API reads from leaving the editor in an indefinite loading
  // state when a browser connection becomes half-open. Provider-backed rewrite
  // POST requests retain their own server-side timeouts and are not altered here.
  const baseFetch = window.fetch.bind(window);
  const STARTUP_GET_TIMEOUT_MS = 12000;
  const STARTUP_PATHS = new Set([
    "/api/health",
    "/api/health/llm",
    "/api/style-profiles",
    "/api/methodology",
    "/api/health/detectors",
    "/api/detector-research/evidence",
  ]);

  function sameOriginPath(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      if (!raw) return null;
      const url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return null;
      return url.pathname;
    } catch {
      return null;
    }
  }

  window.fetch = function boundedStartupFetch(input, init = {}) {
    const method = String(init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
    const path = sameOriginPath(input);
    if (method !== "GET" || !path || !STARTUP_PATHS.has(path) || init?.signal) {
      return baseFetch(input, init);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort("startup-timeout"), STARTUP_GET_TIMEOUT_MS);
    return baseFetch(input, { ...init, signal: controller.signal }).finally(() => window.clearTimeout(timer));
  };

  function replaceIfStillLoading(id, loadingPattern, replacement) {
    const el = document.getElementById(id);
    if (!el) return;
    if (loadingPattern.test(String(el.textContent || ""))) el.textContent = replacement;
  }

  function surfaceRuntimeFailure(message) {
    const status = document.getElementById("statusMessage");
    if (!status) return;
    if (!status.textContent || /loading|checking|starting|pending/i.test(status.textContent)) {
      status.textContent = message;
      status.className = "status-message error";
    }
  }

  window.addEventListener("error", (event) => {
    const detail = event?.message ? `: ${event.message}` : "";
    surfaceRuntimeFailure(`Browser runtime error${detail}. The core editor remained available where possible.`);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason?.message || event?.reason || "request failed";
    surfaceRuntimeFailure(`Browser request failed: ${String(reason).slice(0, 180)}.`);
  });

  // This watchdog is independent of window.load. If app.js itself never reaches
  // its startup callbacks, the initial shell is still converted from a pending
  // state into an explicit degraded-state message rather than looking endless.
  window.setTimeout(() => {
    replaceIfStillLoading("llmStatus", /checking service status|LLM:\s*starting/i, "LLM: startup status unavailable");
    replaceIfStillLoading("buildBadge", /build:\s*(checking|pending)/i, "build: status unavailable");
    replaceIfStillLoading("sourceLimitHint", /loading/i, "Single editor available; capacity check timed out.");
    replaceIfStillLoading("longdocLimitHint", /loading/i, "Long-document capacity check timed out.");

    const methodology = document.getElementById("tab-methodology");
    if (methodology && /Loading corpus coverage/i.test(methodology.textContent || "")) {
      methodology.innerHTML = '<p class="muted">Corpus coverage did not load within 12 seconds. Core editing remains available.</p>';
    }

    const disclaimer = document.querySelector(".detector-disclaimer");
    if (disclaimer && /^\s*Loading…?\s*$/i.test(disclaimer.textContent || "")) {
      disclaimer.textContent = "Detector research status did not load. Core editing remains available.";
    }
  }, STARTUP_GET_TIMEOUT_MS + 500);
})();
