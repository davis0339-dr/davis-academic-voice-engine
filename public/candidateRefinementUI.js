(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const words = (text) => typeof window.AcademicManuscriptWordCount === "function"
    ? window.AcademicManuscriptWordCount(text)
    : String(text || "").trim().split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;

  function candidatePanel() {
    let panel = $("candidateRefinementPreflight");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "candidateRefinementPreflight";
    panel.className = "candidate-refinement-preflight";
    const gateway = $("detectorScreenshotGateway");
    if (gateway) gateway.insertAdjacentElement("afterend", panel);
    else $("tab-detectorqa")?.prepend(panel);
    return panel;
  }

  function observationLabel(row) {
    const bits = [row.detector || "External detector"];
    if (row.version) bits.push(row.version);
    if (Number.isFinite(Number(row.aiScore))) bits.push(`AI ${row.aiScore}%`);
    const passageCount = Array.isArray(row.highlightedPassages) ? row.highlightedPassages.length : 0;
    const targetCount = Array.isArray(row.flaggedExcerpts) ? row.flaggedExcerpts.length : 0;
    const patternCount = (row.patternFindings || []).reduce((sum, finding) => {
      if (finding?.reportedCount !== null && finding?.reportedCount !== undefined && Number.isFinite(Number(finding.reportedCount))) return sum + Number(finding.reportedCount);
      return sum + (Array.isArray(finding?.instances) ? finding.instances.length : 0);
    }, 0);
    if (passageCount) bits.push(`${passageCount} colour passage${passageCount === 1 ? "" : "s"}`);
    if (targetCount) bits.push(`${targetCount} local target${targetCount === 1 ? "" : "s"}`);
    if (patternCount) bits.push(`${patternCount} reported pattern instance${patternCount === 1 ? "" : "s"}`);
    return bits.join(" · ");
  }

  function render() {
    const panel = candidatePanel();
    if (!panel) return;
    const revised = $("revisedText")?.value || "";
    const preflight = window.AcademicRewriteLineage?.refinementPreflight?.(revised);
    if (!preflight?.exact_candidate) {
      panel.innerHTML = `
        <h4>Feedback-guided candidate refinement</h4>
        <p class="muted">Complete a revision first. Detector evidence can only refine the exact candidate that was tested.</p>`;
      return;
    }

    const rootWords = words(preflight.root_source);
    const candidateWords = words(preflight.candidate_text);
    const expand = $("lengthPreference")?.value === "expand";
    const minimumWords = expand ? rootWords + 200 : null;
    const versions = (preflight.versions || []).map((version) => `
      <details class="candidate-version-row">
        <summary>Revision V${esc(version.generation)} · ${esc(version.word_count || words(version.text))} words</summary>
        <textarea readonly rows="6">${esc(version.text || "")}</textarea>
      </details>`).join("");

    const readiness = preflight.observation_count === 0
      ? "Test this exact revision externally, then save at least one result against it."
      : preflight.remaining_refinements <= 0
        ? "The two bounded feedback-guided refinements have been used. Compare the retained versions instead of creating an uncontrolled rewrite chain."
        : `${preflight.observation_count} saved detector observation(s) are linked to Revision V${preflight.generation}.`;

    panel.innerHTML = `
      <div class="candidate-refinement-title">
        <h4>Feedback-guided refinement preflight</h4>
        <span>Revision V${esc(preflight.generation)} · ${esc(preflight.remaining_refinements)}/${esc(preflight.maximum_refinements)} refinement passes remaining</span>
      </div>
      <p><strong>${esc(readiness)}</strong></p>
      <div class="candidate-refinement-grid">
        <div><span>Permanent meaning/evidence anchor</span><strong>Original · ${esc(rootWords)} words</strong></div>
        <div><span>Text that will be edited</span><strong>Revision V${esc(preflight.generation)} · ${esc(candidateWords)} words</strong></div>
        <div><span>Linked evidence</span><strong>${esc(preflight.observation_count)} observation(s)</strong></div>
        <div><span>Final length basis</span><strong>${expand ? `Original +200 · minimum ${esc(minimumWords)} words` : "Original-source preference"}</strong></div>
      </div>
      ${preflight.observations.length ? `<div class="candidate-refinement-evidence">${preflight.observations.map((row) => `<span>${esc(observationLabel(row))}</span>`).join("")}</div>` : ""}
      <p class="muted">This action edits the tested revision while auditing facts, citations, numbers, qualifications, study design and final length against the retained original. It starts a paid reconstruction request and may use bounded preservation or residual calls. It does not contact the detector vendor.</p>
      <button id="refineTestedCandidateBtn" class="primary" type="button" ${preflight.ready ? "" : "disabled"}>Refine this tested revision</button>
      <span id="candidateRefinementStatus" class="file-status"></span>
      ${versions ? `<details class="candidate-version-history"><summary>Compare retained revision versions</summary>${versions}</details>` : ""}`;

    $("refineTestedCandidateBtn")?.addEventListener("click", async () => {
      const fresh = window.AcademicRewriteLineage?.refinementPreflight?.($("revisedText")?.value || "");
      const status = $("candidateRefinementStatus");
      if (!fresh?.ready) {
        if (status) status.textContent = "This revision is not ready: save linked detector evidence or review the pass limit.";
        return;
      }
      if (window.AcademicVoiceEditor?.isBusy?.()) {
        if (status) status.textContent = "Another revision request is already running.";
        return;
      }
      if (status) status.textContent = `Starting Revision V${fresh.generation + 1} from the exact tested candidate…`;
      await window.AcademicVoiceEditor?.runCandidateRefinement?.(fresh.candidate_text);
    });
  }

  const style = document.createElement("style");
  style.textContent = `
    .candidate-refinement-preflight{margin:1rem 0;padding:1rem;border:1px solid #4f8f78;border-radius:10px;background:rgba(20,54,45,.28)}
    .candidate-refinement-title{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap}.candidate-refinement-title h4{margin:.15rem 0}.candidate-refinement-title span{font-size:.82rem;opacity:.78}
    .candidate-refinement-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.6rem;margin:.8rem 0}.candidate-refinement-grid>div{padding:.65rem;background:rgba(4,10,18,.38);border-radius:7px}.candidate-refinement-grid span{display:block;font-size:.76rem;opacity:.72}.candidate-refinement-grid strong{display:block;margin-top:.25rem}
    .candidate-refinement-evidence{display:flex;gap:.45rem;flex-wrap:wrap;margin:.7rem 0}.candidate-refinement-evidence span{padding:.3rem .5rem;border:1px solid #4f8f78;border-radius:999px;font-size:.82rem}
    .candidate-version-history{margin-top:.8rem}.candidate-version-row{margin:.5rem 0}.candidate-version-row textarea{width:100%;margin-top:.45rem}
  `;
  document.head.appendChild(style);

  ["academicVoice:detector-observation-saved", "academicVoice:rewrite-lineage-updated"].forEach((name) => window.addEventListener(name, render));
  $("lengthPreference")?.addEventListener("change", render);
  document.querySelector('.tab-header[data-tab="detectorqa"]')?.addEventListener("click", () => setTimeout(render, 0));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
  else render();
})();
