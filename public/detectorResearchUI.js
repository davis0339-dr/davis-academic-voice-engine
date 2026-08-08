(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "academicVoice.detectorObservations.v1";
  const nativeFetch = window.fetch.bind(window);
  let observations = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function loadObservations() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(parsed)) observations = parsed.slice(-20);
    } catch { observations = []; }
  }

  function saveObservations() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(observations.slice(-20))); } catch {}
  }

  function parseFlaggedSentences(value) {
    return [...new Set(String(value || "").split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0).map((n) => n - 1))].slice(0, 1000);
  }

  function renderObservationList() {
    const target = $("manualObservationList");
    if (!target) return;
    if (!observations.length) {
      target.innerHTML = '<p class="muted">No detector observations recorded in this browser yet.</p>';
      return;
    }
    target.innerHTML = observations.map((o, index) => `
      <div class="detector-observation">
        <strong>${escapeHtml(o.detector)}</strong>${o.version ? ` · ${escapeHtml(o.version)}` : ""}
        · ${escapeHtml(o.classification || "unclassified")}
        ${Number.isFinite(o.aiScore) ? ` · AI ${escapeHtml(o.aiScore)}%` : ""}
        ${Number.isFinite(o.humanScore) ? ` · human ${escapeHtml(o.humanScore)}%` : ""}
        ${Number.isFinite(o.paraphrasedScore) ? ` · paraphrased ${escapeHtml(o.paraphrasedScore)}%` : ""}
        <button type="button" data-remove-observation="${index}">remove</button>
        ${o.notes ? `<div class="muted">${escapeHtml(o.notes)}</div>` : ""}
      </div>`).join("");
    target.querySelectorAll("[data-remove-observation]").forEach((button) => {
      button.addEventListener("click", () => {
        observations.splice(Number(button.dataset.removeObservation), 1);
        saveObservations(); renderObservationList();
      });
    });
  }

  function addManualObservation() {
    observations.push({
      detector: $("manualDetector")?.value || "Other",
      version: $("manualDetectorVersion")?.value.trim() || null,
      classification: $("manualDetectorClass")?.value || null,
      aiScore: numberOrNull($("manualAiScore")?.value),
      humanScore: numberOrNull($("manualHumanScore")?.value),
      paraphrasedScore: numberOrNull($("manualParaphraseScore")?.value),
      flaggedSentenceIndices: parseFlaggedSentences($("manualFlaggedSentences")?.value),
      notes: $("manualDetectorNotes")?.value.trim() || null,
    });
    observations = observations.slice(-20);
    saveObservations(); renderObservationList();
    ["manualDetectorVersion", "manualAiScore", "manualHumanScore", "manualParaphraseScore", "manualFlaggedSentences", "manualDetectorNotes"].forEach((id) => { if ($(id)) $(id).value = ""; });
    runResearch();
  }

  function clearObservations() {
    observations = []; saveObservations(); renderObservationList();
    if ($("detectorResearchResults")) $("detectorResearchResults").innerHTML = "";
  }

  function pct(value) { return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "n/a"; }
  function metric(value, digits = 2) { return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "n/a"; }

  function adequacyAllows(profile, kind) {
    const a = profile?.sample_adequacy || {};
    if (kind === "lexical") return a.lexical_profile !== "insufficient";
    if (kind === "dispersion") return a.sentence_dispersion !== "insufficient";
    if (kind === "cadence") return a.cadence_inference !== "insufficient";
    return true;
  }

  function profileRows(source, candidate, opening) {
    const rows = [
      ["Mean sentence words", "mean_sentence_words", 1, "dispersion"],
      ["Sentence-length SD", "sentence_length_sd", 1, "dispersion"],
      ["Sentence-length CV", "sentence_length_cv", 2, "dispersion"],
      ["Lag-1 sentence-length correlation", "sentence_length_lag1_correlation", 2, "cadence"],
      ["Short-sentence share", "short_sentence_share", "pct", "dispersion"],
      ["Long-sentence share", "long_sentence_share", "pct", "dispersion"],
      ["Repeated sentence-opening share", "repeated_sentence_opening_share", "pct", "cadence"],
      ["Transition density /100 words", "transition_density_per_100_words", 2, "lexical"],
      ["Abstract-noun density /100 words", "abstract_noun_density_per_100_words", 2, "lexical"],
      ["Clause-marker density /100 words", "clause_marker_density_per_100_words", 2, "lexical"],
      ["Citation density /100 words", "citation_density_per_100_words", 2, "lexical"],
      ["Lexical type-token ratio", "lexical_type_token_ratio", 2, "lexical"],
    ];
    const format = (obj, key, kind) => kind === "pct" ? pct(obj?.[key]) : metric(obj?.[key], kind);
    return rows.map(([label, key, formatKind, adequacyKind]) => {
      const openingValue = adequacyAllows(opening, adequacyKind) ? format(opening, key, formatKind) : '<span title="Sample too small for stable interpretation">low sample</span>';
      return `<tr><td>${label}</td><td>${format(source, key, formatKind)}</td><td>${format(candidate, key, formatKind)}</td><td>${openingValue}</td></tr>`;
    }).join("");
  }

  function adequacyBlock(profile, label) {
    const a = profile?.sample_adequacy;
    if (!a) return "";
    const cautions = a.cautions || [];
    return `<div class="research-adequacy"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(a.word_count)} words · ${escapeHtml(a.sentence_count)} sentences · cadence ${escapeHtml(a.cadence_inference || "n/a")}${cautions.length ? `<div class="muted">${cautions.map(escapeHtml).join(" ")}</div>` : ""}</div>`;
  }

  function referenceRows(reference) {
    const labels = {
      mean_sentence_words: "Mean sentence words",
      sentence_length_sd: "Sentence-length SD",
      sentence_length_cv: "Sentence-length CV",
      long_sentence_share: "Long-sentence share",
    };
    return Object.entries(reference?.metrics || {}).map(([key, item]) => {
      const ref = item.reference || {};
      const value = key === "long_sentence_share" ? pct(item.value) : metric(item.value, 2);
      const scale = key === "long_sentence_share" ? "%" : "";
      const q1 = Number.isFinite(Number(ref.q1)) ? `${metric(ref.q1, 2)}${scale}` : "n/a";
      const med = Number.isFinite(Number(ref.median)) ? `${metric(ref.median, 2)}${scale}` : "n/a";
      const q3 = Number.isFinite(Number(ref.q3)) ? `${metric(ref.q3, 2)}${scale}` : "n/a";
      return `<tr><td>${escapeHtml(labels[key] || key)}</td><td>${value}</td><td>${med}</td><td>${q1}–${q3}</td><td>${escapeHtml(String(item.position || "not_interpreted").replace(/_/g, " "))}</td></tr>`;
    }).join("");
  }

  function renderResearch(report) {
    const target = $("detectorResearchResults");
    if (!target || !report) return;
    const source = report.source_profiles?.whole_document || {};
    const candidate = report.candidate_profiles?.whole_document || {};
    const opening = report.candidate_profiles?.opening_two_paragraphs || {};
    const consensus = report.detector_consensus || {};
    const obs = consensus.observations || [];
    const flagged = report.flagged_sentence_analysis || {};
    const reference = report.corpus_reference || {};
    const flaggedSummary = flagged.available ? `
      <div class="research-summary-grid">
        <div><span>Flagged sentence share</span><strong>${pct(flagged.flagged_share)}</strong></div>
        <div><span>Opening 2 prose paragraphs flagged</span><strong>${pct(flagged.opening_two_paragraphs?.flagged_share)}</strong></div>
        <div><span>Remainder flagged</span><strong>${pct(flagged.remainder?.flagged_share)}</strong></div>
      </div>` : `<p class="muted">${escapeHtml(flagged.reason || "No sentence-level highlights supplied.")}</p>`;

    target.innerHTML = `
      <section class="detector-research-report">
        <h4>Detector Research Lab</h4>
        <p class="muted">Observational comparison only. Raw manuscript text is not persisted by this endpoint. Detector disagreement remains visible rather than being forced into one authorship verdict.</p>
        <div class="research-summary-grid">
          <div><span>Detector observations</span><strong>${escapeHtml(consensus.detector_count ?? 0)}</strong></div>
          <div><span>Mean recorded AI score</span><strong>${Number.isFinite(consensus.mean_ai_score) ? `${escapeHtml(consensus.mean_ai_score)}%` : "n/a"}</strong></div>
          <div><span>AI/paraphrase votes</span><strong>${escapeHtml(consensus.ai_or_paraphrase_votes ?? 0)}</strong></div>
          <div><span>Human votes</span><strong>${escapeHtml(consensus.human_votes ?? 0)}</strong></div>
          <div><span>Cross-detector disagreement</span><strong>${consensus.disagreement ? "YES" : "no"}</strong></div>
        </div>
        ${obs.length ? `<div class="research-observation-strip">${obs.map((o) => `<span>${escapeHtml(o.detector)}${o.version ? ` ${escapeHtml(o.version)}` : ""}: ${escapeHtml(o.classification || "n/a")}${Number.isFinite(o.ai_score) ? ` (${escapeHtml(o.ai_score)}% AI)` : ""}</span>`).join("")}</div>` : ""}
        <h4>Sentence-highlight distribution</h4>${flaggedSummary}
        <h4>Measured linguistic profile</h4>
        ${adequacyBlock(candidate, "Whole revised document sample")}
        ${adequacyBlock(opening, "First two substantive prose paragraphs")}
        <p class="muted">Headings, section labels, stand-alone quotations and list items are excluded from the “opening two paragraphs” sample. Low-sample cells are deliberately not interpreted.</p>
        <table class="research-table"><thead><tr><th>Metric</th><th>Source</th><th>Revised</th><th>Revised opening 2 prose paragraphs</th></tr></thead><tbody>${profileRows(source, candidate, opening)}</tbody></table>
        <h4>Corpus-relative cadence reference</h4>
        <p class="muted">${escapeHtml(reference.message || "No reference family available.")} These values are descriptive reference statistics, not quality cut-offs or rewrite targets.</p>
        <table class="research-table"><thead><tr><th>Metric</th><th>Revised</th><th>Corpus median</th><th>Corpus IQR</th><th>Position</th></tr></thead><tbody>${referenceRows(reference)}</tbody></table>
        <h4>Research hypotheses from this run</h4>
        <ul>${(report.research_hypotheses || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        <details><summary>Full measured profile JSON</summary><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></details>
      </section>`;
  }

  function currentStyleFilters() {
    const value = (id) => $(id)?.value || null;
    return {
      document_type: value("documentType"), region: value("region"), degree: value("degree"),
      discipline: value("discipline"), research_mode: value("researchMode"), section: value("section"),
    };
  }

  async function runResearch() {
    const source = $("sourceText")?.value.trim() || "";
    const candidate = $("revisedText")?.value.trim() || source;
    if (!source && !candidate) {
      if ($("detectorStatus")) $("detectorStatus").textContent = "Paste source or revised text first.";
      return;
    }
    if ($("detectorStatus")) $("detectorStatus").textContent = "Analysing measured writing patterns…";
    try {
      const response = await nativeFetch("/api/detector-research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceText: source, candidateText: candidate, observations, styleFilters: currentStyleFilters() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Detector research analysis failed");
      renderResearch(data);
      if ($("detectorStatus")) $("detectorStatus").textContent = "Detector research analysis complete.";
    } catch (err) {
      if ($("detectorStatus")) $("detectorStatus").textContent = `Detector research failed: ${err.message}`;
    }
  }

  window.fetch = async function detectorResearchFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const response = await nativeFetch(input, init);
    if (/\/api\/detector-scan(?:\?|$)/.test(url) && response.ok) {
      response.clone().json().then((data) => {
        const targetLabel = data.label || "scan";
        for (const item of data.observations || []) {
          const duplicate = observations.some((existing) => existing.detector === item.detector && existing.version === item.version && existing.classification === item.classification && existing.aiScore === item.aiScore && existing.notes === `configured ${targetLabel} scan`);
          if (!duplicate) observations.push({ ...item, notes: item.notes ? `${item.notes}; configured ${targetLabel} scan` : `configured ${targetLabel} scan` });
        }
        observations = observations.slice(-20); saveObservations(); renderObservationList();
        if (data.research) renderResearch(data.research);
      }).catch(() => {});
    }
    return response;
  };

  loadObservations(); renderObservationList();
  $("addDetectorObservationBtn")?.addEventListener("click", addManualObservation);
  $("clearDetectorObservationsBtn")?.addEventListener("click", clearObservations);
  $("analyseDetectorResearchBtn")?.addEventListener("click", runResearch);

  if (!document.querySelector('script[data-detector-evidence-ui="true"]')) {
    const script = document.createElement("script");
    script.src = "/detectorEvidenceUI.js"; script.dataset.detectorEvidenceUi = "true"; script.defer = true;
    document.head.appendChild(script);
  }
})();
