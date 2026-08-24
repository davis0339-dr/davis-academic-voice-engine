const $ = (id) => document.getElementById(id);

const sourceText = $("sourceText");
const revisedText = $("revisedText");
const longdocSource = $("longdocSource");
const llmStatusEl = $("llmStatus");
const statusMessage = $("statusMessage");
const analyseOnlyBtn = $("analyseOnlyBtn");
const analyseReviseBtn = $("analyseReviseBtn");
const profileEvidence = $("profileEvidence");
const startJobBtn = $("startJobBtn");

const DEFAULT_LIMITS = {
  singleEditorWordLimit: 1500,
  longDocumentWordLimit: 12000,
  uploadFileSizeLimitBytes: 5 * 1024 * 1024,
};
let capabilities = { ...DEFAULT_LIMITS };
let busyTimer = null;
let busyStartedAt = null;
let busyBaseLabel = "";
let longdocPollTimer = null;

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
  return (String(text || "").match(/[A-Za-z0-9']+/g) || []).length;
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function updateLimitUi() {
  $("sourceLimitHint").textContent = `Single editor: up to ${formatNumber(capabilities.singleEditorWordLimit)} words. Larger text belongs in Long Document.`;
  $("longdocLimitHint").textContent = `Current beta benchmark: up to ${formatNumber(capabilities.longDocumentWordLimit)} words per job.`;
}

function setLimitState(el, count, limit) {
  el.classList.toggle("near-limit", count >= limit * 0.85 && count <= limit);
  el.classList.toggle("over-limit", count > limit);
}

function updateWordCounts() {
  const sourceWords = wordCount(sourceText.value);
  const revisedWords = wordCount(revisedText.value);
  const longWords = wordCount(longdocSource.value);

  $("sourceWordCount").textContent = `${formatNumber(sourceWords)} / ${formatNumber(capabilities.singleEditorWordLimit)} words`;
  $("revisedWordCount").textContent = `${formatNumber(revisedWords)} words`;
  $("longdocWordCount").textContent = `${formatNumber(longWords)} / ${formatNumber(capabilities.longDocumentWordLimit)} words`;

  setLimitState($("sourceWordCount"), sourceWords, capabilities.singleEditorWordLimit);
  setLimitState($("longdocWordCount"), longWords, capabilities.longDocumentWordLimit);

  const singleOver = sourceWords > capabilities.singleEditorWordLimit;
  const longOver = longWords > capabilities.longDocumentWordLimit;
  analyseOnlyBtn.disabled = analyseOnlyBtn.dataset.busy === "true" || singleOver;
  analyseReviseBtn.disabled = analyseReviseBtn.dataset.busy === "true" || singleOver;
  startJobBtn.disabled = startJobBtn.dataset.busy === "true" || longOver;
}
sourceText.addEventListener("input", updateWordCounts);
longdocSource.addEventListener("input", updateWordCounts);

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

function configureMobileControls() {
  const rail = $("controlRail");
  const button = $("toggleControlsBtn");
  if (!rail || !button) return;
  const apply = (collapsed) => {
    rail.classList.toggle("collapsed", collapsed);
    button.textContent = collapsed ? "Show" : "Hide";
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  };
  if (window.matchMedia("(max-width: 700px)").matches) apply(true);
  button.addEventListener("click", () => apply(!rail.classList.contains("collapsed")));
}

async function loadBuildBadge() {
  const el = $("buildBadge");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    el.textContent = "build: " + (data.build?.commitShort || "unknown");
    if (data.build?.githubUrl) el.href = data.build.githubUrl;
    capabilities = { ...DEFAULT_LIMITS, ...(data.capabilities || {}) };
    updateLimitUi();
    updateWordCounts();
  } catch {
    el.textContent = "build: unavailable";
    updateLimitUi();
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
      NOT_CONFIGURED: "LLM: not configured",
      AUTH_FAILED: "LLM: auth failed",
      RATE_LIMITED: "LLM: rate limited",
      NETWORK_TIMEOUT: "LLM: network timeout",
      PROVIDER_OVERLOADED: "LLM: provider overloaded",
      PROVIDER_UNAVAILABLE: "LLM: provider unavailable",
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
      <p class="muted">${cd.note || ""}</p>
    `;
  }

  $("tab-diagnostics").innerHTML = `
    <h4>Generic / formulaic phrasing</h4>${genericList}
    <h4>Structural monotony</h4>${monotonyList}
    <h4>Cohesion and transition patterning</h4>${cohesionList}
    <h4>Cadence deviation from corpus family</h4>${cadenceHtml}
  `;
}

function renderPlan(plan) {
  const items = plan.items
    .map((i) => `<div class="plan-item"><span class="plan-level">${i.level}</span><span>${i.sentence}</span></div>`)
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
    ? `<p class="proof-line">Applied to this request: level=<strong>${na.level}</strong> · cadence profile=${na.cadence_targeting ? "on" : "off"} · syntactic diversity=${na.syntactic_diversity ? "on" : "off"} · measured family sources=${na.human_family_measured_sources}${build?.commitShort ? ` · build <a href="${build.githubUrl}" target="_blank" rel="noopener">${build.commitShort}</a>` : ""}</p>`
    : "";
  $("tab-changes").innerHTML =
    proofLine +
    `<p><strong>Model edit summary:</strong> kept ${editSummary.kept}, micro-edits ${editSummary.micro_edits}, restructures ${editSummary.sentence_restructures}, split/merge ${editSummary.split_or_merge}, paragraph reorders ${editSummary.paragraph_reorders}</p>${flags}` +
    $("tab-changes").innerHTML;
}

function renderAdditionalInputs(additionalInputs = [], revisionPurpose = "fidelity") {
  const target = $("tab-changes");
  if (!target || revisionPurpose !== "collaborative") return;
  const items = Array.isArray(additionalInputs) ? additionalInputs : [];
  const content = items.length
    ? items.map((item) => `
      <article class="additional-input-card">
        <div class="additional-input-head">
          <strong>${escapeHtml(String(item.kind || "input").replace(/_/g, " "))}</strong>
          <span class="additional-input-status">${escapeHtml(String(item.status || "researcher_confirmation_required").replace(/_/g, " "))}</span>
        </div>
        ${item.location ? `<p class="muted"><strong>Applies to:</strong> ${escapeHtml(item.location)}</p>` : ""}
        <p>${escapeHtml(item.proposal)}</p>
        ${item.reason ? `<p class="muted"><strong>Why it matters:</strong> ${escapeHtml(item.reason)}</p>` : ""}
        ${item.researcher_question ? `<p><strong>Question for you:</strong> ${escapeHtml(item.researcher_question)}</p>` : ""}
        ${item.evidence_needed ? `<p class="additional-input-evidence"><strong>Verification needed:</strong> ${escapeHtml(item.evidence_needed)}</p>` : ""}
      </article>`).join("")
    : '<p class="muted">No high-value additions or verification needs were identified in this revision.</p>';
  target.insertAdjacentHTML("afterbegin", `
    <section class="additional-inputs-panel" aria-label="Proposed additions requiring review">
      <h3>Additional inputs — not inserted into the manuscript</h3>
      <p class="muted">These are collaboration prompts only. Confirm the reasoning or verify the evidence before adding anything to the revised text.</p>
      ${content}
    </section>`);
}

function renderPreservation(preservation, release = null) {
  const rhetorical = preservation.rhetorical_semantic_preservation || {};
  const warningTypes = new Set((preservation.warnings || []).map((warning) => warning.type));
  const rows = [
    ["Numbers preserved", preservation.numbers_ok],
    ["Numeric ranges preserved", preservation.ranges_ok !== false],
    ["No unsupported numbers introduced", !warningTypes.has("new_numeric_value_introduced")],
    ["Citations preserved", preservation.citations_ok],
    ["No unsupported citations introduced", !warningTypes.has("new_citation_introduced")],
    ["Technical terms preserved", preservation.technical_terms_ok],
    ["Quotations unaltered", preservation.quotes_ok],
    ["Study stage / proposal tense preserved", preservation.study_stage_ok !== false],
    ["Researcher voice/register preserved", preservation.researcher_voice_ok !== false],
    ["Section/chapter structure preserved", preservation.document_structure_ok !== false],
    ["Explicit list counts remain consistent", preservation.list_counts_ok !== false],
    ["Claim/evidence attachment has no review signal", !(preservation.claim_attachment_review || []).length],
    ["Rhetorical & semantic architecture preserved", preservation.rhetorical_semantic_ok !== false],
    ["No new factual claims detected", !preservation.new_factual_claims_detected],
  ];
  const rowsHtml = rows
    .map(([label, ok]) => `<div class="warning-item ${ok ? "" : "bad"}">${ok ? "✓" : "✗"} ${label}</div>`)
    .join("");
  const warnings = (preservation.warnings || [])
    .map((w) => `<div class="warning-item bad">${w.type}: ${w.detail}</div>`)
    .join("");
  const rhetoricalHtml = rhetorical.audit_version ? `
    <section class="preservation-detail-panel">
      <h4>Rhetorical &amp; Semantic Preservation</h4>
      <div class="warning-item">Source propositions preserved: ${escapeHtml(String(rhetorical.source_propositions_preserved ?? "n/a"))}/${escapeHtml(String(rhetorical.source_propositions_total ?? "n/a"))}</div>
      <div class="warning-item ${rhetorical.topic_or_framing_sentences_lost ? "bad" : ""}">Topic/framing sentences lost: ${escapeHtml(rhetorical.topic_or_framing_sentences_lost || 0)}</div>
      <div class="warning-item ${rhetorical.transitions_lost ? "bad" : ""}">Transitions lost: ${escapeHtml(rhetorical.transitions_lost || 0)}</div>
      <div class="warning-item ${rhetorical.interpretive_statements_lost ? "bad" : ""}">Interpretive statements lost: ${escapeHtml(rhetorical.interpretive_statements_lost || 0)}</div>
      <div class="warning-item ${rhetorical.qualifications_or_caveats_lost ? "bad" : ""}">Qualifications/caveats lost: ${escapeHtml(rhetorical.qualifications_or_caveats_lost || 0)}</div>
      <div class="warning-item">Possible topic/framing role changes (review evidence): ${escapeHtml(rhetorical.possible_topic_or_framing_role_changes || 0)}</div>
      <div class="warning-item">Possible transition role changes (review evidence): ${escapeHtml(rhetorical.possible_transition_role_changes || 0)}</div>
      <div class="warning-item">Possible interpretation role changes (review evidence): ${escapeHtml(rhetorical.possible_interpretive_role_changes || 0)}</div>
      <div class="warning-item">Possible qualification/caveat role changes (review evidence): ${escapeHtml(rhetorical.possible_qualification_or_caveat_role_changes || 0)}</div>
      <div class="warning-item">Possible contrast/concession role changes (review evidence): ${escapeHtml(rhetorical.possible_contrast_or_concession_role_changes || 0)}</div>
      <p class="muted">Role-marker changes are supporting evidence only. They are reported as losses above only when proposition loss or material compression independently corroborates them.</p>
      <div class="warning-item ${(rhetorical.modality_changes || []).length ? "bad" : ""}">Modality/certainty changes: ${escapeHtml((rhetorical.modality_changes || []).length)}</div>
      <div class="warning-item ${(rhetorical.causality_changes || []).length ? "bad" : ""}">Causality changes: ${escapeHtml((rhetorical.causality_changes || []).length)}</div>
      <div class="warning-item ${(rhetorical.scope_or_generalisation_changes || []).length ? "bad" : ""}">Scope/generalisation changes: ${escapeHtml((rhetorical.scope_or_generalisation_changes || []).length)}</div>
      <div class="warning-item ${(rhetorical.unsupported_additions || []).length ? "bad" : ""}">Unsupported additions: ${escapeHtml((rhetorical.unsupported_additions || []).length)}</div>
      <div class="warning-item ${(rhetorical.paragraphs_compressed_beyond_threshold || []).length ? "bad" : ""}">Paragraphs compressed beyond threshold: ${escapeHtml((rhetorical.paragraphs_compressed_beyond_threshold || []).length)}</div>
      <div class="warning-item ${rhetorical.length_within_soft_range === false ? "bad" : ""}">Source/revision length ratio: ${escapeHtml(rhetorical.overall_length_ratio ?? "n/a")} (${escapeHtml(rhetorical.length_preference || "auto")})</div>
    </section>` : "";
  const releaseHtml = release ? `
    <section class="preservation-detail-panel">
      <h4>Release decision</h4>
      <div class="warning-item ${release.release_status === "cleared" ? "" : "bad"}">${escapeHtml(String(release.release_status || "review_required").replace(/_/g, " "))}</div>
      <p>${escapeHtml(release.note || "")}</p>
      <p class="muted">Repair-required warnings: ${escapeHtml((release.repair_warning_types || []).join(", ") || "none")} · Review-only warnings: ${escapeHtml((release.review_warning_types || []).join(", ") || "none")}</p>
    </section>` : "";
  $("tab-preservation").innerHTML = releaseHtml + rowsHtml + rhetoricalHtml + (warnings ? `<h4>Warnings</h4>${warnings}` : "");
}

function clearBusyTimer() {
  if (busyTimer) clearInterval(busyTimer);
  busyTimer = null;
  busyStartedAt = null;
}

function setBusy(busy, label) {
  analyseOnlyBtn.dataset.busy = busy ? "true" : "false";
  analyseReviseBtn.dataset.busy = busy ? "true" : "false";
  analyseOnlyBtn.disabled = busy;
  analyseReviseBtn.disabled = busy;
  clearBusyTimer();

  if (busy) {
    busyStartedAt = Date.now();
    busyBaseLabel = label || "Working…";
    const paint = () => {
      const elapsed = Math.round((Date.now() - busyStartedAt) / 1000);
      const stage = elapsed < 20
        ? "Reading the argument and constructing the intervention plan."
        : elapsed < 75
          ? "The provider is composing the first complete candidate. No output has been discarded."
          : elapsed < 150
            ? "Still waiting for the primary reconstruction. Near-limit Deep requests can take longer; the full request will not be restarted merely because it is slow."
            : "The primary provider call is unusually slow. If it completes safely, optional refinements will use the remaining time budget rather than restart the manuscript.";
      statusMessage.textContent = `${busyBaseLabel} ${elapsed}s elapsed. ${stage}`;
    };
    paint();
    busyTimer = setInterval(paint, 1000);
  } else {
    statusMessage.textContent = label || "";
  }
  statusMessage.className = "status-message";
  updateWordCounts();
}

function setError(message) {
  clearBusyTimer();
  statusMessage.textContent = message;
  statusMessage.className = "status-message error";
  analyseOnlyBtn.dataset.busy = "false";
  analyseReviseBtn.dataset.busy = "false";
  updateWordCounts();
}

function validateSingleText(text) {
  const words = wordCount(text);
  if (!text) {
    setError("Paste or upload some text first.");
    return false;
  }
  if (words > capabilities.singleEditorWordLimit) {
    setError(`This text is ${formatNumber(words)} words. The single editor accepts up to ${formatNumber(capabilities.singleEditorWordLimit)} words; use Long Document instead.`);
    return false;
  }
  return true;
}

async function runAnalyseOnly() {
  const text = sourceText.value.trim();
  if (!validateSingleText(text)) return;
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
        revisionPurpose: $("revisionPurpose").value,
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
  if (!validateSingleText(text)) return;
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
        revisionPurpose: $("revisionPurpose").value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`[${data.error || "ERROR"}] ${data.message || "Revision failed"}${formatProviderUsage(data.provider_usage)}`);
    revisedText.value = data.revised_text || "";
    updateWordCounts();
    renderDiagnostics(data.diagnostics);
    renderProfile(data.style_profile_used);
    const rejectedPreservation = data.execution_compliance?.rejected_preservation_failure?.preservation;
    renderPreservation(data.preservation || rejectedPreservation || {}, data.preservation_release);
    renderChangesWithEditSummary({ items: [], summary: data.intervention_plan_summary }, data.edit_summary, data.naturalisation_applied, data.build);
    renderAdditionalInputs(data.additional_inputs, data.revision_purpose);
    const acceptanceReasons = data.output_acceptance?.reasons || [];
    const lengthContractMissed = acceptanceReasons.includes("expand_length_contract_missed") || acceptanceReasons.includes("deep_auto_developmental_compression");
    const sourceWords = data.output_acceptance?.dimensions?.source_word_count;
    const candidateWords = data.output_acceptance?.dimensions?.candidate_word_count;
    const lengthEvidence = Number.isFinite(sourceWords) && Number.isFinite(candidateWords)
      ? ` Source ${formatNumber(sourceWords)} words → candidate ${formatNumber(candidateWords)} words.`
      : "";
    const expandContract = data.length_contract?.mode === "expand" ? data.length_contract : null;
    const expandEvidence = expandContract?.satisfied
      ? ` Expand contract met: +${formatNumber(Math.max(0, Number(candidateWords || 0) - Number(sourceWords || 0)))} words (minimum +${formatNumber(expandContract.minimum_addition_words)}).`
      : "";
    const outcome = lengthContractMissed && data.candidate_verdict?.final_status !== "accepted"
        ? `Best complete preservation-safe revision returned.${lengthEvidence} Expand requested at least +${formatNumber(expandContract?.minimum_addition_words || 200)} words; the achieved increase is shown for honest researcher review. No additional paid full-document retry was launched.`
        : data.candidate_verdict?.final_status === "accepted"
         ? `Revision completed and internally cleared.${expandEvidence}`
        : `Complete candidate returned for researcher review; it has not been labelled as an internally cleared final revision.${lengthEvidence}`;
    setBusy(false, `${outcome} Request ${data.requestId}${data.build?.commitShort ? ` · build ${data.build.commitShort}` : ""}${formatProviderUsage(data.provider_usage)}`);
    statusMessage.className = data.candidate_verdict?.final_status !== "accepted"
      ? "status-message error"
      : "status-message";
  } catch (err) {
    setBusy(false);
    setError(err.message);
  }
}

function formatProviderUsage(usage) {
  if (!usage) return "";
  const cost = Number.isFinite(usage.estimated_cost_usd) ? ` · estimated $${usage.estimated_cost_usd.toFixed(4)}` : "";
  return ` · provider ${usage.attempted_calls}/${usage.max_calls} calls · ${formatNumber(usage.input_tokens)} input + ${formatNumber(usage.output_tokens)} output tokens${cost}`;
}

function renderMethodology(data) {
  const rows = (entries) => entries
    .map((e) => `<div class="warning-item">${e.value}: <strong>${e.count}</strong> <span class="muted">(${e.strength})</span></div>`)
    .join("");
  $("tab-methodology").innerHTML = `
    <p>${data.totalIncluded} independent sources counted from the current evidence corpus.</p>
    <p class="muted">Strength thresholds are research parameters, not authorship probabilities.</p>
    <h4>By document type</h4>${rows(data.table.document_type)}
    <h4>By region</h4>${rows(data.table.region)}
    <h4>By degree</h4>${rows(data.table.degree)}
    <h4>By discipline</h4>${rows(data.table.discipline)}
    <h4>By research mode</h4>${rows(data.table.research_mode)}
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
      "Third-party classifier output is shown for evaluation only. It is not proof of authorship and is never fed automatically into generation. Provider status: " + statuses;
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

function chunkStatusBadge(status) {
  return `<span class="chunk-badge ${status}">${status}</span>`;
}

function renderJobProgress(job) {
  const { progress, chunkMethod, documentMap } = job;
  const glossaryEntries = Object.entries(documentMap.glossary || {});
  const eta = progress.estimatedRemainingMs ? ` · estimated remaining ${formatDuration(progress.estimatedRemainingMs)}` : "";
  const avg = progress.averageChunkDurationMs ? ` · avg chunk ${formatDuration(progress.averageChunkDurationMs)}` : "";
  const header = `
    <p><strong>${documentMap.title || "(untitled)"}</strong> — ${chunkMethod === "heading_boundary" ? "section-aware chunking" : "paragraph-group chunking"}, ${documentMap.headingCount} heading(s), ${documentMap.citationCount} citation(s) tracked.</p>
    ${glossaryEntries.length ? `<p class="muted">Glossary: ${glossaryEntries.map(([k, v]) => `${k}=${v}`).join(", ")}</p>` : ""}
    <p>Progress: <strong>${progress.doneCount}/${progress.chunkCount}</strong> done${progress.failedCount ? `, ${progress.failedCount} failed` : ""} · status <strong>${job.status}</strong>${avg}${eta}</p>
  `;
  const rows = job.chunks
    .map((c) => `
    <div class="chunk-row">
      ${chunkStatusBadge(c.status)}
      <span class="chunk-heading">${c.heading || `chunk ${c.index}`} (${c.wordCount} words)${c.inferredSection ? ` · ${c.inferredSection.replace(/_/g, " ")}` : ""}${c.attempts ? ` · attempt ${c.attempts}` : ""}${c.durationMs ? ` · ${formatDuration(c.durationMs)}` : ""}${c.error ? ` — ${c.error.code}: ${c.error.message}` : ""}</span>
      ${c.status === "failed" ? `<button data-retry-index="${c.index}">Retry</button>` : ""}
    </div>`)
    .join("");
  $("longdocProgress").innerHTML = header + rows;

  $("longdocProgress").querySelectorAll("[data-retry-index]").forEach((btn) => {
    btn.addEventListener("click", () => retryChunk(job.id, Number(btn.dataset.retryIndex)));
  });

  if (job.status === "completed" || job.status === "completed_with_errors") {
    const p = job.documentPreservation || {};
    const release = job.documentPreservationRelease || {};
    const warningTypes = new Set((p.warnings || []).map((warning) => warning.type));
    const preservationRows = [
      ["Numbers preserved", p.numbers_ok],
      ["Numeric ranges preserved", p.ranges_ok !== false],
      ["No unsupported numbers introduced", !warningTypes.has("new_numeric_value_introduced")],
      ["Citations preserved", p.citations_ok],
      ["No unsupported citations introduced", !warningTypes.has("new_citation_introduced")],
      ["Technical terms preserved", p.technical_terms_ok],
      ["Quotations unaltered", p.quotes_ok],
      ["Study stage preserved", p.study_stage_ok !== false],
      ["Researcher voice/register preserved", p.researcher_voice_ok !== false],
      ["Section/chapter structure preserved", p.document_structure_ok !== false],
      ["Explicit list counts remain consistent", p.list_counts_ok !== false],
      ["Rhetorical & semantic architecture preserved", p.rhetorical_semantic_ok !== false],
    ].map(([label, ok]) => `<div class="warning-item ${ok ? "" : "bad"}">${ok ? "✓" : "✗"} ${label}</div>`).join("");
    const warnings = (p.warnings || []).map((w) => `<div class="warning-item bad">${w.type}: ${w.detail}</div>`).join("");
    $("longdocOutput").innerHTML = `
      <h4>Reassembled document</h4>
      <textarea id="longdocReassembled" readonly rows="12">${job.reassembledText}</textarea>
      <h4>Document-level preservation audit</h4>
      <div class="warning-item ${release.release_status === "cleared" ? "" : "bad"}"><strong>${escapeHtml(String(release.release_status || "review_required").replace(/_/g, " "))}</strong> — ${escapeHtml(release.note || "Review the detailed preservation evidence below.")}</div>
      ${preservationRows}
      ${warnings}
    `;
  } else {
    $("longdocOutput").innerHTML = "";
  }
}

function stopLongdocPolling() {
  if (longdocPollTimer) clearTimeout(longdocPollTimer);
  longdocPollTimer = null;
}

async function pollJob(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.message || job.error || "Job status unavailable");
    renderJobProgress(job);
    if (job.status === "completed" || job.status === "completed_with_errors" || job.status === "failed") {
      stopLongdocPolling();
      startJobBtn.dataset.busy = "false";
      $("longdocStatus").textContent = `Job ${job.status}.`;
      updateWordCounts();
      return;
    }
    $("longdocStatus").textContent = `Processing ${job.progress.doneCount + job.progress.processingCount}/${job.progress.chunkCount} chunks…`;
    longdocPollTimer = setTimeout(() => pollJob(jobId), 1000);
  } catch (err) {
    stopLongdocPolling();
    startJobBtn.dataset.busy = "false";
    updateWordCounts();
    $("longdocStatus").textContent = `Lost connection to job: ${err.message}`;
  }
}

function beginLongdocPolling(jobId) {
  stopLongdocPolling();
  longdocPollTimer = setTimeout(() => pollJob(jobId), 500);
}

async function retryChunk(jobId, index) {
  $("longdocStatus").textContent = `Retry queued for chunk ${index}…`;
  try {
    const res = await fetch(`/api/jobs/${jobId}/chunks/${index}/retry`, { method: "POST" });
    const job = await res.json();
    if (!res.ok) throw new Error(job.message || job.error || "Retry failed");
    renderJobProgress(job);
    $("longdocStatus").textContent = `Chunk ${index} retry is processing in the background.`;
    beginLongdocPolling(job.id);
  } catch (err) {
    $("longdocStatus").textContent = `Retry failed: ${err.message}`;
  }
}

async function startLongDocJob() {
  const text = longdocSource.value.trim();
  const words = wordCount(text);
  if (!text) return ($("longdocStatus").textContent = "Paste or upload a document first.");
  if (words > capabilities.longDocumentWordLimit) {
    return ($("longdocStatus").textContent = `This document is ${formatNumber(words)} words. Current long-document capacity is ${formatNumber(capabilities.longDocumentWordLimit)} words per job.`);
  }
  startJobBtn.dataset.busy = "true";
  startJobBtn.disabled = true;
  $("longdocStatus").textContent = "Creating background job…";
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
    if (!res.ok) throw new Error(`[${job.error || "ERROR"}] ${job.message || "Could not create job"}`);
    renderJobProgress(job);
    $("longdocStatus").textContent = `Job started. ${job.progress.chunkCount} chunks queued.`;
    beginLongdocPolling(job.id);
  } catch (err) {
    startJobBtn.dataset.busy = "false";
    updateWordCounts();
    $("longdocStatus").textContent = `Could not start job: ${err.message}`;
  }
}

async function importInto(fileInput, targetTextarea, statusEl, limit, label) {
  const file = fileInput.files?.[0];
  if (!file) return;
  statusEl.textContent = `Reading ${file.name}…`;
  statusEl.className = "file-status";
  try {
    const result = await window.AcademicFileImport.readAcademicFile(file, capabilities.uploadFileSizeLimitBytes);
    targetTextarea.value = result.text;
    const words = wordCount(result.text);
    statusEl.textContent = `${file.name}: ${formatNumber(words)} words imported${result.warnings?.length ? ` · ${result.warnings.length} conversion warning(s)` : ""}.`;
    statusEl.className = `file-status ${words > limit ? "error" : "ready"}`;
    updateWordCounts();
    if (words > limit) {
      statusEl.textContent += ` ${label} limit is ${formatNumber(limit)} words.`;
    }
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "file-status error";
  } finally {
    fileInput.value = "";
  }
}

$("sourceFileInput").addEventListener("change", () =>
  importInto($("sourceFileInput"), sourceText, $("sourceFileStatus"), capabilities.singleEditorWordLimit, "Single editor")
);
$("longdocFileInput").addEventListener("change", () =>
  importInto($("longdocFileInput"), longdocSource, $("longdocFileStatus"), capabilities.longDocumentWordLimit, "Long Document")
);

$("startJobBtn").addEventListener("click", startLongDocJob);
analyseOnlyBtn.addEventListener("click", runAnalyseOnly);
analyseReviseBtn.addEventListener("click", runAnalyseAndRevise);

configureMobileControls();
loadLlmStatus();
loadBuildBadge();
loadStyleProfiles();
loadMethodology();
loadDetectorHealth();
updateLimitUi();
updateWordCounts();

