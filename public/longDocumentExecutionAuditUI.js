(() => {
  "use strict";

  const downstreamFetch = window.fetch.bind(window);
  let latestJob = null;
  let timer = null;

  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const pct = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;

  function scheduleRender() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(render, 120);
  }

  window.fetch = async function longDocumentExecutionAuditFetch(input, init = {}) {
    const response = await downstreamFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (/\/api\/jobs(?:\/|\?|$)/.test(url) && response.ok) {
      response.clone().json().then((job) => {
        if (!job?.id || !job?.progress) return;
        latestJob = job;
        scheduleRender();
      }).catch(() => {});
    }
    return response;
  };

  function replaceModeStatus(coverage) {
    const panel = document.getElementById("longdocVNextPanel");
    if (!panel || !coverage) return;
    const cells = [...panel.querySelectorAll(".longdoc-vnext-grid > div")];
    const cell = cells.find((node) => /selected-mode execution/i.test(node.textContent || ""));
    const strong = cell?.querySelector("strong");
    if (strong) strong.textContent = coverage.under_transformed_for_selected_mode ? "under-transformed" : coverage.enforced ? "executed" : "not enforced";
  }

  function render() {
    const job = latestJob;
    if (!job?.transformationCoverage || !job?.reassembledText) return;
    const output = document.getElementById("longdocOutput");
    if (!output) return;

    replaceModeStatus(job.transformationCoverage);

    let panel = document.getElementById("longdocExecutionAuditPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "longdocExecutionAuditPanel";
      panel.className = "longdoc-execution-audit";
      const vnext = document.getElementById("longdocVNextPanel");
      if (vnext?.nextSibling) vnext.parentNode.insertBefore(panel, vnext.nextSibling);
      else output.prepend(panel);
    }

    const c = job.transformationCoverage;
    const repair = job.coverageRepair || {};
    const options = job.requestedOptions || {};
    const targets = repair.targetChunkIndices || [];
    const repaired = repair.repairedChunkIndices || [];
    panel.classList.toggle("review", c.passed === false);
    panel.classList.toggle("passed", c.passed !== false);
    panel.innerHTML = `
      <div class="longdoc-execution-head">
        <strong>Selected-mode execution audit</strong>
        <span>${c.passed === false ? "REVIEW REQUIRED" : "PASSED"}</span>
      </div>
      <div class="longdoc-execution-grid">
        <div><span>Requested mode</span><strong>${esc(options.rewriteIntensity || "auto")} / ${esc(options.naturalisation || "faithful")}</strong></div>
        <div><span>Exact sentence retention</span><strong>${pct(c.exact_sentence_retention_ratio)}</strong></div>
        <div><span>Wholly unchanged paragraphs</span><strong>${pct(c.exact_paragraph_retention_ratio)}</strong></div>
        <div><span>Mode class</span><strong>${esc(c.mode_class || "n/a")}</strong></div>
        <div><span>Coverage recovery</span><strong>${repair.attempted ? `${repaired.length}/${targets.length} chunks` : "not required"}</strong></div>
      </div>
      ${repair.attempted ? `<p><strong>Coverage recovery:</strong> Davis detected that the first assembled candidate retained too much source architecture for the selected mode and re-ran targeted substantive chunks before the regularity repair. Targeted: ${targets.map(esc).join(", ") || "none"}. Reworked: ${repaired.map(esc).join(", ") || "none"}.</p>` : ""}
      ${c.passed === false ? `<p class="execution-warning"><strong>Davis did not accept “clean prose” as proof that the selected mode was executed.</strong> The final candidate still retains more source sentence/paragraph architecture than the selected ${esc(c.mode_class)} mode allows as a review signal.</p>` : ""}
      <p class="muted">${esc(c.note || "Transformation coverage is a mode-consistency diagnostic, not a quota to change every sentence.")}</p>`;
  }

  const style = document.createElement("style");
  style.textContent = `
    .longdoc-execution-audit{margin:.85rem 0;padding:1rem;border:1px solid #3f6f65;border-radius:10px;background:rgba(18,29,42,.52)}
    .longdoc-execution-audit.review{border-color:#a56c39}.longdoc-execution-head{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}
    .longdoc-execution-head span{opacity:.75}.longdoc-execution-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:.55rem;margin:.8rem 0}
    .longdoc-execution-grid>div{padding:.55rem;background:rgba(5,12,20,.35);border-radius:7px}.longdoc-execution-grid span{display:block;opacity:.7;font-size:.82em}.longdoc-execution-grid strong{display:block;margin-top:.2rem}
    .execution-warning{color:#ff7474}
  `;
  document.head.appendChild(style);
})();
