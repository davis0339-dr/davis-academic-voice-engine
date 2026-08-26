(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const words = (text) => typeof window.AcademicManuscriptWordCount === "function"
    ? window.AcademicManuscriptWordCount(text)
    : String(text || "").trim().split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  const ANCHOR_STORAGE_KEY = "academicVoice.authorialAnchor.v1";
  const ANCHOR_MIN_WORDS = 120;
  const ANCHOR_MAX_WORDS = 700;

  function loadAuthorialAnchor() {
    try { return localStorage.getItem(ANCHOR_STORAGE_KEY) || ""; } catch { return ""; }
  }

  function saveAuthorialAnchor(value) {
    try { localStorage.setItem(ANCHOR_STORAGE_KEY, String(value || "")); } catch {}
  }

  function anchorState() {
    const text = $("authorialAnchorText")?.value || loadAuthorialAnchor();
    const count = words(text);
    return { text, count, valid: count >= ANCHOR_MIN_WORDS && count <= ANCHOR_MAX_WORDS };
  }

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

  function restoreRetainedCandidate() {
    const source = $("sourceText");
    const revised = $("revisedText");
    const retained = window.AcademicRewriteLineage?.recoverEditorState?.();
    if (!source || !revised || !retained?.root_source || !retained?.last_revision) return false;
    const normalise = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const currentSource = normalise(source.value);
    // Never replace text the researcher has changed. Recovery is permitted only
    // when Source is empty or still equals the retained root, and Revised is
    // empty after a page/deployment refresh.
    if (normalise(revised.value) || (currentSource && currentSource !== normalise(retained.root_source))) return false;
    if (!currentSource) source.value = retained.root_source;
    revised.value = retained.last_revision;
    source.dispatchEvent(new Event("input", { bubbles: true }));
    revised.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
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

    const anchor = anchorState();
    const readiness = preflight.observation_count === 0
      ? "Test this exact revision externally, then save at least one result against it."
      : preflight.remaining_refinements <= 0
        ? "The two bounded feedback-guided refinements have been used. Compare the retained versions instead of creating an uncontrolled rewrite chain."
        : !anchor.valid
          ? `Detector evidence is linked to Revision V${preflight.generation}. Add ${ANCHOR_MIN_WORDS}-${ANCHOR_MAX_WORDS} words of your own writing below before spending another refinement request.`
        : `${preflight.observation_count} saved detector observation(s) are linked to Revision V${preflight.generation}. The next Analyse & Revise action will apply them automatically to this exact revision.`;

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
      <label class="candidate-authorial-anchor"><strong>Researcher voice calibration — Your own writing sample</strong>
        <span>This is not a request for more source material. Paste ${ANCHOR_MIN_WORDS}-${ANCHOR_MAX_WORDS} continuous words that you genuinely wrote without AI generation, paraphrasing or rewriting. The best sample comes from a similar academic task and level; it does not need to discuss the same topic. Its facts and phrases must never be inserted into the manuscript.</span>
        <details class="candidate-authorial-guide" open>
          <summary>What should I paste, and how should it relate to this manuscript?</summary>
          <div class="candidate-authorial-guide-grid">
            <div><strong>Best evidence</strong><span>Two to five connected paragraphs from earlier academic work in which you explain, compare, qualify or develop an argument in your normal way.</span></div>
            <div><strong>Topic relationship</strong><span>A different topic is often safer. Similar academic purpose and level matter more than matching the subject because no facts or phrases may transfer.</span></div>
            <div><strong>Same-project material</strong><span>Acceptable only when you wrote it independently and it is not copied from the Source, Revised output, an AI draft or a detector-targeted rewrite.</span></div>
            <div><strong>Do not use</strong><span>References, quotations, tables, questionnaires, bullet lists, institutional templates, abstracts dominated by fixed wording, or prose another model has polished.</span></div>
          </div>
          <p>The engine uses the sample to compare reasoning order, explanation depth, clause loading, sentence boundaries, qualification habits and closure style. It is forbidden from importing the sample's claims, evidence, citations, examples or topic language.</p>
        </details>
        <textarea id="authorialAnchorText" rows="9" maxlength="12000" placeholder="Paste 2-5 connected paragraphs that show how you normally explain or argue in academic prose. A different topic is fine; genuine authorship and a comparable academic purpose matter most.">${esc(anchor.text)}</textarea>
        <small id="authorialAnchorStatus">${esc(anchor.count)} words · ${anchor.valid ? "ready" : `needs ${ANCHOR_MIN_WORDS}-${ANCHOR_MAX_WORDS} words`}</small>
      </label>
      <button id="refineTestedCandidateBtn" class="primary" type="button" ${(preflight.ready && anchor.valid) ? "" : "disabled"}>Refine this tested revision</button>
      <span id="candidateRefinementStatus" class="file-status"></span>
      ${versions ? `<details class="candidate-version-history"><summary>Compare retained revision versions</summary>${versions}</details>` : ""}`;

    $("authorialAnchorText")?.addEventListener("input", (event) => {
      saveAuthorialAnchor(event.target.value);
      const current = anchorState();
      const status = $("authorialAnchorStatus");
      if (status) status.textContent = `${current.count} words · ${current.valid ? "ready" : `needs ${ANCHOR_MIN_WORDS}-${ANCHOR_MAX_WORDS} words`}`;
      const button = $("refineTestedCandidateBtn");
      if (button) button.disabled = !(preflight.ready && current.valid);
    });

    $("refineTestedCandidateBtn")?.addEventListener("click", async () => {
      const fresh = window.AcademicRewriteLineage?.refinementPreflight?.($("revisedText")?.value || "");
      const status = $("candidateRefinementStatus");
      const freshAnchor = anchorState();
      if (!fresh?.ready || !freshAnchor.valid) {
        if (status) status.textContent = !fresh?.ready
          ? "This revision is not ready: save linked detector evidence or review the pass limit."
          : `Add ${ANCHOR_MIN_WORDS}-${ANCHOR_MAX_WORDS} words of your own writing before spending another refinement request.`;
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
    .candidate-authorial-anchor{display:grid;gap:.52rem;margin:.9rem 0;padding:.9rem;border:1px solid #4f8f78;border-radius:8px}.candidate-authorial-anchor span,.candidate-authorial-anchor small{color:var(--muted)}.candidate-authorial-anchor textarea{width:100%;box-sizing:border-box}.candidate-authorial-guide{padding:.65rem;border:1px solid rgba(79,143,120,.55);border-radius:7px;background:rgba(4,10,18,.28)}.candidate-authorial-guide summary{cursor:pointer;font-weight:700}.candidate-authorial-guide-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.55rem;margin:.65rem 0}.candidate-authorial-guide-grid>div{padding:.55rem;border-left:3px solid #4f8f78;background:rgba(20,54,45,.22)}.candidate-authorial-guide-grid strong,.candidate-authorial-guide-grid span{display:block}.candidate-authorial-guide-grid span{margin-top:.22rem;font-size:.84rem}.candidate-authorial-guide p{margin:.55rem 0 0;color:var(--muted);font-size:.86rem}
  `;
  document.head.appendChild(style);

  ["academicVoice:detector-observation-saved", "academicVoice:rewrite-lineage-updated"].forEach((name) => window.addEventListener(name, render));
  $("lengthPreference")?.addEventListener("change", render);
  document.querySelector('.tab-header[data-tab="detectorqa"]')?.addEventListener("click", () => setTimeout(render, 0));
  const initialise = () => {
    restoreRetainedCandidate();
    render();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise, { once: true });
  else initialise();
  window.AcademicAuthorialAnchor = {
    get: () => anchorState().text,
    wordCount: () => anchorState().count,
    valid: () => anchorState().valid,
  };
})();
