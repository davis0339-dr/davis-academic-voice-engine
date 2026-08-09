(() => {
  "use strict";

  const OPTIONAL_SCRIPTS = [
    ["/researchEnhancements.js", null],
    ["/plannerObservability.js", null],
    ["/rewriteVerdict.js", null],
    ["/researchStudioUI.js", "research-studio-ui"],
    ["/researchStudioCapabilitiesUI.js", "research-studio-capabilities-ui"],
    ["/detectorEvidenceUI.js", "detector-evidence-ui"],
    ["/detectorResearchUI.js", "detector-research-ui"],
    ["/authorialTextureUI.js", null],
  ];

  const SCRIPT_TIMEOUT_MS = 8000;

  function loadOne(src, dataKey) {
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      if (dataKey) script.dataset[dataKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = "true";

      let settled = false;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ src, status });
      };

      script.onload = () => finish("loaded");
      script.onerror = () => finish("failed");
      const timer = setTimeout(() => finish("timed_out"), SCRIPT_TIMEOUT_MS);
      document.body.appendChild(script);
    });
  }

  async function loadOptionalFeatures() {
    for (const [src, dataKey] of OPTIONAL_SCRIPTS) {
      await loadOne(src, dataKey);
    }
  }

  if (document.readyState === "complete") {
    setTimeout(loadOptionalFeatures, 0);
  } else {
    window.addEventListener("load", () => setTimeout(loadOptionalFeatures, 0), { once: true });
  }
})();
