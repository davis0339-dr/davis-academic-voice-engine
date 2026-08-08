(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  let latestAnalysis = null;
  let latestRewrite = null;
  let renderQueued = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function pct(value) {
    return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "n/a";
  }

  function titleCase(value) {
    return String(value || "n/a").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
      renderQueued = false;
      renderPlannerDashboard();
      enhanceDiagnostics();
    }, 20);
  }

  async function mirrorAnalysisFromRewrite(input, init) {
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
      // Observability is supplementary; never block the user's revision request.
    }
  }

  window.fetch = async function plannerAwareFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const isAnalyse = /\/api\/analyse(?:\?|$)/.test(url);
    const isRewrite = /\/api\/rewrite(?:\?|$)/.test(url);

    let mirroredAnalysisPromise = null;
    if (isRewrite) mirroredAnalysisPromise = mirrorAnalysisFromRewrite(input, init);

    const response = await nativeFetch(input, init);
    if (isAnalyse || isRewrite) {
      response.clone().json().then((data) => {
        if (response.ok) {
          if (isAnalyse) latestAnalysis = data;
          if (isRewrite) latestRewrite = data;
          queueRender();
        }
      }).catch(() => {});
    }
    if (mirroredAnalysisPromise) mirroredAnalysisPromise.catch(() => {});
    return response;
  };

  function plannerData() {
    const plan = latestAnalysis?.plan || null;
    const rewrite = latestRewrite || null;
    return {
      plan,
      rewrite,
      intent: rewrite?.intervention_intent || plan?.intent || null,
      sequence: rewrite?.planner_sequence || plan?.sequence || [],
      paragraphSummary: rewrite?.paragraph_plan_summary || plan?.paragraphSummary || {},
      planSummary: rewrite?.intervention_plan_summary || plan?.summary || {},
      compliance: rewrite?.execution_compliance || null,
    };
  }

  function keepReasonSummary(plan) {
    const counts = {};
    for (const item of plan?.items || []) {
      if (item.level !== "KEEP") continue;
      const key = item.decisionCode || item.preservationClass || "KEEP";
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  function sumObject(obj) {
    return Object.values(obj || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  }

  function summaryChips(obj, className = "") {
    const entries = Object.entries(obj || {}).filter(([, count]) => Number(count) > 0);
    if (!entries.length) return '<span class="pov-muted">None</span>';
    return entries
      .map(([key, count]) => `<span class="pov-chip ${className}"><strong>${escapeHtml(key)}</strong> ${escapeHtml(count)}</span>`)
      .join(" ");
  }

  function renderPlannerDashboard() {
    const target = document.getElementById("tab-changes");
    if (!target) return;
    const { plan, rewrite, intent, sequence, paragraphSummary, planSummary, compliance } = plannerData();
    if (!plan && !rewrite) return;

    let dashboard = document.getElementById("plannerV3Dashboard");
    if (!dashboard) {
      dashboard = document.createElement("section");
      dashboard.id = "plannerV3Dashboard";
      dashboard.className = "pov-dashboard";
      target.prepend(dashboard);
    }

    const plannedTotal = sumObject(planSummary);
    const plannedKeep = Number(planSummary.KEEP || 0);
    const plannedIntervention = Math.max(0, plannedTotal - plannedKeep);
    const reported = compliance?.reported || null;
    const modelIntervention = reported ? reported.intervention : null;
    const status = compliance
      ? (compliance.passed ? "PASS" : "UNDER-EXECUTED")
      : "ANALYSIS ONLY";
    const statusClass = compliance?.passed ? "pass" : compliance ? "fail" : "neutral";

    const keepReasons = keepReasonSummary(plan);
    const rewritePatternCount = (plan?.items || []).filter((item) => item.decisionCode === "REWRITE_PATTERN").length;
    const architectureSignals = latestAnalysis?.diagnostics?.discourse_architecture?.signals || latestRewrite?.diagnostics?.discourse_architecture?.signals || [];

    const complianceDetail = compliance ? `
      <div class="pov-compliance ${statusClass}">
        <div><strong>Execution compliance: ${status}</strong> <span class="pov-score">score ${escapeHtml(compliance.score)}</span></div>
        <div class="pov-grid compact">
          <div><span>Planner intervention</span><strong>${plannedIntervention}/${plannedTotal}</strong></div>
          <div><span>Model-reported intervention</span><strong>${modelIntervention ?? "n/a"}</strong></div>
          <div><span>Intervention coverage</span><strong>${pct(compliance.intervention_coverage)}</strong></div>
          <div><span>Structural coverage</span><strong>${pct(compliance.structural_coverage)}</strong></div>
          <div><span>Unchanged sentences</span><strong>${pct(compliance.unchanged_sentence_ratio)}</strong></div>
          <div><span>Reconciliation retry</span><strong>${compliance.reconciliation_retry_used ? `yes (${escapeHtml(compliance.selected_attempt)})` : "no"}</strong></div>
        </div>
        ${(compliance.reasons || []).length ? `<div class="pov-reasons"><strong>Unresolved:</strong> ${compliance.reasons.map(escapeHtml).join(" ")}</div>` : ""}
        ${(compliance.warnings || []).length ? `<div class="pov-warnings"><strong>Watch:</strong> ${compliance.warnings.map(escapeHtml).join(" ")}</div>` : ""}
      </div>` : "";

    dashboard.innerHTML = `
      <div class="pov-title-row">
        <div><strong>Planner intelligence</strong><span class="pov-version">${escapeHtml(plan?.plannerVersion || rewrite?.planner_version || "")}</span></div>
        <span class="pov-intent">${escapeHtml(titleCase(intent?.effective || intent?.recommended))}</span>
      </div>
      <div class="pov-grid">
        <div><span>Recommended</span><strong>${escapeHtml(titleCase(intent?.recommended))}</strong></div>
        <div><span>Effective treatment</span><strong>${escapeHtml(titleCase(intent?.effective))}</strong></div>
        <div><span>Intervention budget</span><strong>${escapeHtml(intent?.budget?.label || plan?.interventionBudget?.label || "n/a")}</strong></div>
        <div><span>Discourse signals</span><strong>${architectureSignals.length}</strong></div>
        <div><span>Pattern-driven rewrites</span><strong>${rewritePatternCount}</strong></div>
        <div><span>Planner units</span><strong>${plannedTotal}</strong></div>
      </div>
      ${intent?.rationale?.length ? `<details class="pov-details"><summary>Why this treatment was selected</summary><ul>${intent.rationale.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul></details>` : ""}
      <div class="pov-section"><strong>Planner sequence</strong><div class="pov-sequence">${(sequence || []).map((s) => `<span>${escapeHtml(s.replace(/_/g, " "))}</span>`).join('<b>→</b>')}</div></div>
      <div class="pov-section"><strong>Paragraph/discourse actions</strong><div>${summaryChips(paragraphSummary, "paragraph")}</div></div>
      ${Object.keys(keepReasons).length ? `<div class="pov-section"><strong>Why sentences were kept</strong><div>${summaryChips(keepReasons, "keep")}</div></div>` : ""}
      ${architectureSignals.length ? `<details class="pov-details"><summary>Document-level discourse signals (${architectureSignals.length})</summary>${architectureSignals.map((s) => `<div class="pov-signal"><strong>${escapeHtml(s.id)}</strong> · ${escapeHtml(s.severity)}<br>${escapeHtml(s.interpretation)}</div>`).join("")}</details>` : ""}
      ${complianceDetail}
    `;
  }

  function groupRepeatedOpenings(items) {
    const groups = [];
    let current = null;
    for (const item of items || []) {
      if (item.issue !== "repeated_opening" || !Number.isInteger(item.sentenceIndex)) continue;
      const match = item.detail?.match(/open with "([^"]+)"/i);
      const opening = match?.[1] || "the same word";
      const index = item.sentenceIndex;
      if (current && current.opening.toLowerCase() === opening.toLowerCase() && index <= current.end + 1) {
        current.end = index;
      } else {
        current = { opening, start: Math.max(0, index - 2), end: index };
        groups.push(current);
      }
    }
    return groups.map((g) => ({ ...g, count: g.end - g.start + 1 }));
  }

  function enhanceDiagnostics() {
    const target = document.getElementById("tab-diagnostics");
    if (!target) return;
    const diagnostics = latestAnalysis?.diagnostics || latestRewrite?.diagnostics;
    if (!diagnostics) return;

    let panel = document.getElementById("plannerV3DiagnosticSummary");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "plannerV3DiagnosticSummary";
      panel.className = "pov-dashboard diagnostic";
      target.prepend(panel);
    }

    const architecture = diagnostics.discourse_architecture?.signals || [];
    const repeated = groupRepeatedOpenings(diagnostics.structural_monotony);
    const cadence = diagnostics.cadence_deviation;
    const cadenceStatus = cadence?.available
      ? `${escapeHtml(cadence.range_message || "Range position unavailable.")} ${cadence.threshold_flagged ? "A conservative deviation threshold was triggered." : "No conservative deviation threshold was triggered."}`
      : escapeHtml(cadence?.reason || "Cadence comparison unavailable.");

    panel.innerHTML = `
      <div class="pov-title-row"><strong>Consolidated writing-quality diagnosis</strong><span class="pov-version">document-level first</span></div>
      ${cadence ? `<div class="pov-range ${cadence.threshold_flagged ? "warn" : ""}"><strong>Cadence:</strong> ${cadenceStatus}</div>` : ""}
      ${repeated.length ? `<div class="pov-section"><strong>Repeated opening runs</strong>${repeated.map((g) => `<div class="pov-signal">Sentences ${g.start + 1}–${g.end + 1}: ${g.count} consecutive sentences begin with “${escapeHtml(g.opening)}”.</div>`).join("")}</div>` : ""}
      ${architecture.length ? `<div class="pov-section"><strong>Discourse architecture</strong>${architecture.map((s) => `<div class="pov-signal"><strong>${escapeHtml(s.id)}</strong> · ${escapeHtml(s.severity)} — ${escapeHtml(s.interpretation)}</div>`).join("")}</div>` : '<div class="pov-section"><strong>Discourse architecture</strong><span class="pov-muted"> No document-level architecture signal triggered.</span></div>'}
      <details class="pov-details"><summary>Interpretation boundary</summary><p>These are writing-quality and style-fit diagnostics. They describe patterns in the supplied text and measured corpus family; they do not establish authorship.</p></details>
    `;

    // Correct the legacy UI sentence that equated "no threshold flag" with
    // "inside the raw observed range". The backend now reports both concepts
    // separately, so the display must do the same.
    if (cadence?.available) {
      target.querySelectorAll("p.muted").forEach((p) => {
        if (/Within the observed range for this family/i.test(p.textContent || "")) {
          p.textContent = cadence.range_message + (cadence.threshold_flagged
            ? " A conservative deviation threshold was triggered."
            : " No conservative deviation threshold was triggered.");
        }
      });
    }
  }

  function installStyles() {
    if (document.getElementById("plannerObservabilityStyles")) return;
    const style = document.createElement("style");
    style.id = "plannerObservabilityStyles";
    style.textContent = `
      .pov-dashboard{margin:0 0 18px;padding:16px;border:1px solid #304158;border-radius:10px;background:rgba(28,42,59,.55);line-height:1.45}
      .pov-dashboard.diagnostic{margin-top:4px}
      .pov-title-row{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}
      .pov-version{margin-left:8px;font-size:.82em;opacity:.65}
      .pov-intent{padding:4px 9px;border-radius:999px;background:#183a31;color:#62e0b0;font-size:.85em;font-weight:700}
      .pov-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:8px;margin:10px 0 14px}
      .pov-grid.compact{margin:8px 0}
      .pov-grid>div{padding:8px 10px;background:rgba(8,16,26,.45);border-radius:7px}
      .pov-grid span{display:block;font-size:.78em;opacity:.68;margin-bottom:2px}
      .pov-section{margin-top:12px}
      .pov-chip{display:inline-block;margin:5px 4px 0 0;padding:4px 7px;border:1px solid #43526a;border-radius:6px;font-size:.82em}
      .pov-chip.paragraph{border-color:#4e5f87}.pov-chip.keep{border-color:#365a4c}
      .pov-sequence{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:.78em}
      .pov-sequence span{padding:3px 6px;background:rgba(8,16,26,.45);border-radius:5px}.pov-sequence b{opacity:.45}
      .pov-details{margin-top:10px}.pov-details summary{cursor:pointer;color:#a9bedf}.pov-details ul{margin:7px 0 0 20px}
      .pov-signal{margin-top:7px;padding:7px 9px;border-left:3px solid #50698e;background:rgba(8,16,26,.32)}
      .pov-compliance{margin-top:14px;padding:11px;border-radius:8px;border:1px solid}.pov-compliance.pass{border-color:#2a775a;background:rgba(22,86,61,.18)}.pov-compliance.fail{border-color:#a04a4a;background:rgba(105,34,34,.18)}.pov-compliance.neutral{border-color:#53657a}
      .pov-score{font-size:.8em;opacity:.7;margin-left:6px}.pov-reasons{margin-top:8px;color:#ffb1b1}.pov-warnings{margin-top:8px;color:#e8c77b}
      .pov-range{padding:9px 10px;background:rgba(8,16,26,.4);border-radius:7px}.pov-range.warn{border-left:3px solid #d7a544}.pov-muted{opacity:.65}
    `;
    document.head.appendChild(style);
  }

  installStyles();

  const observer = new MutationObserver(() => queueRender());
  const changes = document.getElementById("tab-changes");
  const diagnostics = document.getElementById("tab-diagnostics");
  if (changes) observer.observe(changes, { childList: true, subtree: false });
  if (diagnostics) observer.observe(diagnostics, { childList: true, subtree: false });
})();
