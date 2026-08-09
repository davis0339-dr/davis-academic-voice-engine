(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  let latestAnalysis = null;
  let latestRewrite = null;
  let timer = null;

  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const title = (value) => String(value || "n/a").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  const pct = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "n/a";

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(render, 60);
  }

  window.fetch = async function argumentativePlannerFetch(input, init) {
    const response = await nativeFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (/\/api\/analyse(?:\?|$)/.test(url) || /\/api\/rewrite(?:\?|$)/.test(url)) {
      response.clone().json().then((data) => {
        if (!response.ok) return;
        if (/\/api\/analyse(?:\?|$)/.test(url)) latestAnalysis = data;
        else latestRewrite = data;
        schedule();
      }).catch(() => {});
    }
    return response;
  };

  function render() {
    const host = document.getElementById("tab-changes");
    if (!host) return;
    const plan = latestAnalysis?.plan || null;
    const sufficiency = plan?.argumentativeSufficiency || null;
    const authority = latestRewrite?.intervention_authority || null;
    const texture = latestRewrite?.authorial_texture || latestRewrite?.source_assessment?.authorial_texture || null;
    if (!sufficiency && !authority) return;

    let panel = document.getElementById("argumentativeDevelopmentDashboard");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "argumentativeDevelopmentDashboard";
      panel.className = "argdev-dashboard";
      const planner = document.getElementById("plannerV3Dashboard");
      if (planner?.nextSibling) planner.parentNode.insertBefore(panel, planner.nextSibling);
      else host.prepend(panel);
    }

    const signals = sufficiency?.signals || [];
    const signalCounts = signals.reduce((acc, signal) => {
      acc[signal.id] = (acc[signal.id] || 0) + 1;
      return acc;
    }, {});
    const signalChips = Object.entries(signalCounts).map(([key, count]) => `<span><strong>${esc(key)}</strong> ${esc(count)}</span>`).join(" ");
    const need = sufficiency?.development_need || "not assessed";

    panel.innerHTML = `
      <div class="argdev-title"><div><strong>Argumentative sufficiency & selective development</strong><span>${esc(sufficiency?.version || "planner development layer")}</span></div><strong class="argdev-need ${esc(need)}">${esc(title(need))}</strong></div>
      <div class="argdev-grid">
        <div><span>Existing texture</span><strong>${texture ? esc(title(texture.label)) : "analysis pending"}</strong></div>
        <div><span>Texture score</span><strong>${texture && Number.isFinite(Number(texture.score)) ? `${Math.round(Number(texture.score) * 100)}%` : "n/a"}</strong></div>
        <div><span>Preservation priority</span><strong>${esc(title(texture?.preservation_priority || "n/a"))}</strong></div>
        <div><span>Argument development need</span><strong>${esc(title(need))}</strong></div>
        <div><span>Development score</span><strong>${esc(sufficiency?.development_score ?? "n/a")}</strong></div>
        <div><span>Affected paragraphs</span><strong>${pct(sufficiency?.affected_paragraph_ratio)}</strong></div>
        <div><span>Development permission</span><strong>${esc(title(authority?.discourse_development_permission || "pending rewrite"))}</strong></div>
        <div><span>Depth permission</span><strong>${esc(title(authority?.depth_permission || "pending rewrite"))}</strong></div>
      </div>
      <div class="argdev-rule"><strong>Core rule:</strong> strong authorial texture does not automatically mean the argument is sufficiently developed. Preserve good wording while developing only diagnosed evidence, conditions, measures, setting, time context or gap. Word-count growth is never the target.</div>
      ${signalChips ? `<div class="argdev-signals"><strong>Development signals</strong><div>${signalChips}</div></div>` : '<div class="argdev-signals"><strong>Development signals</strong><span class="muted"> None triggered.</span></div>'}
      ${sufficiency?.interpretation ? `<details><summary>Why this matters</summary><p>${esc(sufficiency.interpretation)}</p><p class="muted">${esc(sufficiency.guardrail || "")}</p></details>` : ""}
      ${authority?.rule ? `<details><summary>Current author-choice authority</summary><p>${esc(authority.rule)}</p></details>` : ""}`;
  }

  const style = document.createElement("style");
  style.textContent = `
    .argdev-dashboard{margin:0 0 18px;padding:16px;border:1px solid #44677a;border-radius:10px;background:rgba(24,47,57,.48);line-height:1.45}.argdev-title{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}.argdev-title>div{display:flex;gap:.55rem;align-items:baseline;flex-wrap:wrap}.argdev-title span{opacity:.65;font-size:.82em}.argdev-need{padding:.25rem .55rem;border-radius:999px;background:rgba(98,224,176,.1);color:#62e0b0}.argdev-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:.55rem;margin:.8rem 0}.argdev-grid>div{padding:.6rem;background:rgba(7,17,24,.35);border-radius:7px}.argdev-grid span{display:block;opacity:.7;font-size:.82em}.argdev-grid strong{display:block;margin-top:.18rem}.argdev-rule{padding:.75rem;border-left:3px solid #62e0b0;background:rgba(5,13,18,.3)}.argdev-signals{margin-top:.75rem}.argdev-signals>div{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem}.argdev-signals span{border:1px solid #496174;border-radius:999px;padding:.2rem .45rem;font-size:.82em}.argdev-dashboard details{margin-top:.65rem}
  `;
  document.head.appendChild(style);
})();
