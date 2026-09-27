(() => {
  "use strict";

  const downstreamFetch = window.fetch.bind(window);
  const HANDOFF_KEY = "academicVoice.longdocEvidenceNeeds.v1";
  const OPTIONS_KEY = "academicVoice.longdocOptions.v2";
  const BENCHMARK_KEY = "academicVoice.longdocBenchmarks.v2";
  let latestJob = null;
  let renderTimer = null;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function installControls() {
    const tab = $("tab-longdoc");
    const start = $("startJobBtn");
    if (!tab || !start || $("longdocEvidenceControls")) return;
    const block = document.createElement("section");
    block.id = "longdocEvidenceControls";
    block.className = "longdoc-vnext-controls";
    block.innerHTML = `
      <div class="longdoc-vnext-head"><strong>Long Document vNext permissions</strong><span>Researcher controlled</span></div>
      <label class="longdoc-check"><input id="longdocIncludeEvidence" type="checkbox" /> <span><strong>Include external evidence</strong><small>Off means Davis may develop reasoning already present, but must not add externally sourced factual material. On enables an evidence handoff after the reworked candidate is produced.</small></span></label>
      <label>Evidence depth
        <select id="longdocEvidenceDepth" disabled>
          <option value="minimal">Minimal — fill only obvious gaps</option>
          <option value="targeted" selected>Targeted — strengthen diagnosed argument needs</option>
          <option value="extensive">Extensive — broader evidence-led development</option>
        </select>
      </label>
      <p class="muted">Evidence enhancement is a separate researcher-approved pass on the reworked candidate. It is not permission to invent citations or replace the manuscript with a new generic draft.</p>`;
    start.closest(".action-row")?.before(block);
    const toggle = $("longdocIncludeEvidence");
    const depth = $("longdocEvidenceDepth");
    toggle?.addEventListener("change", () => { if (depth) depth.disabled = !toggle.checked; });
  }

  function selectedOptions() {
    return {
      includeEvidence: Boolean($("longdocIncludeEvidence")?.checked),
      evidenceDepth: $("longdocEvidenceDepth")?.value || "targeted",
      rewriteIntensity: $("rewriteIntensity")?.value || "auto",
      naturalisation: $("naturalisation")?.value || "faithful",
    };
  }

  window.fetch = async function longDocumentVNextFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url || "";
    let nextInit = init;
    if (/\/api\/jobs(?:\?|$)/.test(url) && String(init?.method || "GET").toUpperCase() === "POST" && init?.body) {
      try {
        const body = JSON.parse(init.body);
        const opts = selectedOptions();
        nextInit = { ...init, body: JSON.stringify({ ...body, includeEvidence: opts.includeEvidence, evidenceDepth: opts.evidenceDepth }) };
      } catch {}
    }

    const response = await downstreamFetch(input, nextInit);
    if (/\/api\/jobs(?:\/|\?|$)/.test(url) && response.ok) {
      response.clone().json().then((job) => {
        if (!job?.id || !job?.progress) return;
        latestJob = job;
        const options = readJson(OPTIONS_KEY, {});
        if (!options[job.id]) options[job.id] = selectedOptions();
        writeJson(OPTIONS_KEY, options);
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(render, 100);
      }).catch(() => {});
    }
    return response;
  };

  function normalise(text) {
    return String(text || "").normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function splitSentences(text) {
    return (String(text || "").match(/[^.!?\n]+(?:[.!?]+|$)/g) || []).map((x) => normalise(x)).filter((x) => x.length >= 12);
  }

  function paragraphs(text) {
    return String(text || "").split(/\n\s*\n+/).map(normalise).filter((x) => x.length >= 30);
  }

  function retention(source, candidate) {
    const sourceSentences = new Set(splitSentences(source));
    const candidateSentences = splitSentences(candidate);
    const exactSentenceCount = candidateSentences.filter((sentence) => sourceSentences.has(sentence)).length;
    const sourceParagraphs = new Set(paragraphs(source));
    const candidateParagraphs = paragraphs(candidate);
    const exactParagraphCount = candidateParagraphs.filter((paragraph) => sourceParagraphs.has(paragraph)).length;
    return {
      candidate_sentence_count: candidateSentences.length,
      exact_sentence_count: exactSentenceCount,
      exact_sentence_retention_ratio: candidateSentences.length ? exactSentenceCount / candidateSentences.length : 0,
      candidate_paragraph_count: candidateParagraphs.length,
      exact_paragraph_count: exactParagraphCount,
      exact_paragraph_retention_ratio: candidateParagraphs.length ? exactParagraphCount / candidateParagraphs.length : 0,
    };
  }

  function preservationPassed(p) {
    if (!p) return false;
    return Boolean(
      p.numbers_ok &&
      p.ranges_ok !== false &&
      p.citations_ok &&
      p.technical_terms_ok &&
      p.quotes_ok &&
      p.study_stage_ok !== false &&
      p.document_structure_ok !== false &&
      p.list_counts_ok !== false &&
      p.rhetorical_semantic_ok !== false &&
      !p.new_factual_claims_detected
    );
  }

  function vNextAudit(job) {
    const source = $("longdocSource")?.value || "";
    const candidate = job?.reassembledText || "";
    const coverage = retention(source, candidate);
    const structure = job?.structureAudit || { artifact_count: 0, missing_artifacts: [], possible_substantive_passage_losses: [], passed: false, note: "Server structure audit unavailable for this older job." };
    const options = readJson(OPTIONS_KEY, {})[job.id] || selectedOptions();
    const explicitDeep = options.rewriteIntensity === "deep" && ["aggressive", "authorial"].includes(options.naturalisation);
    const underTransformed = explicitDeep && (
      coverage.exact_sentence_retention_ratio > 0.62 ||
      coverage.exact_paragraph_retention_ratio > 0.55
    );
    const internalRegularityPassed = job?.wholeDocumentAudit?.passed !== false;
    const preservationOk = job?.documentPreservationRelease
      ? job.documentPreservationRelease.cleared === true
      : preservationPassed(job?.documentPreservation);
    const complete = job?.candidateStatus !== "incomplete" && Number(job?.progress?.failedCount || 0) === 0;
    const passed = complete && internalRegularityPassed && preservationOk && structure.passed && !underTransformed;
    return {
      version: "longdoc-vnext-browser-audit-v3",
      passed,
      complete,
      explicit_deep_authorial_request: explicitDeep,
      under_transformed_for_selected_mode: underTransformed,
      transformation_coverage: coverage,
      structural_artifacts: structure,
      preservation_passed: preservationOk,
      internal_regularity_passed: internalRegularityPassed,
      note: "Transformation coverage is a mode-consistency diagnostic, not a target to change every sentence. Structural and preservation failures are hard review conditions.",
    };
  }

  function pct(value) { return `${(Number(value || 0) * 100).toFixed(1)}%`; }

  function benchmarkRows(jobId) {
    const rows = readJson(BENCHMARK_KEY, []).filter((row) => row.jobId === jobId).slice(-6).reverse();
    if (!rows.length) return '<p class="muted">No external detector observation attached to this candidate yet.</p>';
    return rows.map((row) => `<div class="longdoc-benchmark-row"><strong>${esc(row.detector)}</strong><span>${esc(row.classification)}</span><span>AI ${row.aiScore === "" ? "n/a" : esc(row.aiScore) + "%"}</span><span>Human ${row.humanScore === "" ? "n/a" : esc(row.humanScore) + "%"}</span><small>${esc(new Date(row.createdAt).toLocaleString())}</small></div>`).join("");
  }

  function saveDetectorObservation(job) {
    const detector = $("longdocExternalDetector")?.value || "Other";
    const classification = $("longdocExternalClass")?.value || "uncertain";
    const aiScore = $("longdocExternalAi")?.value ?? "";
    const humanScore = $("longdocExternalHuman")?.value ?? "";
    const notes = $("longdocExternalNotes")?.value || "";
    const rows = readJson(BENCHMARK_KEY, []);
    rows.push({
      id: `det-${Date.now()}`,
      jobId: job.id,
      createdAt: new Date().toISOString(),
      detector,
      classification,
      aiScore,
      humanScore,
      notes: notes.slice(0, 1200),
      documentRisk: job?.wholeDocumentAudit?.revised_risk ?? null,
      riskDelta: job?.wholeDocumentAudit?.risk_delta ?? null,
    });
    writeJson(BENCHMARK_KEY, rows.slice(-100));
    render();
  }

  function handoffToStudio(job, audit) {
    const options = readJson(OPTIONS_KEY, {})[job.id] || selectedOptions();
    if (!options.includeEvidence) return;
    const needs = job?.wholeDocumentBlueprint?.evidence_needs || [];
    writeJson(HANDOFF_KEY, {
      createdAt: new Date().toISOString(),
      documentGoal: job?.wholeDocumentBlueprint?.document_goal || "",
      jobId: job.id,
      needs,
      includeEvidence: true,
      evidenceDepth: options.evidenceDepth || "targeted",
      sourceText: $("longdocSource")?.value || "",
      candidateText: job?.reassembledText || "",
      wholeDocumentAudit: job?.wholeDocumentAudit || null,
      vNextAudit: audit,
      externalDetectorResults: readJson(BENCHMARK_KEY, []).filter((row) => row.jobId === job.id),
    });
    location.href = "/studio?handoff=longdoc-evidence";
  }

  function render() {
    installControls();
    const job = latestJob;
    if (!job || !job.reassembledText || !["completed", "completed_with_errors"].includes(job.status)) return;
    const output = $("longdocOutput");
    if (!output) return;
    let panel = $("longdocVNextPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "longdocVNextPanel";
      output.prepend(panel);
    }

    const audit = vNextAudit(job);
    const options = readJson(OPTIONS_KEY, {})[job.id] || selectedOptions();
    const coverage = audit.transformation_coverage;
    const missing = audit.structural_artifacts.missing_artifacts;
    const possibleLosses = audit.structural_artifacts.possible_substantive_passage_losses || [];
    const evidenceNeeds = job?.wholeDocumentBlueprint?.evidence_needs || [];
    panel.className = `longdoc-vnext-panel ${audit.passed ? "passed" : "review"}`;
    panel.innerHTML = `
      <div class="longdoc-vnext-head"><strong>vNext acceptance and evidence gate</strong><span>${audit.passed ? "PASSED" : "REVIEW REQUIRED"}</span></div>
      ${!audit.complete ? `<p class="longdoc-incomplete"><strong>INCOMPLETE CANDIDATE:</strong> ${Number(job?.progress?.failedCount || 0)} chunk(s) failed. Original text is shown with explicit markers, but this document cannot be accepted or sent to evidence enhancement until those chunks are successfully retried.</p>` : ""}
      <div class="longdoc-vnext-grid">
        <div><span>Exact sentence retention</span><strong>${pct(coverage.exact_sentence_retention_ratio)}</strong></div>
        <div><span>Wholly unchanged paragraphs</span><strong>${pct(coverage.exact_paragraph_retention_ratio)}</strong></div>
        <div><span>Structural artefacts</span><strong>${audit.structural_artifacts.passed ? "preserved" : `${missing.length} missing`}</strong></div>
        <div><span>Preservation gate</span><strong>${audit.preservation_passed ? "pass" : "review"}</strong></div>
        <div><span>Internal regularity gate</span><strong>${audit.internal_regularity_passed ? "pass" : "review"}</strong></div>
        <div><span>Selected-mode execution</span><strong>${audit.under_transformed_for_selected_mode ? "under-transformed" : "consistent"}</strong></div>
      </div>
      ${missing.length ? `<details open><summary>Missing structural artefacts (${missing.length})</summary><ul>${missing.slice(0, 20).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}
      ${possibleLosses.length ? `<details><summary>Possible substantive passage losses (${possibleLosses.length})</summary><p class="muted">These are conservative review signals, not automatic failures. A deep rewrite may legitimately use different vocabulary.</p><ul>${possibleLosses.slice(0, 20).map((x) => `<li>${esc(x.excerpt)} <small>(token recall ${pct(x.best_token_recall)})</small></li>`).join("")}</ul></details>` : ""}
      <p class="muted">${esc(audit.note)}</p>
      <section class="longdoc-evidence-next">
        <h4>Evidence improvement</h4>
        <p>${options.includeEvidence ? `External evidence is authorised (${esc(options.evidenceDepth)}). Davis identified ${evidenceNeeds.length} evidence need(s). The Research Studio will work on this <strong>reworked candidate</strong>, not restart from the original manuscript.` : "External evidence is OFF for this job. No new external factual material should be added."}</p>
        ${options.includeEvidence && audit.complete ? `<button id="longdocImproveWithEvidence" type="button" class="primary">Improve this reworked version with approved evidence</button>` : ""}
      </section>
      <details class="longdoc-external-result"><summary><strong>Attach external detector result to this candidate version</strong></summary>
        <p class="muted">Stored as evaluation evidence for this exact version. It is not proof of authorship and is not used as an automatic generation target.</p>
        <div class="longdoc-detector-grid">
          <label>Detector<select id="longdocExternalDetector"><option>GPTZero</option><option>Turnitin</option><option>Stealthwriter</option><option>Copyleaks</option><option>Originality.ai</option><option>Other</option></select></label>
          <label>Classification<select id="longdocExternalClass"><option value="ai">AI</option><option value="mixed">Mixed</option><option value="human">Human</option><option value="ai_paraphrased">AI paraphrased/rewritten</option><option value="uncertain">Uncertain</option></select></label>
          <label>AI %<input id="longdocExternalAi" type="number" min="0" max="100" step="0.1" /></label>
          <label>Human %<input id="longdocExternalHuman" type="number" min="0" max="100" step="0.1" /></label>
          <label class="longdoc-detector-notes">Notes<input id="longdocExternalNotes" type="text" maxlength="1200" placeholder="Page/section pattern, mixed result, screenshots reviewed, etc." /></label>
        </div>
        <button id="saveLongdocExternalResult" type="button">Save result to this version</button>
        <div class="longdoc-benchmark-list">${benchmarkRows(job.id)}</div>
      </details>`;

    $("longdocImproveWithEvidence")?.addEventListener("click", () => handoffToStudio(job, audit));
    $("saveLongdocExternalResult")?.addEventListener("click", () => saveDetectorObservation(job));
  }

  const style = document.createElement("style");
  style.textContent = `
    .longdoc-vnext-controls,.longdoc-vnext-panel{margin:.85rem 0;padding:1rem;border:1px solid #466078;border-radius:10px;background:rgba(18,29,42,.52)}.longdoc-incomplete{padding:.75rem;border-left:4px solid #d2675c;background:rgba(126,35,35,.22)}
    .longdoc-vnext-panel.passed{border-color:#2f7b63}.longdoc-vnext-panel.review{border-color:#a56c39}.longdoc-vnext-head{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}.longdoc-vnext-head span{opacity:.72}.longdoc-check{display:flex!important;align-items:flex-start!important;gap:.6rem;margin:.7rem 0}.longdoc-check input{width:auto!important;margin-top:.2rem}.longdoc-check span{display:grid;gap:.2rem}.longdoc-check small{opacity:.7}.longdoc-vnext-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:.55rem;margin:.8rem 0}.longdoc-vnext-grid>div{padding:.55rem;background:rgba(5,12,20,.35);border-radius:7px}.longdoc-vnext-grid span{display:block;opacity:.7;font-size:.82em}.longdoc-vnext-grid strong{display:block;margin-top:.2rem}.longdoc-evidence-next{padding:.75rem 0}.longdoc-detector-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.55rem;margin:.7rem 0}.longdoc-detector-notes{grid-column:1/-1}.longdoc-benchmark-row{display:grid;grid-template-columns:1.1fr 1fr .7fr .7fr 1.2fr;gap:.4rem;padding:.45rem 0;border-bottom:1px solid #33495e;font-size:.9em}@media(max-width:760px){.longdoc-benchmark-row{grid-template-columns:1fr 1fr}.longdoc-benchmark-row small{grid-column:1/-1}}
  `;
  document.head.appendChild(style);

  function init() {
    installControls();
    setTimeout(installControls, 700);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
