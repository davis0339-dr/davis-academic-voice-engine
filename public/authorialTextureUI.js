(() => {
  "use strict";

  const upstreamFetch = window.fetch.bind(window);
  let latest = null;
  let timer = null;

  function esc(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function pct(value) { return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "n/a"; }
  function label(value) { return String(value || "n/a").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()); }

  function authorChoiceMessage(policy, latestResult) {
    if (!policy) return "";
    const recommended = latestResult?.intervention_intent?.recommended || latestResult?.plan?.intent?.recommended;
    const effective = latestResult?.intervention_intent?.effective || latestResult?.plan?.intent?.effective;
    const capped = recommended && effective && recommended !== effective && ["minor", "moderate"].includes(policy.requested_intensity);
    if (capped) {
      return `Diagnosis recommends ${label(recommended)}, but the author selected ${label(policy.requested_intensity)}. The deeper recommendation remains visible for information only; this run is intentionally capped at ${label(effective)}.`;
    }
    if (policy.requested_intensity === "minor") return "Minor is being treated as a hard authorial ceiling: local wording/grammar/clarity edits only, even if deeper issues are diagnosed.";
    if (policy.requested_intensity === "moderate") return "Moderate is being treated as a hard authorial ceiling: sentence and flow repair may occur, but full discourse reconstruction is not silently substituted.";
    if (policy.requested_intensity === "auto") return "Auto leaves intervention depth to diagnosis; the recommendation and the executed treatment should therefore normally align.";
    return "Deep grants broader authority where the selected mode permits it; breadth remains permission rather than a sentence-change quota.";
  }

  function textureReasoning(texture) {
    const positive = texture?.authorial_texture?.positive_evidence_score;
    const penalty = texture?.authorial_texture?.regularity_penalty;
    const regularity = texture?.machine_pattern_regularity;
    const signals = regularity?.signals || [];
    const componentHtml = Object.entries(texture?.authorial_texture?.components || texture?.components || {})
      .map(([key, value]) => `<span>${esc(label(key))}: <strong>${pct(value)}</strong></span>`)
      .join("");
    const regularityHtml = Object.entries(regularity?.components || {})
      .map(([key, value]) => `<span>${esc(label(key))}: <strong>${pct(value)}</strong></span>`)
      .join("");
    const signalHtml = signals.length
      ? signals.map((signal) => `<span class="atv5-signal">${esc(label(signal))}</span>`).join("")
      : '<span class="atv5-muted">No high-threshold regularity signal was triggered.</span>';

    return `
      <details><summary>Why the authorial-texture judgement was assigned</summary>
        <p><strong>Important:</strong> grammar, clarity, citation density, technical sophistication and generic coherence do not directly create authorial-texture strength.</p>
        <div class="atv5-subhead">Positive authorial/discourse evidence</div>
        <div class="atv5-components">${componentHtml || '<span class="atv5-muted">No component detail returned.</span>'}</div>
        <p>Positive evidence score: <strong>${pct(positive)}</strong>. Machine-pattern regularity penalty applied to texture: <strong>${pct(penalty)}</strong>.</p>
        <div class="atv5-subhead">Machine-pattern regularity</div>
        <div class="atv5-components">${regularityHtml || '<span class="atv5-muted">No regularity component detail returned.</span>'}</div>
        <div class="atv5-signals">${signalHtml}</div>
        <p>${esc(texture?.note || "")}</p>
      </details>`;
  }

  function forensicReasoning(forensics) {
    if (!forensics?.available) return "";
    const metricHtml = Object.entries(forensics.metrics || {})
      .map(([key, value]) => {
        const numeric = Number(value);
        const rendered = Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? pct(numeric) : esc(value);
        return `<span>${esc(label(key))}: <strong>${rendered}</strong></span>`;
      }).join("");
    const signalHtml = (forensics.signals || []).length
      ? forensics.signals.map((signal) => `
          <div class="atv5-forensic-signal">
            <strong>${esc(label(signal.forensic_id || signal.issue || signal.id))} · ${esc(label(signal.severity))}</strong>
            <p>${esc(signal.interpretation || "")}</p>
            <p><em>Action:</em> ${esc(signal.action || "")}</p>
          </div>`).join("")
      : '<span class="atv5-muted">No cross-paragraph forensic signal crossed the intervention threshold.</span>';

    return `
      <details class="atv5-forensics"><summary>Cross-paragraph detective layer: what pattern was found?</summary>
        <p>This layer examines recurring rhetorical sequencing across narrative prose rather than judging grammar or polish. Purpose statements, research questions, hypotheses and other formal academic artefacts are excluded from the score.</p>
        <div class="atv5-components">${metricHtml}</div>
        <p>Rhetorical asymmetry: <strong>${pct(forensics.rhetorical_asymmetry_score)}</strong>. Narrative paragraphs assessed: <strong>${esc(forensics.narrative_paragraph_count)}</strong>. Formal artefact blocks excluded: <strong>${esc(forensics.formal_artifact_block_count || 0)}</strong>.</p>
        <div class="atv5-forensic-list">${signalHtml}</div>
        <p>${esc(forensics.note || "")}</p>
      </details>`;
  }

  function render() {
    const target = document.getElementById("tab-changes");
    if (!target || !latest) return;
    const texture = latest.authorial_texture || latest.source_assessment?.authorial_texture;
    const forensics = latest.discourse_regularity_forensics || latest.source_assessment?.discourse_regularity_forensics || texture?.discourse_regularity_forensics;
    const authority = latest.intervention_authority;
    const policy = latest.rewrite_mode_policy;
    const compliance = latest.execution_compliance;
    const diagnosticBreadth = authority?.breadth_enforcement === "diagnostic";
    if (!texture && !authority) return;

    let panel = document.getElementById("authorialTextureV5");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "authorialTextureV5";
      panel.className = "atv5-panel";
      const planner = document.getElementById("plannerV3Dashboard");
      if (planner) planner.insertAdjacentElement("afterend", panel); else target.prepend(panel);
    }

    const changed = compliance?.changed_sentence_ratio;
    const ceiling = compliance?.changed_sentence_ceiling ?? authority?.max_changed_sentence_ratio;
    const status = compliance?.execution_status;
    const choiceMessage = authorChoiceMessage(policy, latest);
    const surface = texture?.surface_quality;
    const authorial = texture?.authorial_texture;
    const regularity = texture?.machine_pattern_regularity;
    const semantic = texture?.semantic_preservation;
    const expressive = texture?.expressive_preservation;
    const textureScore = authorial?.score ?? texture?.score;
    const textureLabel = authorial?.label ?? texture?.label;
    const expressivePriority = expressive?.priority ?? texture?.preservation_priority;

    panel.innerHTML = `
      <div class="atv5-title"><strong>Authorial/discourse diagnostics & intervention authority</strong><span>quality ≠ texture · diagnosis informs · author choice authorises</span></div>
      <div class="atv5-grid">
        <div><span>Surface quality</span><strong>${surface ? `${esc(label(surface.label))} · ${pct(surface.score)}` : "n/a"}</strong></div>
        <div><span>Authorial texture</span><strong>${esc(label(textureLabel))} · ${pct(textureScore)}</strong></div>
        <div><span>Machine-pattern regularity</span><strong>${regularity ? `${esc(label(regularity.label))} · ${pct(regularity.score)}` : "n/a"}</strong></div>
        <div><span>Cross-paragraph choreography</span><strong>${forensics?.available ? `${esc(label(forensics.label))} · ${pct(forensics.score)}` : "n/a"}</strong></div>
        <div><span>Rhetorical asymmetry</span><strong>${forensics?.available ? pct(forensics.rhetorical_asymmetry_score) : "n/a"}</strong></div>
        <div><span>Semantic preservation</span><strong>${esc(label(semantic?.priority || "n/a"))}</strong></div>
        <div><span>Expressive preservation</span><strong>${esc(label(expressivePriority))}</strong></div>
        <div><span>Author-selected intensity</span><strong>${esc(label(policy?.requested_intensity))}</strong></div>
        <div><span>Execution ceiling</span><strong>${esc(label(authority?.author_choice_ceiling || policy?.author_choice_ceiling || "auto"))}</strong></div>
        <div><span>Rewrite breadth</span><strong>${esc(label(authority?.breadth || texture?.recommended_breadth))}</strong></div>
        <div><span>Depth permission</span><strong>${esc(label(authority?.depth_permission || policy?.depth_permission))}</strong></div>
        <div><span>${diagnosticBreadth ? "Changed-sentence reference" : "Maximum changed sentences"}</span><strong>${pct(ceiling)}</strong></div>
      </div>
      <div class="atv5-construct"><strong>Construct rule:</strong> high surface quality never by itself creates high expressive preservation. Authorial texture is judged from rhetorical/discourse variation and is reduced by machine-pattern regularity. Cross-paragraph choreography is assessed separately so a fluent document can still be flagged for repeated claim/evidence/closure sequencing, predictable evidence placement, tidy closures or low rhetorical asymmetry. Semantic fidelity remains separately protected.</div>
      ${policy ? `<div class="atv5-choice"><strong>Author choice rule:</strong> ${esc(choiceMessage)}</div>` : ""}
      ${policy ? `<div class="atv5-policy"><strong>Mode resolution:</strong> ${esc(label(policy.requested_intensity))} → ${esc(label(policy.effective_intensity))}; ${esc(label(policy.requested_naturalisation))} → ${esc(label(policy.effective_naturalisation))}. ${esc(policy.rationale || "")}</div>` : ""}
      ${compliance ? `<div class="atv5-execution ${status === "passed" || status === "passed-with-variance" ? "good" : "warn"}"><strong>Intervention fidelity:</strong> ${esc(label(status))}. Actual changed sentences: ${pct(changed)}; ${diagnosticBreadth ? `diagnostic reference: ${pct(ceiling)}. High change is permitted when meaning, evidence and argument remain intact.` : `authorised ceiling: ${pct(ceiling)}.`} Changed-sentence breadth is evidence, not a target.</div>` : ""}
      ${forensicReasoning(forensics)}
      ${textureReasoning(texture)}`;
  }

  function queue() { if (timer) clearTimeout(timer); timer = setTimeout(render, 100); }

  window.fetch = async function authorialTextureFetch(input, init) {
    const response = await upstreamFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (/\/api\/(?:analyse|rewrite)(?:\?|$)/.test(url)) {
      response.clone().json().then((data) => { if (response.ok) { latest = data; queue(); } }).catch(() => {});
    }
    return response;
  };

  const style = document.createElement("style");
  style.textContent = `
    .atv5-panel{margin:0 0 18px;padding:16px;border:1px solid #3e536d;border-radius:10px;background:rgba(21,33,48,.76);line-height:1.45}
    .atv5-title{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}.atv5-title span{font-size:.8em;opacity:.65}
    .atv5-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.atv5-grid>div{padding:8px 10px;background:rgba(4,10,18,.4);border-radius:7px}.atv5-grid span{display:block;font-size:.76em;opacity:.68}
    .atv5-construct,.atv5-choice,.atv5-policy,.atv5-execution{margin-top:10px;padding:8px 10px;border-left:3px solid #557296;background:rgba(4,10,18,.28)}.atv5-construct{border-left-color:#8db4e2}.atv5-choice{border-left-color:#62e0b0}.atv5-execution.good{border-left-color:#2b845f}.atv5-execution.warn{border-left-color:#b56b4a}
    .atv5-panel details{margin-top:10px}.atv5-panel summary{cursor:pointer;color:#a9bedf}.atv5-components{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.atv5-components span,.atv5-signal{padding:4px 7px;border:1px solid #465b74;border-radius:5px;font-size:.8em}.atv5-subhead{margin-top:10px;font-weight:700}.atv5-signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.atv5-muted{opacity:.65}.atv5-panel p{font-size:.82em;opacity:.78}
    .atv5-forensic-list{display:grid;gap:7px;margin-top:9px}.atv5-forensic-signal{padding:8px 10px;border:1px solid #465b74;border-radius:7px;background:rgba(4,10,18,.22)}.atv5-forensic-signal p{margin:4px 0 0}`;
  document.head.appendChild(style);
})();
