(() => {
  "use strict";

  const upstreamFetch = window.fetch.bind(window);
  let latestRewrite = null;
  let renderTimer = null;

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function title(value) {
    return String(value || "n/a").replace(/[_-]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function statusClass(value) {
    if (["passed", "accepted", "improved", "not_required", "surgical_local_recovery", "surgical_plan_passed", "within-authorised-band", "not_applicable_surgical_plan"].includes(value)) return "good";
    if (["passed-with-variance", "below-plausibility-floor", "accepted_with_execution_variance", "accepted_with_residual_risks", "unresolved_or_rejected", "execution_under", "source-preserved", "surgical_partial"].includes(value)) return "warn";
    return "bad";
  }

  function riskSignals(diag) {
    return (diag?.signals || []).map((signal) => signal.id);
  }

  function rejectionChips(summary) {
    return Object.entries(summary || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([reason, count]) => `<span>${esc(title(reason))}: ${esc(count)}</span>`)
      .join("");
  }

  function relabelAggressiveMode() {
    const select = document.getElementById("naturalisation");
    if (!select) return;
    const option = [...select.options].find((item) => item.value === "aggressive");
    if (option) option.textContent = "Aggressive / Adaptive reconstruction";
    select.title = "Aggressive mode permits deep reconstruction where diagnostics justify it; it does not force every clean sentence or paragraph to change.";
  }

  function render() {
    const target = document.getElementById("tab-changes");
    if (!target || !latestRewrite?.candidate_verdict) return;

    let panel = document.getElementById("candidateVerdictV4");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "candidateVerdictV4";
      panel.className = "rv4-panel";
      const planner = document.getElementById("plannerV3Dashboard");
      if (planner?.parentNode === target) planner.insertAdjacentElement("afterend", panel);
      else target.prepend(panel);
    }

    const verdict = latestRewrite.candidate_verdict;
    const compliance = latestRewrite.execution_compliance || {};
    const residual = latestRewrite.residual_rework || null;
    const surgical = latestRewrite.surgical_recovery || null;
    const safetyFallback = latestRewrite.safety_fallback || null;
    const policy = latestRewrite.rewrite_mode_policy || null;
    const beforeRisk = residual?.before?.metrics?.total_risk_score;
    const afterRisk = residual?.attempted_after?.metrics?.total_risk_score ?? residual?.after?.metrics?.total_risk_score;
    const sourceRisk = residual?.source_risk_score;
    const beforeSignals = riskSignals(residual?.before);
    const afterSignals = riskSignals(residual?.after);
    const rejectChips = rejectionChips(surgical?.rejection_summary);
    const visiblePlausibility = compliance.visible_change_plausibility_status || "not_assessed";
    const varianceReasons = compliance.execution_variance_reasons || [];

    panel.innerHTML = `
      <div class="rv4-title"><strong>Candidate verdict</strong><span>different ≠ automatically better</span></div>
      <div class="rv4-grid">
        <div class="${statusClass(verdict.execution)}"><span>Plan execution</span><strong>${esc(title(verdict.execution))}</strong></div>
        <div class="${statusClass(visiblePlausibility)}"><span>Visible-change plausibility</span><strong>${esc(title(visiblePlausibility))}</strong></div>
        <div class="${statusClass(verdict.preservation)}"><span>Factual preservation</span><strong>${esc(title(verdict.preservation))}</strong></div>
        <div class="${statusClass(verdict.residual)}"><span>Residual rework</span><strong>${esc(title(verdict.residual))}</strong></div>
        <div class="${statusClass(verdict.final_status)}"><span>Final candidate</span><strong>${esc(title(verdict.final_status))}</strong></div>
      </div>
      ${varianceReasons.length ? `<div class="rv4-variance"><strong>Execution variance, not rewrite instruction:</strong> ${varianceReasons.map(esc).join(" ")}</div>` : ""}
      ${policy ? `<div class="rv4-policy"><strong>Rewrite policy:</strong> ${esc(title(policy.policy))}. ${esc(policy.rationale || "")}</div>` : ""}
      ${surgical?.attempted ? `
        <div class="rv4-surgical ${surgical.execution_status === "surgical_plan_passed" ? "goodbox" : "warnbox"}">
          <strong>${surgical.safe_change_made ? "Defect-led human-text edit applied" : "Defect-led edit found no safe change"}</strong>
          <span>${esc(surgical.applied_edit_count || 0)} correction(s) applied across ${esc(surgical.affected_sentence_count || 0)} sentence(s)</span>
          <span>${esc(surgical.proposed_edit_count || 0)} proposed · ${esc((surgical.rejected_edits || []).length)} rejected</span>
          ${Number.isFinite(Number(surgical.edit_acceptance_ratio)) ? `<span>safe-edit acceptance ${esc(Math.round(Number(surgical.edit_acceptance_ratio) * 100))}%</span>` : ""}
          ${surgical.omission_audit_used ? `<span>omission audit: used · ${esc(surgical.omission_audit_proposed || 0)} additional proposal(s)</span>` : `<span>omission audit: not required</span>`}
          <div>${esc(surgical.note || "")}</div>
          ${rejectChips ? `<details><summary>Why proposed edits were rejected</summary><div class="rv4-chips">${rejectChips}</div></details>` : ""}
        </div>
        ${compliance.planner_superseded ? `<div class="rv4-superseded"><strong>Broad plan superseded:</strong> the original whole-document rewrite was rejected for over-editing. The execution verdict above now measures the bounded defect-led recovery rather than comparing a local repair against the discarded broad plan.</div>` : ""}
      ` : ""}
      ${safetyFallback?.source_retained ? `
        <div class="rv4-nonedit">
          <strong>No revision applied</strong>
          <div>${esc(safetyFallback.reason || "The source was returned unchanged because no safe edit survived the preservation safeguards.")}</div>
        </div>
      ` : ""}
      ${residual ? `
        <div class="rv4-residual">
          <strong>Selective residual pass</strong>
          <span>${residual.attempted ? "attempted" : "not needed"}${residual.accepted ? " · accepted" : residual.attempted ? " · prior candidate retained" : ""}</span>
          ${Number.isFinite(Number(sourceRisk)) ? `<span>source risk ${esc(sourceRisk)}</span>` : ""}
          ${Number.isFinite(Number(beforeRisk)) ? `<span>candidate risk ${esc(beforeRisk)}${Number.isFinite(Number(afterRisk)) ? ` → attempted ${esc(afterRisk)}` : ""}</span>` : ""}
          ${(residual.target_blocks || []).length ? `<span>target blocks: ${residual.target_blocks.map(esc).join(", ")}</span>` : ""}
        </div>
        ${residual.reason ? `<div class="rv4-note">${esc(residual.reason)}</div>` : ""}
        ${beforeSignals.length ? `<details><summary>Residual signals before local rework (${beforeSignals.length})</summary><div class="rv4-chips">${beforeSignals.map((s) => `<span>${esc(s)}</span>`).join("")}</div></details>` : ""}
        ${afterSignals.length ? `<details><summary>Residual signals in accepted candidate (${afterSignals.length})</summary><div class="rv4-chips">${afterSignals.map((s) => `<span>${esc(s)}</span>`).join("")}</div></details>` : ""}
      ` : ""}
      ${(compliance.preservation_reasons || []).length ? `<div class="rv4-alert"><strong>Preservation failure:</strong> ${compliance.preservation_reasons.map(esc).join(" ")}</div>` : ""}
      <div class="rv4-foot">${esc(verdict.note || "")}</div>
    `;
  }

  function queueRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  window.fetch = async function verdictAwareFetch(input, init) {
    const response = await upstreamFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (/\/api\/rewrite(?:\?|$)/.test(url)) {
      response.clone().json().then((data) => {
        if (response.ok) {
          latestRewrite = data;
          queueRender();
        }
      }).catch(() => {});
    }
    return response;
  };

  relabelAggressiveMode();
  window.addEventListener("DOMContentLoaded", relabelAggressiveMode, { once: true });

  const style = document.createElement("style");
  style.textContent = `
    .rv4-panel{margin:0 0 18px;padding:16px;border:1px solid #405269;border-radius:10px;background:rgba(22,31,44,.72);line-height:1.45}
    .rv4-title{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px}.rv4-title span{font-size:.82em;opacity:.62}
    .rv4-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:8px}.rv4-grid>div{padding:9px 10px;border-radius:7px;background:rgba(5,11,18,.42);border:1px solid #485568}.rv4-grid span{display:block;font-size:.78em;opacity:.66}.rv4-grid .good{border-color:#2c7658}.rv4-grid .warn{border-color:#9d7b34}.rv4-grid .bad{border-color:#9b4a4a}
    .rv4-policy,.rv4-variance{margin-top:12px;padding:9px 10px;border-left:3px solid #5d79a4;background:rgba(5,11,18,.32)}.rv4-variance{border-left-color:#9d7b34;background:rgba(104,78,31,.18)}
    .rv4-residual,.rv4-surgical{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;padding:9px;background:rgba(5,11,18,.35);border-radius:7px}.rv4-surgical>div{flex-basis:100%;font-size:.86em;opacity:.78}.rv4-surgical.goodbox{border:1px solid #2c7658}.rv4-surgical.warnbox{border:1px solid #9d7b34}.rv4-superseded{margin-top:9px;padding:8px 10px;border-left:3px solid #8c6f3f;background:rgba(104,78,31,.18);font-size:.87em}.rv4-nonedit{margin-top:12px;padding:10px;border:1px solid #b45a5a;border-radius:7px;background:rgba(115,35,35,.22)}.rv4-nonedit strong{display:block;color:#ffb1b1;margin-bottom:4px}
    .rv4-note,.rv4-alert,.rv4-foot{margin-top:9px}.rv4-alert{padding:8px;border-left:3px solid #b35353;background:rgba(115,35,35,.2)}.rv4-foot{font-size:.82em;opacity:.68}.rv4-panel details{margin-top:9px}.rv4-panel summary{cursor:pointer;color:#a9bedf}.rv4-chips span{display:inline-block;margin:5px 5px 0 0;padding:3px 6px;border:1px solid #52617a;border-radius:5px;font-size:.8em}
  `;
  document.head.appendChild(style);
})();
