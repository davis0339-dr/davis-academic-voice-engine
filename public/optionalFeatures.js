(() => {
  "use strict";

  const SCRIPT_TIMEOUT_MS = 8000;
  const loaded = new Map();

  // These modules directly enrich Analyse/Rewrite responses, so they stay with
  // the editor. The Researcher Studio, evidence-development UI and detector
  // evidence base are deliberately excluded from this workspace.
  const EDITOR_ENHANCERS = [
    ["/researchEnhancements.js", null],
    ["/plannerObservability.js", null],
    ["/rewriteVerdict.js", null],
    ["/authorialTextureUI.js", null],
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
      // Yield a frame between modules so the browser can paint and respond.
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  async function loadDetectorLab() {
    const status = document.getElementById("detectorStatus");
    const analyse = document.getElementById("analyseDetectorResearchBtn");
    const add = document.getElementById("addDetectorObservationBtn");
    const clear = document.getElementById("clearDetectorObservationsBtn");
    if (status) status.textContent = "Loading measured detector diagnostics…";
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
