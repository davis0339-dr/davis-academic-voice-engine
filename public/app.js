const $ = (id) => document.getElementById(id);

const sourceText = $("sourceText");
const revisedText = $("revisedText");
const llmStatusEl = $("llmStatus");
const statusMessage = $("statusMessage");
const analyseOnlyBtn = $("analyseOnlyBtn");
const analyseReviseBtn = $("analyseReviseBtn");
const profileEvidence = $("profileEvidence");

const dimensionSelects = {
  documentType: $("documentType"),
  region: $("region"),
  degree: $("degree"),
  discipline: $("discipline"),
  researchMode: $("researchMode"),
  section: $("section"),
};

const filterKeyByField = {
  documentType: "document_type",
  region: "region",
  degree: "degree",
  discipline: "discipline",
  researchMode: "research_mode",
  section: "section",
};

function wordCount(text) {
  return (text.match(/[A-Za-z0-9']+/g) || []).length;
}

function updateWordCounts() {
  $("sourceWordCount").textContent = `${wordCount(sourceText.value)} words`;
  $("revisedWordCount").textContent = `${wordCount(revisedText.value)} words`;
}
sourceText.addEventListener("input", updateWordCounts);

function setTab(tabName) {
  document.querySelectorAll(".tab-header").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((el) => {
    el.classList.toggle("active", el.id === `tab-${tabName}`);
  });
}
document.querySelectorAll(".tab-header").forEach((el) => {
  el.addEventListener("click", () => setTab(el.dataset.tab));
});

async function loadBuildBadge() {
  const el = $("buildBadge");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    el.textContent = "build: " + (data.build?.commitShort || "unknown");
    if (data.build?.githubUrl) el.href = data.build.githubUrl;
  } catch {
    el.textContent = "build: unavailable";
  }
}

async function loadLlmStatus() {
  llmStatusEl.textContent = "checking service status…";
  llmStatusEl.className = "llm-status";
  try {
    const res = await fetch("/api/health/llm");
    const data = await res.json();
    const labels = {
      READY: "LLM: ready",
      NOT_CONFIGURED: "LLM: not configured (server needs ANTHROPIC_API_KEY)",
      AUTH_FAILED: "LLM: auth failed",
      RATE_LIMITED: "LLM: rate limited",
      NETWORK_TIMEOUT: "LLM: network timeout",
      PROVIDER_ERROR: "LLM: provider error",
    };
    llmStatusEl.textContent = labels[data.state] || `LLM: ${data.state}`;
    llmStatusEl.className =
      "llm-status " + (data.state === "READY" ? "ready" : data.state === "NOT_CONFIGURED" ? "not-configured" : "error");
  } catch {
    llmStatusEl.textContent = "LLM: status check failed";
    llmStatusEl.className = "llm-status error";
  }
}

function fillSelect(select, options, includeAuto = true) {
  select.innerHTML = "";
  if (includeAuto) {
    const optAuto = document.createElement("option");
    optAuto.value = "";
    optAuto.textContent = "Auto / evidence-backed default";
    select.appendChild(optAuto);
  }
  options.forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt;
    el.textContent = opt.replace(/_/g, " ");
    select.appendChild(el);
  });
}

async function loadStyleProfiles() {
  const res = await fetch("/api/style-profiles");
  const data = await res.json();
  const dims = data.selectable_dimensions;
  fillSelect(dimensionSelects.documentType, dims.document_type);
  fillSelect(dimensionSelects.region, dims.region);
  fillSelect(dimensionSelects.degree, dims.degree);
  fillSelect(dimensionSelects.discipline, dims.discipline);
  fillSelect(dimensionSelects.researchMode, dims.research_mode);
  fillSelect(dimensionSelects.section, dims.section);
}

function currentStyleFilters() {
  const filters = {};
  for (const [field, key] of Object.entries(filterKeyByField)) {
    const val = dimensionSelects[field].value;
    if (val) filters[key] = val;
  }
  return filters;
}

function renderProfile(styleProfileUsed) {
  const strengthColor = { supported: "ok-badge", emerging: "", insufficient: "bad-badge" };
  profileEvidence.innerHTML = `Evidence strength: <span class="${strengthColor[styleProfileUsed.evidence_strength] || ""}">${styleProfileUsed.evidence_strength}</span>${styleProfileUsed.fallback_applied ? " (fallback applied)" : ""}`;

  $("tab-profile").innerHTML = `
    <p>${styleProfileUsed.message}</p>
    <p><strong>Effective family:</strong> ${styleProfileUsed.effective.label}</p>
    <pre>${JSON.stringify(styleProfileUsed.effective.evidence, null, 2)}</pre>
  `;
}

function renderDiagnostics(diagnostics) {
  const genericList = diagnostics.generic_phrasing
    .map((h) => `<div class="warning-item">Sentence ${h.sentenceIndex}: formulaic phrase "<em>${h.phrase}</em>"</div>`)
    .join("") || '<p class="muted">No stock/formulaic phrasing flagged.</p>';

  const monotonyList = diagnostics.structural_monotony
    .map((m) => `<div class="warning-item">${m.sentenceIndex !== null ? `Sentence ${m.sentenceIndex}: ` : ""}${m.issue} — ${m.detail}</div>`)
    .join("") || '<p class="muted">No structural monotony flagged.</p>';

  const cohesionList = diagnostics.cohesion
    .map((c) => `<div class="warning-item">Sentence ${c.sentenceIndex}: ${c.detail}</div>`)
    .join("") || '<p class="muted">No transition-stacking flagged.</p>';

  const cd = diagnostics.cadence_deviation;
  let cadenceHtml;
  if (!cd) {
    cadenceHtml = '<p class="muted">Not available.</p>';
  } else if (!cd.available) {
    cadenceHtml = `<p class="muted">${cd.reason}</p>`;
  } else {
    const flagsHtml = cd.flags.length
      ? cd.flags.map((f) => `<div class="warning-item bad">${f.type}: ${f.detail}</div>`).join("")
      : '<p class="muted">Within the observed range for this family.</p>';
    cadenceHtml = `
      <p>This document: ${cd.doc.mean.toFixed(1)} words/sentence mean, ${cd.doc.pctLong.toFixed(1)}% sentences &ge;30 words (${cd.doc.sentenceCount} sentences).</p>
      <p class="muted">Family range (${cd.family.measuredSources} measured sources): ${cd.family.meanSentenceLengthMin.toFixed(1)}&ndash;${cd.family.meanSentenceLengthMax.toFixed(1)} words/sentence mean.</p>
      ${flagsHtml}
      <p class="muted" style="margin-top:0.5rem">${cd.note || ""}</p>
    `;
  }

  $("tab-diagnostics").innerHTML = `
    <h4>Generic / formulaic phrasing</h4>${genericList}
    <h4>Structural monotony</h4>${monotonyList}
    <h4>Cohesion (transition stacking)</h4>${cohesionList}
    <h4>Cadence deviation from corpus family (experimental, Phase 4 seed)</h4>${cadenceHtml}
  `;
}

function renderPlan(plan) {
  const items = plan.items
    .map((i) => `<div class="plan-item"><span class="plan-level">${i.level}</span>${i.sentence}</div>`)
    .join("");
  const summary = Object.entries(plan.summary)
    .map(([level, count]) => `${level}: ${count}`)
    .join(" · ");
  $("tab-changes").innerHTML = `<p><strong>Plan summary:</strong> ${summary}</p>${items}`;
}

function renderChangesWithEditSummary(plan, editSummary, naturalisationApplied, build) {
  renderPlan(plan);
  const flags = (editSummary.flags_for_author || []).length
    ? `<p><strong>Flagged for author:</strong> ${editSummary.flags_for_author.join("; ")}</p>`
    : "";
  const na = naturalisationApplied;
  const proofLine = na
    ? `<p class="proof-line">Naturalisation actually applied to THIS request: level=<strong>${na.level}</strong> · em-dash ban=${na.em_dash_ban ? "on" : "off"} · cadence targeting=${na.cadence_targeting ? "on" : "off"} · syntactic diversity=${na.syntactic_diversity ? "on" : "off"} · texture exemplar=${na.texture_exemplar ? "on" : "off"} · human family sources=${na.human_family_measured_sources}${build?.commitShort ? ` · build <a href="${build.githubUrl}" target="_blank" rel="noopener">${build.commitShort}</a>` : ""}</p>`
    : "";
  $("tab-changes").innerHTML =
    proofLine +
    `<p><strong>Model edit summary:</strong> kept ${editSummary.kept}, micro-edits ${editSummary.micro_edits}, restructures ${editSummary.sentence_restructures}, split/merge ${editSummary.split_or_merge}, paragraph reorders ${editSummary.paragraph_reorders}</p>${flags}` +
    $("tab-changes").innerHTML;
}

function renderPreservation(preservation) {
  const rows = [
    ["Numbers preserved", preservation.numbers_ok],
    ["Citations preserved", preservation.citations_ok],
    ["Technical terms preserved", preservation.technical_terms_ok],
    ["Quotations unaltered", preservation.quotes_ok],
    ["No new factual claims detected", !preservation.new_factual_claims_detected],
  ];
  const rowsHtml = rows
    .map(([label, ok]) => `<div class="warning-item ${ok ? "" : "bad"}">${ok ? "✓" : "✗"} ${label}</div>`)
    .join("");
  const warnings = preservation.warnings
    .map((w) => `<div class="warning-item bad">${w.type}: ${w.detail}</div>`)
    .join("");
  $("tab-preservation").innerHTML = rowsHtml + (warnings ? `<h4>Warnings</h4>${warnings}` : "");
}

function setBusy(busy, label) {
  analyseOnlyBtn.disabled = busy;
  analyseReviseBtn.disabled = busy;
  statusMessage.textContent = label || "";
  statusMessage.className = "status-message";
}

function setError(message) {
  statusMessage.textContent = message;
  statusMessage.className = "status-message error";
}

async function runAnalyseOnly() {
  const text = sourceText.value.trim();
  if (!text) return setError("Paste some text first.");
  setBusy(true, "Analysing…");
  try {
    const res = await fetch("/api/analyse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        styleFilters: currentStyleFilters(),
        rewriteIntensity: $("rewriteIntensity").value,
        grammarIntensity: $("grammarIntensity").value,
        lengthPreference: $("lengthPreference").value,
        naturalisation: $("naturalisation").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Analysis failed");
    renderDiagnostics(data.diagnostics);
    renderPlan(data.plan);
    renderProfile(data.style_profile_used);
    setBusy(false, "Analysis complete.");
  } catch (err) {
    setBusy(false);
    setError(err.message);
  }
}

async function runAnalyseAndRevise() {
  const text = sourceText.value.trim();
  if (!text) return setError("Paste some text first.");
  setBusy(true, "Revising…");
  try {
    const res = await fetch("/api/rewrite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        styleFilters: currentStyleFilters(),
        rewriteIntensity: $("rewriteIntensity").value,
        grammarIntensity: $("grammarIntensity").value,
        lengthPreference: $("lengthPreference").value,
        naturalisation: $("naturalisation").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      // Section 19.4/22 Gate 10: specific error, source text preserved
      // (it was never sent anywhere it could be lost -- it's still in the
      // left textarea), no indefinite spinner, retry is just clicking again.
      throw new Error(`[${data.error}] ${data.message}`);
    }
    revisedText.value = data.revised_text;
    updateWordCounts();
    renderDiagnostics(data.diagnostics);
    renderProfile(data.style_profile_used);
    renderPreservation(data.preservation);
    renderChangesWithEditSummary({ items: [], summary: data.intervention_plan_summary }, data.edit_summary, data.naturalisation_applied, data.build);
    setBusy(false, `Done. Request ID ${data.requestId}${data.build?.commitShort ? ` · build ${data.build.commitShort}` : ""}`);
  } catch (err) {
    setBusy(false);
    setError(err.message);
  }
}

function renderMethodology(data) {
  const rows = (dimName, entries) =>
    entries
      .map((e) => `<div class="warning-item">${e.value}: <strong>${e.count}</strong> <span class="muted">(${e.strength})</span></div>`)
      .join("");
  $("tab-methodology").innerHTML = `
    <p>${data.totalIncluded} independent sources counted (of ${data.totalReceived} unique documents received; the rest are non-English reserve or a contemporary partial-thesis reserve, held out of counting).</p>
    <p class="muted">Strength thresholds: insufficient &lt; ${data.thresholds.emergingAt}, emerging ${data.thresholds.emergingAt}-${data.thresholds.supportedAt - 1}, supported &ge; ${data.thresholds.supportedAt}. This threshold is a configurable research parameter, not an empirically calibrated constant.</p>
    <h4>By document type</h4>${rows("document_type", data.table.document_type)}
    <h4>By region</h4>${rows("region", data.table.region)}
    <h4>By degree</h4>${rows("degree", data.table.degree)}
    <h4>By discipline</h4>${rows("discipline", data.table.discipline)}
    <h4>By research mode</h4>${rows("research_mode", data.table.research_mode)}
  `;
}

async function loadMethodology() {
  try {
    const res = await fetch("/api/methodology");
    const data = await res.json();
    renderMethodology(data);
  } catch {
    $("tab-methodology").innerHTML = '<p class="muted">Could not load coverage data.</p>';
  }
}

async function loadDetectorHealth() {
  const disclaimerEl = document.querySelector(".detector-disclaimer");
  try {
    const res = await fetch("/api/health/detectors");
    const data = await res.json();
    const statuses = data.providers.map((p) => `${p.label}: ${p.state}`).join(" · ");
    disclaimerEl.textContent =
      "These are raw outputs from a third-party classifier, shown only for your own evaluation. They are not proof of who wrote a text, are not guaranteed to match Turnitin (no public API exists for this build to call), and are never fed back into the rewrite engine. Scanning is a separate, manual action you trigger below. Provider status: " +
      statuses;
  } catch {
    disclaimerEl.textContent = "Could not load detector provider status.";
  }
}

async function runDetectorScan(which) {
  const text = which === "source" ? sourceText.value.trim() : revisedText.value.trim();
  if (!text) {
    $("detectorStatus").textContent = `No ${which} text to scan.`;
    return;
  }
  $("detectorStatus").textContent = "Scanning…";
  try {
    const res = await fetch("/api/detector-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, label: which }),
    });
    const data = await res.json();
    $("detectorStatus").textContent = "";
    const block = document.createElement("div");
    block.className = "detector-result";
    const summaryLines = data.results
      .map((r) => {
        if (r.state === "NOT_CONFIGURED") return `${r.label}: not configured`;
        if (r.state !== "READY") return `${r.label}: ${r.state} (${r.error || ""})`;
        const s = r.summary;
        if (r.parseWarning) return `${r.label}: ${r.parseWarning}`;
        return `${r.label}: predicted_class=${s?.predictedClass ?? "n/a"}, completely_generated_prob=${s?.completelyGeneratedProb ?? "n/a"}`;
      })
      .join("<br>");
    block.innerHTML = `<strong>${which} text</strong> (${new Date().toLocaleTimeString()})<br>${summaryLines}
      <details><summary>raw response</summary><pre>${JSON.stringify(data.results, null, 2)}</pre></details>`;
    $("detectorResults").prepend(block);
  } catch (err) {
    $("detectorStatus").textContent = `Scan failed: ${err.message}`;
  }
}

$("scanSourceBtn").addEventListener("click", () => runDetectorScan("source"));
$("scanRevisedBtn").addEventListener("click", () => runDetectorScan("revised"));

let longdocPollTimer = null;

function chunkStatusBadge(status) {
  return `<span class="chunk-badge ${status}">${status}</span>`;
}

function renderJobProgress(job) {
  const { progress, chunkMethod, documentMap } = job;
  const glossaryEntries = Object.entries(documentMap.glossary || {});
  const header = `
    <p><strong>${documentMap.title || "(untitled)"}</strong> — chunked by ${chunkMethod === "heading_boundary" ? "detected section headings" : "paragraph groups (no reliable headings found)"}, ${documentMap.headingCount} heading(s) detected, ${documentMap.citationCount} citation(s) tracked document-wide.</p>
    ${glossaryEntries.length ? `<p class="muted">Glossary: ${glossaryEntries.map(([k, v]) => `${k}=${v}`).join(", ")}</p>` : ""}
    <p>Progress: ${progress.doneCount}/${progress.chunkCount} done${progress.failedCount ? `, ${progress.failedCount} failed` : ""} — status: <strong>${job.status}</strong></p>
  `;
  const rows = job.chunks
    .map(
      (c) => `
    <div class="chunk-row">
      ${chunkStatusBadge(c.status)}
      <span class="chunk-heading">${c.heading || `chunk ${c.index}`} (${c.wordCount} words)${c.error ? ` — ${c.error.code}: ${c.error.message}` : ""}</span>
      ${c.status === "failed" ? `<button data-retry-index="${c.index}">Retry</button>` : ""}
    </div>`
    )
    .join("");
  $("longdocProgress").innerHTML = header + rows;

  $("longdocProgress").querySelectorAll("[data-retry-index]").forEach((btn) => {
    btn.addEventListener("click", () => retryChunk(job.id, Number(btn.dataset.retryIndex)));
  });

  if (job.status === "completed" || job.status === "completed_with_errors") {
    const p = job.documentPreservation;
    const warnings = p.warnings.map((w) => `<div class="warning-item bad">${w.type}: ${w.detail}</div>`).join("");
    $("longdocOutput").innerHTML = `
      <h4>Reassembled document</h4>
      <textarea id="longdocReassembled" readonly rows="12">${job.reassembledText}</textarea>
      <h4>Document-level preservation audit</h4>
      <div class="warning-item ${p.numbers_ok ? "" : "bad"}">${p.numbers_ok ? "✓" : "✗"} Numbers preserved</div>
      <div class="warning-item ${p.citations_ok ? "" : "bad"}">${p.citations_ok ? "✓" : "✗"} Citations preserved</div>
      <div class="warning-item ${p.technical_terms_ok ? "" : "bad"}">${p.technical_terms_ok ? "✓" : "✗"} Technical terms preserved</div>
      ${warnings}
    `;
  } else {
    $("longdocOutput").innerHTML = "";
  }
}

async function pollJob(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    const job = await res.json();
    renderJobProgress(job);
    if (job.status === "completed" || job.status === "completed_with_errors" || job.status === "failed") {
      clearInterval(longdocPollTimer);
      $("longdocStatus").textContent = `Job ${job.status}.`;
    }
  } catch (err) {
    clearInterval(longdocPollTimer);
    $("longdocStatus").textContent = `Lost connection to job: ${err.message}`;
  }
}

async function retryChunk(jobId, index) {
  $("longdocStatus").textContent = `Retrying chunk ${index}…`;
  try {
    const res = await fetch(`/api/jobs/${jobId}/chunks/${index}/retry`, { method: "POST" });
    const job = await res.json();
    renderJobProgress(job);
    $("longdocStatus").textContent = `Chunk ${index} retry: ${job.chunks[index].status}.`;
  } catch (err) {
    $("longdocStatus").textContent = `Retry failed: ${err.message}`;
  }
}

async function startLongDocJob() {
  const text = $("longdocSource").value.trim();
  if (!text) return ($("longdocStatus").textContent = "Paste a document first.");
  $("longdocStatus").textContent = "Creating job…";
  $("longdocProgress").innerHTML = "";
  $("longdocOutput").innerHTML = "";
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        styleFilters: currentStyleFilters(),
        rewriteIntensity: $("rewriteIntensity").value,
        grammarIntensity: $("grammarIntensity").value,
        lengthPreference: $("lengthPreference").value,
        naturalisation: $("naturalisation").value,
      }),
    });
    const job = await res.json();
    if (!res.ok) throw new Error(`[${job.error}] ${job.message}`);
    renderJobProgress(job);
    $("longdocStatus").textContent = `Job ${job.id} started.`;
    if (longdocPollTimer) clearInterval(longdocPollTimer);
    longdocPollTimer = setInterval(() => pollJob(job.id), 1500);
  } catch (err) {
    $("longdocStatus").textContent = `Could not start job: ${err.message}`;
  }
}

$("startJobBtn").addEventListener("click", startLongDocJob);

analyseOnlyBtn.addEventListener("click", runAnalyseOnly);
analyseReviseBtn.addEventListener("click", runAnalyseAndRevise);

loadLlmStatus();
loadBuildBadge();
loadStyleProfiles();
loadMethodology();
loadDetectorHealth();
updateWordCounts();
