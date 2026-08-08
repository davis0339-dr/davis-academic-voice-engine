(() => {
  "use strict";

  const upstreamFetch = window.fetch.bind(window);
  let latest = null;
  let timer = null;

  function esc(value) {
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

  function label(value) {
    return String(value || "n/a").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function render() {
    const target = document.getElementById("tab-changes");
    if (!target || !latest) return;

    const texture = latest.authorial_texture || latest.source_assessment?.authorial_texture;
    const authority = latest.intervention_authority;
    const policy = latest.rewrite_mode_policy;
    const compliance = latest.execution_compliance;
    if (!texture && !authority) return;

    let panel = document.getElementById("authorialTextureV5");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "authorialTextureV5";
      panel.className = "atv5-panel";
      const planner = document.getElementById("plannerV3Dashboard");
      if (planner) planner.insertAdjacentElement("afterend", panel);
      else target.prepend(panel);
    }

    const changed = compliance?.changed_sentence_ratio;
    const ceiling = compliance?.changed_sentence_ceiling ?? authority?.max_changed_sentence_ratio;
    const status = compliance?.execution_status;

    panel.innerHTML = `
      <div class="atv5-title"><strong>Authorial texture & intervention authority</strong><span>preservation-first · not an authorship detector</span></div>
      <div class="atv5-grid">
        <div><span>Existing texture</span><strong>${esc(label(texture?.label))}</strong></div>
        <div><span>Texture score</span><strong>${pct(texture?.score)}</strong></div>
        <div><span>Preservation priority</span><strong>${esc(label(texture?.preservation_priority))}</strong></div>
        <div><span>Rewrite breadth</span><strong>${esc(label(authority?.breadth || texture?.recommended_breadth))}</strong></div>
        <div><span>Depth permission</span><strong>${esc(label(authority?.depth_permission || policy?.depth_permission))}</strong></div>
        <div><span>Maximum changed sentences</span><strong>${pct(ceiling)}</strong></div>
      </div>
      ${policy ? `<div class="atv5-policy"><strong>Mode resolution:</strong> ${esc(label(policy.requested_intensity))} → ${esc(label(policy.effective_intensity))}; ${esc(label(policy.requested_naturalisation))} → ${esc(label(policy.effective_naturalisation))}. ${esc(policy.rationale || "")}</div>` : ""}
      ${compliance ? `<div class="atv5-execution ${status === "passed" ? "good" : "warn"}"><strong>Intervention fidelity:</strong> ${esc(label(status))}. Actual changed sentences: ${pct(changed)}; authorised ceiling: ${pct(ceiling)}.</div>` : ""}
      <details><summary>Why preservation priority was assigned</summary>
        <div class="atv5-components">
          ${Object.entries(texture?.components || {}).map(([key, value]) => `<span>${esc(label(key))}: <strong>${pct(value)}</strong></span>`).join("")}
        </div>
        <p>${esc(texture?.note || "")}</p>
      </details>
    `;

    if (compliance?.execution_status) {
      const legacy = document.querySelector("#plannerV3Dashboard .pov-compliance > div > strong");
      if (legacy && /Execution compliance:/i.test(legacy.textContent || "")) {
        legacy.textContent = `Execution compliance: ${String(compliance.execution_status).toUpperCase()}`;
      }
    }
  }

  function queue() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(render, 100);
  }

  window.fetch = async function authorialTextureFetch(input, init) {
    const response = await upstreamFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (/\/api\/(?:analyse|rewrite)(?:\?|$)/.test(url)) {
      response.clone().json().then((data) => {
        if (response.ok) {
          latest = data;
          queue();
        }
      }).catch(() => {});
    }
    return response;
  };

  const style = document.createElement("style");
  style.textContent = `
    .atv5-panel{margin:0 0 18px;padding:16px;border:1px solid #3e536d;border-radius:10px;background:rgba(21,33,48,.76);line-height:1.45}
    .atv5-title{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}.atv5-title span{font-size:.8em;opacity:.65}
    .atv5-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.atv5-grid>div{padding:8px 10px;background:rgba(4,10,18,.4);border-radius:7px}.atv5-grid span{display:block;font-size:.76em;opacity:.68}.atv5-policy,.atv5-execution{margin-top:10px;padding:8px 10px;border-left:3px solid #557296;background:rgba(4,10,18,.28)}.atv5-execution.good{border-left-color:#2b845f}.atv5-execution.warn{border-left-color:#b56b4a}.atv5-panel details{margin-top:10px}.atv5-panel summary{cursor:pointer;color:#a9bedf}.atv5-components{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.atv5-components span{padding:4px 7px;border:1px solid #465b74;border-radius:5px;font-size:.8em}.atv5-panel p{font-size:.82em;opacity:.7}
  `;
  document.head.appendChild(style);
})();

// Load the research-only detector comparison layer after all existing fetch
// wrappers have installed so it can observe configured detector scans without
// changing the rewrite pipeline itself.
(() => {
  if (document.querySelector('script[data-detector-research-ui="true"]')) return;
  const script = document.createElement("script");
  script.src = "/detectorResearchUI.js";
  script.dataset.detectorResearchUi = "true";
  script.defer = true;
  document.head.appendChild(script);
})();
