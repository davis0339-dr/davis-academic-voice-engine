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
    if ([
      "passed",
      "accepted",
      "improved",
      "not_required",
      "surgical_local_recovery",
      "surgical_plan_passed",
      "within-authorised-band",
      "not_applicable_surgical_plan",
      "within-root-register-band",
      "single-pass-within-source-register-band",
    ].includes(value)) return "good";
    if ([
      "passed-with-variance",
      "below-plausibility-floor",
      "accepted_with_execution_variance",
      "accepted_with_residual_risks",
      "unresolved_or_rejected",
      "execution_under",
      "source-preserved",
      "surgical_partial",
    ].includes(value)) return "warn";
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

  function driftStatus(iterative) {
    if (!iterative?.available) return "not-applicable";
    if (iterative.blocking) {
      return iterative.mode === "rewrite_chain"
        ? "rewrite-chain-regularisation-risk"
        : "single-pass-formalisation-risk";
    }
    return iterative.mode === "rewrite_chain"
      ? "within-root-register-band"
      : "single-pass-within-source-register-band";
  }

  function finalDisplayStatus(verdict, iterative) {
    if (!iterative?.blocking) return verdict?.final_status || "n/a";
    if (["execution_under", "execution_over", "execution_conflict", "preservation_failed", "execution_and_preservation_failed", "no_safe_edit_available"].includes(verdict?.final_status)) {
      return verdict.final_status;
    }
    return "review-required-regularisation-risk";
  }

  function formatDelta(value, multiplier = 1, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "n/a";
    const adjusted = n * multiplier;
    return `${adjusted > 0 ? "+" : ""}${adjusted.toFixed(digits)}`;
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
    const iterative = latestRewrite.iterative_rewrite_quality || null;
    const beforeRisk = residual?.before?.metrics?.total_risk_score;
    const afterRisk = residual?.attempted_after?.metrics?.total_risk_score ?? residual?.after?.metrics?.total_risk_score;
    const sourceRisk = residual?.source_risk_score;
    const beforeSignals = riskSignals(residual?.before);
    const afterSignals = riskSignals(residual?.after);
    const rejectChips = rejectionChips(surgical?.rejection_summary);
    const visiblePlausibility = compliance.visible_change_plausibility_status || "not_assessed";
    const varianceReasons = compliance.execution_variance_reasons || [];
    const drift = driftStatus(iterative);
    const finalStatus = finalDisplayStatus(verdict, iterative);
    const driftReasons = iterative?.reasons || [];
    const deltas = iterative?.deltas_from_root || {};

    panel.innerHTML = `
      <div class="rv4-title"><strong>Candidate verdict</strong><span>different ≠ automatically better</span></div>
      <div class="rv4-grid">
        <div class="${statusClass(verdict.execution)}"><span>Plan execution</span><strong>${esc(title(verdict.execution))}</strong></div>
        <div class="${statusClass(visiblePlausibility)}"><span>Visible-change plausibility</span><strong>${esc(title(visiblePlausibility))}</strong></div>
        <div class="${statusClass(verdict.preservation)}"><span>Factual preservation</span><strong>${esc(title(verdict.preservation))}</strong></div>
        <div class="${statusClass(verdict.residual)}"><span>Residual rework</span><strong>${esc(title(verdict.residual))}</strong></div>
        <div class="${statusClass(drift)}"><span>Lexical / structural drift</span><strong>${esc(title(drift))}</strong></div>
        <div class="${statusClass(finalStatus)}"><span>Final candidate</span><strong>${esc(title(finalStatus))}</strong></div>
      </div>
      ${varianceReasons.length ? `<div class="rv4-variance"><strong>Execution variance, not rewrite instruction:</strong> ${varianceReasons.map(esc).join(" ")}</div>` : ""}
      ${policy ? `<div class="rv4-policy"><strong>Rewrite policy:</strong> ${esc(title(policy.policy))}. ${esc(policy.rationale || "")}</div>` : ""}
      ${iterative?.available ? `
        <div class="rv4-regularisation ${iterative.blocking ? "badbox" : "goodbox"}">
          <strong>${iterative.blocking ? "Rewrite regularisation requires review" : "Rewrite register stayed within the source-relative guard"}</strong>
          <span>mode ${esc(title(iterative.mode))}</span>
          <span>score ${esc(iterative.score)}</span>
          ${Number(iterative.source_generation) > 0 ? `<span>source generation ${esc(iterative.source_generation)}</span>` : ""}
          <div class="rv4-deltas">
            <span>nominalisation Δ ${esc(formatDelta(deltas.nominalisation_per_1k, 1, 1))}/1k</span>
            <span>long-word Δ ${esc(formatDelta(deltas.long_word_ratio, 100, 1))} pp</span>
            <span>avg-word-length Δ ${esc(formatDelta(deltas.avg_word_length, 1, 2))}</span>
            <span>sentence-mean Δ ${esc(formatDelta(deltas.sentence_mean, 1, 1))}</span>
            <span>opening-diversity Δ ${esc(formatDelta(deltas.sentence_initial_diversity, 100, 1))} pp</span>
          </div>
          ${driftReasons.length ? `<details ${iterative.blocking ? "open" : ""}><summary>Why this ${iterative.blocking ? "was flagged" : "was measured"}</summary><div>${driftReasons.map((reason) => `<p>${esc(reason)}</p>`).join("")}</div></details>` : ""}
          <div>${esc(iterative.note || "")}</div>
        </div>
      ` : ""}
      ${surgical?.attempted ? `
        <div class="rv4-surgical ${surgical.execution_status === "surgical_plan_passed" && !compliance.deep_plan_superseded_by_surgical_fallback ? "goodbox" : "warnbox"}">
          <strong>${surgical.safe_change_made ? "Defect-led human-text edit applied" : "Defect-led edit found no safe change"}</strong>
          <span>${esc(surgical.applied_edit_count || 0)} correction(s) applied across ${esc(surgical.affected_sentence_count || 0)} sentence(s)</span>
          <span>${esc(surgical.proposed_edit_count || 0)} proposed · ${esc((surgical.rejected_edits || []).length)} rejected</span>
          ${Number.isFinite(Number(surgical.edit_acceptance_ratio)) ? `<span>safe-edit acceptance ${esc(Math.round(Number(surgical.edit_acceptance_ratio) * 100))}%</span>` : ""}
          ${surgical.omission_audit_used ? `<span>omission audit: used · ${esc(surgical.omission_audit_proposed || 0)} additional proposal(s)</span>` : `<span>omission audit: not required</span>`}
          <div>${esc(surgical.note || "")}</div>
          ${rejectChips ? `<details><summary>Why proposed edits were rejected</summary><div class="rv4-chips">${rejectChips}</div></details>` : ""}
        </div>
        ${compliance.planner_superseded ? `<div class="rv4-superseded"><strong>Broad plan superseded:</strong> ${compliance.deep_plan_superseded_by_surgical_fallback ? "the bounded local recovery did not fulfil the requested Deep structural intervention. It remains a preservation-safe fallback, not a successful Deep reconstruction." : "the original whole-document rewrite was rejected for over-editing. The execution verdict above measures the bounded defect-led recovery rather than comparing a local repair against the discarded broad plan."}</div>` : ""}
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
          ${residual.residual_preservation_repair?.attempted ? `<span>preservation repair: ${residual.residual_preservation_repair.passed ? "passed" : "failed"}</span>` : ""}
        </div>
        ${residual.reason ? `<div class="rv4-note">${esc(residual.reason)}</div>` : ""}
        ${beforeSignals.length ? `<details><summary>Residual signals before local rework (${beforeSignals.length})</summary><div class="rv4-chips">${beforeSignals.map((s) => `<span>${esc(s)}</span>`).join("")}</div></details>` : ""}
        ${afterSignals.length ? `<details><summary>Residual signals in accepted candidate (${afterSignals.length})</summary><div class="rv4-chips">${afterSignals.map((s) => `<span>${esc(s)}</span>`).join("")}</div></details>` : ""}
      ` : ""}
      ${(compliance.preservation_reasons || []).length ? `<div class="rv4-alert"><strong>Preservation failure:</strong> ${compliance.preservation_reasons.map(esc).join(" ")}</div>` : ""}
      ${iterative?.blocking && verdict.final_status === "accepted" ? `<div class="rv4-alert"><strong>Candidate not cleared as successful in the UI:</strong> execution and factual preservation passed, but the source-relative regularisation gate still detected lexical/structural drift. Review or regenerate rather than treating this as a completed authorial recovery.</div>` : ""}
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
    .rv4-residual,.rv4-surgical,.rv4-regularisation{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;padding:9px;background:rgba(5,11,18,.35);border-radius:7px}.rv4-surgical>div,.rv4-regularisation>div{flex-basis:100%;font-size:.86em;opacity:.82}.rv4-surgical.goodbox,.rv4-regularisation.goodbox{border:1px solid #2c7658}.rv4-surgical.warnbox{border:1px solid #9d7b34}.rv4-regularisation.badbox{border:1px solid #9b4a4a;background:rgba(115,35,35,.12)}
    .rv4-deltas{display:flex!important;flex-wrap:wrap;gap:6px!important}.rv4-deltas span{padding:3px 6px;border:1px solid #52617a;border-radius:5px;font-size:.8em}.rv4-regularisation details{flex-basis:100%;margin-top:0}.rv4-regularisation p{margin:.35rem 0}
    .rv4-superseded{margin-top:9px;padding:8px 10px;border-left:3px solid #8c6f3f;background:rgba(104,78,31,.18);font-size:.87em}.rv4-nonedit{margin-top:12px;padding:10px;border:1px solid #b45a5a;border-radius:7px;background:rgba(115,35,35,.22)}.rv4-nonedit strong{display:block;color:#ffb1b1;margin-bottom:4px}
    .rv4-note,.rv4-alert,.rv4-foot{margin-top:9px}.rv4-alert{padding:8px;border-left:3px solid #b35353;background:rgba(115,35,35,.2)}.rv4-foot{font-size:.82em;opacity:.68}.rv4-panel details{margin-top:9px}.rv4-panel summary{cursor:pointer;color:#a9bedf}.rv4-chips span{display:inline-block;margin:5px 5px 0 0;padding:3px 6px;border:1px solid #52617a;border-radius:5px;font-size:.8em}
  `;
  document.head.appendChild(style);
})();
