(() => {
  "use strict";

  const HANDOFF_KEY = "academicVoice.longdocEvidenceNeeds.v1";
  const SOURCE_KEY = "academicVoice.workspace.source.v1";
  const REVISED_KEY = "academicVoice.workspace.revised.v1";

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function loadHandoff() {
    try {
      const value = JSON.parse(localStorage.getItem(HANDOFF_KEY) || "null");
      return value && Array.isArray(value.needs) ? value : null;
    } catch { return null; }
  }

  function applyCandidateContext(handoff) {
    if (!handoff) return;
    const source = document.getElementById("sourceText");
    const revised = document.getElementById("revisedText");
    if (source && handoff.sourceText) source.value = handoff.sourceText;
    if (revised && handoff.candidateText) revised.value = handoff.candidateText;
    try {
      if (handoff.sourceText) localStorage.setItem(SOURCE_KEY, handoff.sourceText);
      if (handoff.candidateText) localStorage.setItem(REVISED_KEY, handoff.candidateText);
    } catch {}

    const status = document.getElementById("studioShellStatus");
    if (status && handoff.candidateText) {
      status.textContent = "Long Document handoff loaded. Evidence development will work on the reworked candidate shown under Current revised context; the original source remains available as a fidelity reference.";
    }
  }

  function searchNeed(need) {
    const input = document.getElementById("literatureBankSearch");
    const button = document.getElementById("literatureBankSearchBtn");
    if (!input || !button) return;
    input.value = need.query || "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    button.click();
    document.getElementById("literatureEvidenceBank")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function install() {
    const handoff = loadHandoff();
    const bank = document.getElementById("literatureEvidenceBank");
    if (!handoff || !bank || document.getElementById("longdocEvidenceHandoff")) return Boolean(bank);

    applyCandidateContext(handoff);

    const card = document.createElement("section");
    card.id = "longdocEvidenceHandoff";
    card.className = "research-studio-card longdoc-evidence-handoff";
    card.innerHTML = `
      <div class="longdoc-handoff-head"><div><h4>Long Document → Evidence Bank handoff</h4><p class="muted">This handoff is anchored to the <strong>reworked long-document candidate</strong>. Davis identified literature needs after reading the manuscript as a whole. Search and approve evidence here, then use Controlled academic reconstruction to strengthen that candidate rather than restarting the manuscript from scratch.</p></div><button type="button" id="clearLongdocEvidenceHandoff">Clear handoff</button></div>
      ${handoff.documentGoal ? `<p><strong>Document goal:</strong> ${esc(handoff.documentGoal)}</p>` : ""}
      <div class="longdoc-handoff-summary">
        <div><span>Job</span><strong>${esc(handoff.jobId || "n/a")}</strong></div>
        <div><span>Evidence depth</span><strong>${esc(handoff.evidenceDepth || "targeted")}</strong></div>
        <div><span>Candidate loaded</span><strong>${handoff.candidateText ? "yes" : "no"}</strong></div>
        <div><span>Evidence needs</span><strong>${handoff.needs.length}</strong></div>
      </div>
      ${handoff.externalDetectorResults?.length ? `<details><summary>External detector observations attached to this candidate (${handoff.externalDetectorResults.length})</summary><p class="muted">These are version-linked diagnostic observations only. They are not generation instructions.</p>${handoff.externalDetectorResults.slice(-8).map((row) => `<div class="longdoc-detector-observation"><strong>${esc(row.detector)}</strong> · ${esc(row.classification)} · AI ${row.aiScore === "" ? "n/a" : esc(row.aiScore) + "%"} · Human ${row.humanScore === "" ? "n/a" : esc(row.humanScore) + "%"}</div>`).join("")}</details>` : ""}
      <div class="longdoc-handoff-needs">${handoff.needs.map((need, index) => `
        <article>
          <strong>${esc(need.section || `Evidence need ${index + 1}`)}</strong>
          <span>${esc((need.need_type || "support").replace(/_/g, " "))}</span>
          <p>${esc(need.query || "")}</p>
          ${need.rationale ? `<p class="muted">${esc(need.rationale)}</p>` : ""}
          <button type="button" data-search-longdoc-need="${index}">Search this need in my Literature Bank</button>
        </article>`).join("")}</div>`;
    bank.parentNode.insertBefore(card, bank);

    card.querySelectorAll("[data-search-longdoc-need]").forEach((button) => {
      button.addEventListener("click", () => searchNeed(handoff.needs[Number(button.dataset.searchLongdocNeed)]));
    });
    document.getElementById("clearLongdocEvidenceHandoff")?.addEventListener("click", () => {
      localStorage.removeItem(HANDOFF_KEY);
      card.remove();
    });
    return true;
  }

  const style = document.createElement("style");
  style.textContent = `
    .longdoc-evidence-handoff{border-color:#4f7c68!important}.longdoc-handoff-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.longdoc-handoff-head h4{margin-top:0}.longdoc-handoff-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.5rem;margin:.7rem 0}.longdoc-handoff-summary>div{padding:.5rem;border:1px solid #405269;border-radius:7px}.longdoc-handoff-summary span{display:block;opacity:.7;font-size:.8em}.longdoc-handoff-summary strong{display:block;margin-top:.2rem}.longdoc-handoff-needs{display:grid;gap:.65rem}.longdoc-handoff-needs article{padding:.75rem;border:1px solid #405269;border-radius:8px;background:rgba(8,16,28,.28)}.longdoc-handoff-needs article>span{margin-left:.5rem;opacity:.65;font-size:.82em}.longdoc-handoff-needs p{margin:.4rem 0}.longdoc-detector-observation{padding:.35rem 0;border-bottom:1px solid #34475e}@media(max-width:760px){.longdoc-handoff-head{flex-direction:column}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 120) clearInterval(timer);
  }, 75);
})();
