(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  let latestAnalysis = null;
  let latestRewrite = null;
  let renderTimer = null;

  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const pct = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "n/a";
  const title = (value) => String(value || "n/a").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  const sum = (obj) => Object.values(obj || {}).reduce((total, value) => total + (Number(value) || 0), 0);

  function statusLabel(compliance) {
    if (!compliance) return "ANALYSIS ONLY";
    const raw = compliance.execution_status || (compliance.execution_passed ? "passed" : "under-executed");
    if (raw === "surgical_plan_passed") return "SURGICAL PASS";
    if (raw === "surgical_partial") return "SURGICAL PARTIAL";
    if (raw === "conflicting-execution") return "CONFLICTING";
    return raw.replace(/_/g, " ").toUpperCase();
  }

  function statusClass(compliance) {
    if (!compliance) return "neutral";
    if (compliance.execution_passed) return "pass";
    if (compliance.execution_status === "conflicting-execution" || compliance.execution_status === "surgical_partial") return "warn";
    return "fail";
  }

  function summaryChips(obj, cls = "") {
    const entries = Object.entries(obj || {}).filter(([, value]) => Number(value) > 0);
    if (!entries.length) return '<span class="pov-muted">None</span>';
    return entries.map(([key, value]) => `<span class="pov-chip ${cls}"><strong>${esc(key)}</strong> ${esc(value)}</span>`).join(" ");
  }

  function keepReasonSummary(plan) {
    const out = {};
    for (const item of plan?.items || []) {
      if (item.level !== "KEEP") continue;
      const key = item.decisionCode || item.preservationClass || "KEEP";
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }

  function signalIds(diag) {
    return (diag?.discourse_architecture?.signals || []).map((signal) => signal.id);
  }

  function residualState(rewrite) {
    if (!rewrite) return "not run";
    if (rewrite.candidate_verdict?.residual) return title(rewrite.candidate_verdict.residual);
    if (rewrite.execution_compliance?.residual_stage_blocked_reason) return `Blocked: ${title(rewrite.execution_compliance.residual_stage_blocked_reason)}`;
    if (rewrite.residual_rework?.attempted) return rewrite.residual_rework.accepted ? "Run · Improved" : "Run · Unresolved/Rejected";
    return "Not Required";
  }

  function queueRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAll, 40);
  }

  async function mirrorAnalysis(init) {
    try {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (!body?.text) return;
      const response = await nativeFetch("/api/analyse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) return;
      latestAnalysis = await response.json();
      queueRender();
    } catch {
      // Observability never blocks revision.
    }
  }

  window.fetch = async function plannerAwareFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const isAnalyse = /\/api\/analyse(?:\?|$)/.test(url);
    const isRewrite = /\/api\/rewrite(?:\?|$)/.test(url);
    const mirrored = isRewrite ? mirrorAnalysis(init) : null;
    const response = await nativeFetch(input, init);
    if (isAnalyse || isRewrite) {
      response.clone().json().then((data) => {
        if (!response.ok) return;
        if (isAnalyse) latestAnalysis = data;
        if (isRewrite) latestRewrite = data;
        queueRender();
      }).catch(() => {});
    }
    if (mirrored) mirrored.catch(() => {});
    return response;
  };

  function renderPlanner() {
    const target = document.getElementById("tab-changes");
    if (!target) return;
    const plan = latestAnalysis?.plan || null;
    const rewrite = latestRewrite || null;
    if (!plan && !rewrite) return;

    const intent = rewrite?.intervention_intent || plan?.intent || {};
    const sequence = rewrite?.planner_sequence || plan?.sequence || [];
    const paragraphSummary = rewrite?.paragraph_plan_summary || plan?.paragraphSummary || {};
    const planSummary = rewrite?.intervention_plan_summary || plan?.summary || {};
    const compliance = rewrite?.execution_compliance || null;
    const planned = compliance?.planned || {};
    const reported = compliance?.reported || {};
    const totalUnits = planned.total ?? sum(planSummary);
    const discourseScope = planned.discourseRepackage ?? Number(planSummary.DISCOURSE_REPACKAGE || 0);
    const concretePlanned = planned.intervention ?? Math.max(0, totalUnits - Number(planSummary.KEEP || 0) - discourseScope);
    const materialScope = planned.materialIntervention ?? Math.max(0, totalUnits - Number(planSummary.KEEP || 0));
    const keepReasons = keepReasonSummary(plan);
    const rewritePatternCount = (plan?.items || []).filter((item) => item.decisionCode === "REWRITE_PATTERN").length;
    const sourceArchitecture = latestAnalysis?.diagnostics?.discourse_architecture?.signals || [];
    const postDiag = rewrite?.post_rewrite_diagnostics || rewrite?.residual_rework?.after || rewrite?.residual_rework?.before || null;
    const postArchitecture = postDiag?.discourse_architecture?.signals || [];

    let dashboard = document.getElementById("plannerV3Dashboard");
    if (!dashboard) {
      dashboard = document.createElement("section");
      dashboard.id = "plannerV3Dashboard";
      dashboard.className = "pov-dashboard";
      target.prepend(dashboard);
    }

    const status = statusLabel(compliance);
    const complianceHtml = compliance ? `
      <div class="pov-compliance ${statusClass(compliance)}">
        <div class="pov-title-row"><strong>Execution evidence: ${esc(status)}</strong><span class="pov-score">score ${esc(compliance.execution_score ?? compliance.score ?? "n/a")}</span></div>
        <div class="pov-grid compact">
          <div><span>Concrete planned operations</span><strong>${esc(concretePlanned)}</strong></div>
          <div><span>Discourse-repackage scope</span><strong>${esc(discourseScope)}</strong></div>
          <div><span>Material in intervention scope</span><strong>${esc(materialScope)}/${esc(totalUnits)}</strong></div>
          <div><span>Model-reported concrete edits</span><strong>${esc(reported.intervention ?? "n/a")}</strong></div>
          <div><span>Concrete coverage</span><strong>${pct(compliance.intervention_coverage)}</strong></div>
          <div><span>Structural coverage</span><strong>${pct(compliance.structural_coverage)}</strong></div>
          <div><span>Changed sentences</span><strong>${pct(compliance.changed_sentence_ratio)}</strong></div>
          <div><span>Minimum plausibility floor</span><strong>${pct(compliance.minimum_changed_sentence_ratio)}</strong></div>
          <div><span>Maximum disturbance ceiling</span><strong>${pct(compliance.changed_sentence_ceiling)}</strong></div>
          <div><span>Residual discourse stage</span><strong>${esc(residualState(rewrite))}</strong></div>
        </div>
        <div class="pov-boundary"><strong>Interpretation:</strong> the minimum is a plausibility safeguard, not a rewrite target. The maximum is an authorised ceiling, not a goal. DISCOURSE_REPACKAGE is paragraph-level scope and is not counted as one compulsory rewrite per source sentence.</div>
        ${(compliance.execution_reasons || compliance.reasons || []).length ? `<div class="pov-reasons"><strong>Execution issue:</strong> ${(compliance.execution_reasons || compliance.reasons).map(esc).join(" ")}</div>` : ""}
        ${(compliance.warnings || []).length ? `<div class="pov-warnings"><strong>Watch:</strong> ${compliance.warnings.map(esc).join(" ")}</div>` : ""}
      </div>` : "";

    const evidenceSummary = rewrite ? `
      <div class="pov-test-evidence">
        <strong>Test evidence summary</strong>
        <span>planner ${esc(plan?.plannerVersion || rewrite?.planner_version || "n/a")}</span>
        <span>execution ${esc(status)}</span>
        <span>preservation ${esc(rewrite.candidate_verdict?.preservation || (compliance?.preservation_ok ? "passed" : "n/a"))}</span>
        <span>residual ${esc(residualState(rewrite))}</span>
        <span>final ${esc(title(rewrite.candidate_verdict?.final_status || compliance?.candidate_status || "n/a"))}</span>
        ${rewrite.requestId ? `<span>request ${esc(rewrite.requestId)}</span>` : ""}
        ${rewrite.build?.commitShort ? `<span>build ${esc(rewrite.build.commitShort)}</span>` : ""}
      </div>` : "";

    dashboard.innerHTML = `
      <div class="pov-title-row">
        <div><strong>Planner intelligence</strong><span class="pov-version">${esc(plan?.plannerVersion || rewrite?.planner_version || "")}</span></div>
        <span class="pov-intent">${esc(title(intent.effective || intent.recommended))}</span>
      </div>
      <div class="pov-grid">
        <div><span>Recommended</span><strong>${esc(title(intent.recommended))}</strong></div>
        <div><span>Effective treatment</span><strong>${esc(title(intent.effective))}</strong></div>
        <div><span>Intervention budget</span><strong>${esc(intent.budget?.label || plan?.interventionBudget?.label || "n/a")}</strong></div>
        <div><span>Source discourse signals</span><strong>${sourceArchitecture.length}</strong></div>
        <div><span>Pattern-driven sentence rewrites</span><strong>${rewritePatternCount}</strong></div>
        <div><span>Planner units</span><strong>${totalUnits}</strong></div>
      </div>
      ${intent.rationale?.length ? `<details class="pov-details"><summary>Why this treatment was selected</summary><ul>${intent.rationale.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></details>` : ""}
      <div class="pov-section"><strong>Planner sequence</strong><div class="pov-sequence">${sequence.map((item) => `<span>${esc(item.replace(/_/g, " "))}</span>`).join("<b>→</b>")}</div></div>
      <div class="pov-section"><strong>Paragraph/discourse actions</strong><div>${summaryChips(paragraphSummary, "paragraph")}</div></div>
      ${Object.keys(keepReasons).length ? `<div class="pov-section"><strong>Why sentences were kept</strong><div>${summaryChips(keepReasons, "keep")}</div></div>` : ""}
      ${sourceArchitecture.length ? `<details class="pov-details"><summary>Source discourse signals (${sourceArchitecture.length})</summary>${sourceArchitecture.map((signal) => `<div class="pov-signal"><strong>${esc(signal.id)}</strong> · ${esc(signal.severity)}<br>${esc(signal.interpretation)}</div>`).join("")}</details>` : ""}
      ${rewrite ? `<details class="pov-details"><summary>Post-rewrite discourse signals (${postArchitecture.length})</summary>${postArchitecture.length ? postArchitecture.map((signal) => `<div class="pov-signal"><strong>${esc(signal.id)}</strong> · ${esc(signal.severity)}<br>${esc(signal.interpretation)}</div>`).join("") : '<div class="pov-muted">No residual discourse-architecture signal was reported in the final candidate.</div>'}</details>` : ""}
      ${complianceHtml}
      ${evidenceSummary}
    `;
  }

  function renderDiagnostics() {
    const target = document.getElementById("tab-diagnostics");
    const diagnostics = latestAnalysis?.diagnostics || latestRewrite?.diagnostics;
    if (!target || !diagnostics) return;
    let panel = document.getElementById("plannerV3DiagnosticSummary");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "plannerV3DiagnosticSummary";
      panel.className = "pov-dashboard diagnostic";
      target.prepend(panel);
    }
    const sourceSignals = diagnostics.discourse_architecture?.signals || [];
    const post = latestRewrite?.post_rewrite_diagnostics;
    const postSignals = post?.discourse_architecture?.signals || [];
    panel.innerHTML = `
      <div class="pov-title-row"><strong>Consolidated discourse diagnosis</strong><span class="pov-version">source → candidate</span></div>
      <div class="pov-grid compact">
        <div><span>Source architecture signals</span><strong>${sourceSignals.length}</strong></div>
        <div><span>Final residual signals</span><strong>${latestRewrite ? postSignals.length : "n/a"}</strong></div>
        <div><span>Residual stage</span><strong>${esc(residualState(latestRewrite))}</strong></div>
      </div>
      ${sourceSignals.length ? `<div class="pov-section"><strong>Source</strong>${sourceSignals.map((s) => `<div class="pov-signal"><strong>${esc(s.id)}</strong> · ${esc(s.severity)} — ${esc(s.interpretation)}</div>`).join("")}</div>` : '<div class="pov-section"><strong>Source</strong><span class="pov-muted"> No document-level architecture signal triggered.</span></div>'}
      ${latestRewrite ? (postSignals.length ? `<div class="pov-section"><strong>Final candidate</strong>${postSignals.map((s) => `<div class="pov-signal"><strong>${esc(s.id)}</strong> · ${esc(s.severity)} — ${esc(s.interpretation)}</div>`).join("")}</div>` : '<div class="pov-section"><strong>Final candidate</strong><span class="pov-muted"> No residual architecture signal reported.</span></div>') : ""}
      <details class="pov-details"><summary>Interpretation boundary</summary><p>These are writing-quality and style-fit diagnostics. They do not establish authorship, and they are not detector-score targets.</p></details>
    `;
  }

  function renderAll() {
    renderPlanner();
    renderDiagnostics();
  }

  const style = document.createElement("style");
  style.id = "plannerObservabilityStyles";
  style.textContent = `
    .pov-dashboard{margin:0 0 18px;padding:16px;border:1px solid #304158;border-radius:10px;background:rgba(28,42,59,.55);line-height:1.45}
    .pov-dashboard.diagnostic{margin-top:4px}.pov-title-row{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}
    .pov-version{margin-left:8px;font-size:.82em;opacity:.65}.pov-intent{padding:4px 9px;border-radius:999px;background:#183a31;color:#62e0b0;font-size:.85em;font-weight:700}
    .pov-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:8px;margin:10px 0 14px}.pov-grid.compact{margin:8px 0}.pov-grid>div{padding:8px 10px;background:rgba(8,16,26,.45);border-radius:7px}.pov-grid span{display:block;font-size:.78em;opacity:.68;margin-bottom:2px}
    .pov-section{margin-top:12px}.pov-chip{display:inline-block;margin:5px 4px 0 0;padding:4px 7px;border:1px solid #43526a;border-radius:6px;font-size:.82em}.pov-chip.paragraph{border-color:#4e5f87}.pov-chip.keep{border-color:#365a4c}
    .pov-sequence{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:.78em}.pov-sequence span{padding:3px 6px;background:rgba(8,16,26,.45);border-radius:5px}.pov-sequence b{opacity:.45}
    .pov-details{margin-top:10px}.pov-details summary{cursor:pointer;color:#a9bedf}.pov-details ul{margin:7px 0 0 20px}.pov-signal{margin-top:7px;padding:7px 9px;border-left:3px solid #50698e;background:rgba(8,16,26,.32)}
    .pov-compliance{margin-top:14px;padding:11px;border-radius:8px;border:1px solid}.pov-compliance.pass{border-color:#2a775a;background:rgba(22,86,61,.18)}.pov-compliance.warn{border-color:#9d7b34;background:rgba(104,78,31,.18)}.pov-compliance.fail{border-color:#a04a4a;background:rgba(105,34,34,.18)}.pov-compliance.neutral{border-color:#53657a}
    .pov-score{font-size:.8em;opacity:.7}.pov-boundary{margin-top:8px;padding:8px;border-left:3px solid #5d79a4;background:rgba(5,11,18,.28);font-size:.84em}.pov-reasons{margin-top:8px;color:#ffb1b1}.pov-warnings{margin-top:8px;color:#e8c77b}.pov-muted{opacity:.65}
    .pov-test-evidence{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;padding:9px;background:rgba(5,11,18,.32);border-radius:7px}.pov-test-evidence strong{flex-basis:100%}.pov-test-evidence span{padding:3px 6px;border:1px solid #43526a;border-radius:5px;font-size:.8em}
  `;
  document.head.appendChild(style);
})();
