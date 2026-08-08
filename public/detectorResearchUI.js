(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "academicVoice.detectorObservations.v1";
  const nativeFetch = window.fetch.bind(window);
  let observations = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    } catch {
      observations = [];
    }
  }

  function saveObservations() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(observations.slice(-20))); } catch {}
  }

  function parseFlaggedSentences(value) {
    return [...new Set(String(value || "").split(/[\s,;]+/).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0).map((n) => n - 1))].slice(0, 1000);
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
        saveObservations();
        renderObservationList();
      });
    });
  }

  function addManualObservation() {
    const detector = $("manualDetector")?.value || "Other";
    const version = $("manualDetectorVersion")?.value.trim() || null;
    const classification = $("manualDetectorClass")?.value || null;
    const aiScore = numberOrNull($("manualAiScore")?.value);
    const humanScore = numberOrNull($("manualHumanScore")?.value);
    const paraphrasedScore = numberOrNull($("manualParaphraseScore")?.value);
    const flaggedSentenceIndices = parseFlaggedSentences($("manualFlaggedSentences")?.value);
    const notes = $("manualDetectorNotes")?.value.trim() || null;
    observations.push({ detector, version, classification, aiScore, humanScore, paraphrasedScore, flaggedSentenceIndices, notes });
    observations = observations.slice(-20);
    saveObservations();
    renderObservationList();
    ["manualDetectorVersion", "manualAiScore", "manualHumanScore", "manualParaphraseScore", "manualFlaggedSentences", "manualDetectorNotes"].forEach((id) => {
      if ($(id)) $(id).value = "";
    });
    runResearch();
  }

  function clearObservations() {
    observations = [];
    saveObservations();
    renderObservationList();
    if ($("detectorResearchResults")) $("detectorResearchResults").innerHTML = "";
  }

  function pct(value) {
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "n/a";
  }

  function metric(value, digits = 2) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "n/a";
  }

  function profileRows(source, candidate, opening) {
    const rows = [
      ["Mean sentence words", "mean_sentence_words", 1],
      ["Sentence-length SD", "sentence_length_sd", 1],
      ["Sentence-length CV", "sentence_length_cv", 2],
      ["Lag-1 sentence-length correlation", "sentence_length_lag1_correlation", 2],
      ["Short-sentence share", "short_sentence_share", "pct"],
      ["Long-sentence share", "long_sentence_share", "pct"],
      ["Repeated sentence-opening share", "repeated_sentence_opening_share", "pct"],
      ["Transition density /100 words", "transition_density_per_100_words", 2],
      ["Abstract-noun density /100 words", "abstract_noun_density_per_100_words", 2],
      ["Clause-marker density /100 words", "clause_marker_density_per_100_words", 2],
      ["Citation density /100 words", "citation_density_per_100_words", 2],
      ["Lexical type-token ratio", "lexical_type_token_ratio", 2],
    ];
    const format = (obj, key, kind) => kind === "pct" ? pct(obj?.[key]) : metric(obj?.[key], kind);
    return rows.map(([label, key, kind]) => `<tr><td>${label}</td><td>${format(source, key, kind)}</td><td>${format(candidate, key, kind)}</td><td>${format(opening, key, kind)}</td></tr>`).join("");
  }

  function renderResearch(report) {
    const target = $("detectorResearchResults");
    if (!target || !report) return;
    const source = report.source_profiles?.whole_document || {};
    const candidate = report.candidate_profiles?.whole_document || {};
    const opening = report.candidate_profiles?.opening_two_paragraphs || {};
    const consensus = report.detector_consensus || {};
    const obs = consensus.observations || [];
    target.innerHTML = `
      <section class="detector-research-report">
        <h4>Detector Research Lab</h4>
        <p class="muted">Observational comparison only. Raw manuscript text is not persisted by this research endpoint. Detector disagreement remains visible rather than being forced into one authorship verdict.</p>
        <div class="research-summary-grid">
          <div><span>Detector observations</span><strong>${escapeHtml(consensus.detector_count ?? 0)}</strong></div>
          <div><span>Mean recorded AI score</span><strong>${Number.isFinite(consensus.mean_ai_score) ? `${escapeHtml(consensus.mean_ai_score)}%` : "n/a"}</strong></div>
          <div><span>AI/paraphrase votes</span><strong>${escapeHtml(consensus.ai_or_paraphrase_votes ?? 0)}</strong></div>
          <div><span>Human votes</span><strong>${escapeHtml(consensus.human_votes ?? 0)}</strong></div>
          <div><span>Cross-detector disagreement</span><strong>${consensus.disagreement ? "YES" : "no"}</strong></div>
        </div>
        ${obs.length ? `<div class="research-observation-strip">${obs.map((o) => `<span>${escapeHtml(o.detector)}${o.version ? ` ${escapeHtml(o.version)}` : ""}: ${escapeHtml(o.classification || "n/a")}${Number.isFinite(o.ai_score) ? ` (${escapeHtml(o.ai_score)}% AI)` : ""}</span>`).join("")}</div>` : ""}
        <h4>Measured linguistic profile</h4>
        <table class="research-table"><thead><tr><th>Metric</th><th>Source</th><th>Revised</th><th>Revised opening 2 paragraphs</th></tr></thead><tbody>${profileRows(source, candidate, opening)}</tbody></table>
        <h4>Research hypotheses from this run</h4>
        <ul>${(report.research_hypotheses || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        <details><summary>Full measured profile JSON</summary><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></details>
      </section>`;
  }

  async function runResearch() {
    const source = $("sourceText")?.value.trim() || "";
    const candidate = $("revisedText")?.value.trim() || source;
    if (!source && !candidate) {
      if ($("detectorStatus")) $("detectorStatus").textContent = "Paste source or revised text first.";
      return;
    }
    if ($("detectorStatus")) $("detectorStatus").textContent = "Analysing detector-associated writing patterns…";
    try {
      const response = await nativeFetch("/api/detector-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceText: source, candidateText: candidate, observations }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Detector research analysis failed");
      renderResearch(data);
      if ($("detectorStatus")) $("detectorStatus").textContent = "Detector research analysis complete.";
    } catch (err) {
      if ($("detectorStatus")) $("detectorStatus").textContent = `Detector research failed: ${err.message}`;
    }
  }

  // Observe configured detector scans that the existing app already performs.
  // Their normalized scores become labelled evidence for the research view.
  window.fetch = async function detectorResearchFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const response = await nativeFetch(input, init);
    if (/\/api\/detector-scan(?:\?|$)/.test(url) && response.ok) {
      response.clone().json().then((data) => {
        const targetLabel = data.label || "scan";
        for (const item of data.observations || []) {
          const duplicate = observations.some((existing) =>
            existing.detector === item.detector &&
            existing.version === item.version &&
            existing.classification === item.classification &&
            existing.aiScore === item.aiScore &&
            existing.notes === `configured ${targetLabel} scan`
          );
          if (!duplicate) observations.push({ ...item, notes: `configured ${targetLabel} scan` });
        }
        observations = observations.slice(-20);
        saveObservations();
        renderObservationList();
        if (data.research) renderResearch(data.research);
      }).catch(() => {});
    }
    return response;
  };

  loadObservations();
  renderObservationList();
  $("addDetectorObservationBtn")?.addEventListener("click", addManualObservation);
  $("clearDetectorObservationsBtn")?.addEventListener("click", clearObservations);
  $("analyseDetectorResearchBtn")?.addEventListener("click", runResearch);
})();
