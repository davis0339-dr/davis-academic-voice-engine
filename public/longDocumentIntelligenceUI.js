(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const HANDOFF_KEY = "academicVoice.longdocEvidenceNeeds.v1";
  const BENCHMARK_KEY = "academicVoice.longdocBenchmarks.v2";
  let latestJob = null;
  let renderTimer = null;

  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  function schedule(job) {
    latestJob = job;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 80);
  }

  window.fetch = async function longDocumentIntelligenceFetch(input, init) {
    const response = await nativeFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (/\/api\/jobs(?:\/|\?|$)/.test(url) && response.ok) {
      response.clone().json().then((data) => {
        if (data?.id && data?.progress) schedule(data);
      }).catch(() => {});
    }
    return response;
  };

  function evidenceNeeds(job) {
    return job?.wholeDocumentBlueprint?.evidence_needs || [];
  }

  function readBenchmarks(jobId) {
    try {
      const rows = JSON.parse(localStorage.getItem(BENCHMARK_KEY) || "[]");
      return Array.isArray(rows) ? rows.filter((row) => row?.jobId === jobId) : [];
    } catch { return []; }
  }

  function sendEvidenceNeeds(job) {
    const needs = evidenceNeeds(job);
    if (!needs.length) return;
    const includeEvidence = Boolean(document.getElementById("longdocIncludeEvidence")?.checked);
    const status = document.getElementById("longdocStatus");
    if (!includeEvidence) {
      if (status) status.textContent = "Enable ‘Include external evidence’ first. Evidence development is researcher-controlled and will not be activated implicitly.";
      return;
    }
    try {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify({
        createdAt: new Date().toISOString(),
        documentGoal: job.wholeDocumentBlueprint?.document_goal || "",
        jobId: job.id,
        needs,
        includeEvidence: true,
        evidenceDepth: document.getElementById("longdocEvidenceDepth")?.value || "targeted",
        sourceText: document.getElementById("longdocSource")?.value || "",
        candidateText: job.reassembledText || "",
        wholeDocumentAudit: job.wholeDocumentAudit || null,
        externalDetectorResults: readBenchmarks(job.id),
      }));
      window.location.href = "/studio?handoff=longdoc-evidence";
    } catch (err) {
      if (status) status.textContent = `Could not prepare evidence handoff: ${err.message}`;
    }
  }

  function phaseLabel(phase) {
    const labels = {
      queued: "Queued",
      whole_document_understanding: "Reading the whole document",
      chunk_revision: "Local revision with whole-document context",
      whole_document_audit: "Whole-document regularisation audit",
      selective_global_repair: "Selective global repair",
      complete: "Complete",
      complete_review_required: "Complete — researcher review required",
      chunk_retry: "Chunk retry",
    };
    return labels[phase] || String(phase || "Working").replace(/_/g, " ");
  }

  function renderBlueprint(job) {
    const blueprint = job.wholeDocumentBlueprint;
    if (!blueprint) {
      return `<section class="longdoc-intelligence-panel"><div class="longdoc-intelligence-title"><strong>Whole-document intelligence</strong><span>${esc(phaseLabel(job.phase))}</span></div><p class="muted">Davis is reading the complete manuscript before deciding how individual chunks should be treated.</p></section>`;
    }
    const needs = evidenceNeeds(job);
    const arc = blueprint.argument_arc || [];
    const lengthContract = job.documentLengthContract;
    const expandStatus = lengthContract?.mode === "expand"
      ? `<div><span>Expand contract</span><strong>${lengthContract.satisfied ? "+" + esc(lengthContract.actual_addition_words) + " words" : "not met"} (minimum +${esc(lengthContract.minimum_addition_words)})</strong></div>`
      : "";
    return `<section class="longdoc-intelligence-panel">
      <div class="longdoc-intelligence-title"><strong>Whole-document intelligence</strong><span>${esc(phaseLabel(job.phase))}</span></div>
      <p><strong>Document end goal:</strong> ${esc(blueprint.document_goal || "Not available")}</p>
      <div class="longdoc-intelligence-grid">
        <div><span>Argument stages mapped</span><strong>${arc.length}</strong></div>
        <div><span>Evidence needs identified</span><strong>${needs.length}</strong></div>
        <div><span>Planning basis</span><strong>${esc(blueprint.generated_by || "n/a")}</strong></div>
        <div><span>Candidate status</span><strong>${esc((job.candidateStatus || "in progress").replace(/_/g, " "))}</strong></div>
        ${expandStatus}
      </div>
      ${blueprint.planning_warning ? `<p class="warning-item">${esc(blueprint.planning_warning)}</p>` : ""}
      <details><summary>Argument arc</summary>${arc.map((item) => `<div class="longdoc-arc-item"><strong>${esc(item.heading || "stage")}</strong><p>${esc(item.role || "")}</p>${item.downstream_dependency ? `<p class="muted">Feeds into: ${esc(item.downstream_dependency)}</p>` : ""}</div>`).join("")}</details>
      ${needs.length ? `<details><summary>Research Evidence Bank needs (${needs.length})</summary>${needs.map((need) => `<div class="longdoc-evidence-need"><strong>${esc(need.section || need.need_type || "Evidence need")}</strong><p>${esc(need.query)}</p><p class="muted">${esc(need.rationale || "")}</p></div>`).join("")}<button type="button" data-send-longdoc-evidence>Improve this reworked candidate in Research & Evidence Studio</button></details>` : '<p class="muted">No external evidence need was identified in the current whole-document planning pass.</p>'}
    </section>`;
  }

  function renderAudit(job) {
    const audit = job.wholeDocumentAudit;
    if (!audit) return "";
    const passed = Boolean(audit.passed);
    const repair = job.globalRepair || {};
    return `<section class="longdoc-global-audit ${passed ? "passed" : "review"}">
      <div class="longdoc-intelligence-title"><strong>Whole-document reassembly audit</strong><span>${passed ? "PASSED" : "REVIEW REQUIRED"}</span></div>
      <div class="longdoc-intelligence-grid">
        <div><span>Source regularity risk</span><strong>${esc(audit.source_risk)}</strong></div>
        <div><span>Candidate regularity risk</span><strong>${esc(audit.revised_risk)}</strong></div>
        <div><span>Risk change</span><strong>${audit.risk_delta > 0 ? "+" : ""}${esc(audit.risk_delta)}</strong></div>
        <div><span>Cross-chunk homogenisation ratio</span><strong>${esc(audit.homogenisation_ratio)}</strong></div>
      </div>
      ${audit.systemic_signal_ids?.length ? `<p><strong>Systemic patterns:</strong> ${audit.systemic_signal_ids.map((id) => esc(id.replace(/_/g, " "))).join(", ")}</p>` : ""}
      ${repair.attempted ? `<p><strong>Selective global repair:</strong> targeted chunks ${(repair.targetChunkIndices || []).join(", ") || "none"}; repaired ${(repair.repairedChunkIndices || []).join(", ") || "none"}.</p>` : ""}
      <p class="muted">${esc(audit.note || "")}</p>
      ${!passed ? '<p class="warning-item bad"><strong>Davis did not silently accept this reassembled candidate.</strong> Cross-chunk regularisation remains above the source-relative safeguard and researcher review is required.</p>' : ""}
    </section>`;
  }

  function render() {
    const job = latestJob;
    if (!job) return;
    const progress = document.getElementById("longdocProgress");
    if (progress) {
      let panel = document.getElementById("longdocIntelligencePanel");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "longdocIntelligencePanel";
        progress.prepend(panel);
      }
      panel.innerHTML = renderBlueprint(job);
      panel.querySelector("[data-send-longdoc-evidence]")?.addEventListener("click", () => sendEvidenceNeeds(job));
    }

    if (job.wholeDocumentAudit) {
      const output = document.getElementById("longdocOutput");
      if (output) {
        let auditPanel = document.getElementById("longdocGlobalAuditPanel");
        if (!auditPanel) {
          auditPanel = document.createElement("div");
          auditPanel.id = "longdocGlobalAuditPanel";
          output.prepend(auditPanel);
        }
        auditPanel.innerHTML = renderAudit(job);
      }
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    .longdoc-intelligence-panel,.longdoc-global-audit{margin:.8rem 0;padding:1rem;border:1px solid #47647a;border-radius:10px;background:rgba(22,31,44,.48)}
    .longdoc-intelligence-title{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}.longdoc-intelligence-title span{opacity:.72}
    .longdoc-intelligence-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:.5rem;margin:.7rem 0}.longdoc-intelligence-grid>div{padding:.55rem;background:rgba(5,12,20,.35);border-radius:7px}.longdoc-intelligence-grid span{display:block;opacity:.7;font-size:.82em}.longdoc-intelligence-grid strong{display:block;margin-top:.2rem}
    .longdoc-arc-item,.longdoc-evidence-need{padding:.6rem 0;border-bottom:1px solid #364b5e}.longdoc-arc-item p,.longdoc-evidence-need p{margin:.25rem 0}.longdoc-global-audit.passed{border-color:#2f7b63}.longdoc-global-audit.review{border-color:#a56c39}
  `;
  document.head.appendChild(style);
})();
