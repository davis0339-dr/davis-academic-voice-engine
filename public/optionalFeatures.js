(() => {
  "use strict";

  const SCRIPT_TIMEOUT_MS = 8000;
  const loaded = new Map();

  // These modules directly enrich Analyse/Rewrite responses, so they stay with
  // the editor. The corrected manuscript counter loads first so all later
  // observability panels use the same approximate lexical count as server limits.
  // Rewrite lineage then loads before other fetch wrappers so later wrappers see
  // the lineage-enriched request rather than bypass it. Long Document intelligence
  // is display/handoff only and does not alter the 1,500-word editor controls.
  const EDITOR_ENHANCERS = [
    ["/wordCountCompatibility.js", null],
    ["/rewriteLineage.js", null],
    ["/detectorQuickBridge.js", null],
    ["/candidateRefinementUI.js", null],
    ["/detectorEvidenceUploadUX.js", null],
    ["/plannerObservability.js", null],
    ["/argumentativePlannerUI.js", null],
    ["/rewriteVerdict.js", null],
    ["/authorialTextureUI.js", null],
    ["/longDocumentIntelligenceUI.js", null],
    ["/longDocumentVNextUI.js", null],
    ["/longDocumentExecutionAuditUI.js", null],
  ];

  function dataProperty(dataKey) {
    return dataKey ? dataKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : null;
  }

  function loadOne(src, dataKey) {
    if (loaded.has(src)) return loaded.get(src);
    const promise = new Promise((resolve) => {
      const existing = [...document.scripts].find((script) => script.src && new URL(script.src, location.href).pathname === src);
      if (existing) return resolve({ src, status: "already_loaded" });

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      const prop = dataProperty(dataKey);
      if (prop) script.dataset[prop] = "true";

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
    loaded.set(src, promise);
    return promise;
  }

  async function loadEditorEnhancers() {
    for (const [src, dataKey] of EDITOR_ENHANCERS) {
      await loadOne(src, dataKey);
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  async function loadDetectorLab() {
    const status = document.getElementById("detectorStatus");
    const analyse = document.getElementById("analyseDetectorResearchBtn");
    const add = document.getElementById("addDetectorObservationBtn");
    const clear = document.getElementById("clearDetectorObservationsBtn");
    if (status) status.textContent = "Loading measured detector diagnostics…";

    if (!document.querySelector('script[data-detector-evidence-ui="true"]')) {
      const marker = document.createElement("script");
      marker.type = "application/json";
      marker.dataset.detectorEvidenceUi = "true";
      marker.textContent = '{"workspace":"studio"}';
      document.head.appendChild(marker);
    }

    const result = await loadOne("/detectorResearchUI.js", "detector-research-ui");
    const ok = result.status === "loaded" || result.status === "already_loaded";
    if (analyse) analyse.disabled = !ok;
    if (add) add.disabled = !ok;
    if (clear) clear.disabled = !ok;
    if (status) status.textContent = ok
      ? "Detector diagnostics ready. Source ↔ revised quick comparison remains linked to the editor."
      : "Detector diagnostics could not load. The editor remains fully usable.";
  }

  function bindDetectorLazyLoad() {
    const button = document.querySelector('.tab-header[data-tab="detectorqa"]');
    if (!button) return;
    let requested = false;
    const request = () => {
      if (requested) return;
      requested = true;
      loadDetectorLab();
    };
    button.addEventListener("click", request);
  }

  function start() {
    bindDetectorLazyLoad();
    loadEditorEnhancers();
  }

  if (document.readyState === "complete") setTimeout(start, 0);
  else window.addEventListener("load", () => setTimeout(start, 0), { once: true });
})();
