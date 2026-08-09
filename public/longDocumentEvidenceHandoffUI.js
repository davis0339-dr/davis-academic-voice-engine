(() => {
  "use strict";

  const HANDOFF_KEY = "academicVoice.longdocEvidenceNeeds.v1";

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

    const card = document.createElement("section");
    card.id = "longdocEvidenceHandoff";
    card.className = "research-studio-card longdoc-evidence-handoff";
    card.innerHTML = `
      <div class="longdoc-handoff-head"><div><h4>Long Document → Evidence Bank handoff</h4><p class="muted">Davis identified these literature needs after reading the larger manuscript argument. They are search tasks, not invented evidence. Choose a need, search your uploaded bank, review the studies yourself, and transfer only the records you approve into Evidence Alignment.</p></div><button type="button" id="clearLongdocEvidenceHandoff">Clear handoff</button></div>
      ${handoff.documentGoal ? `<p><strong>Document goal:</strong> ${esc(handoff.documentGoal)}</p>` : ""}
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
    .longdoc-evidence-handoff{border-color:#4f7c68!important}.longdoc-handoff-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.longdoc-handoff-head h4{margin-top:0}.longdoc-handoff-needs{display:grid;gap:.65rem}.longdoc-handoff-needs article{padding:.75rem;border:1px solid #405269;border-radius:8px;background:rgba(8,16,28,.28)}.longdoc-handoff-needs article>span{margin-left:.5rem;opacity:.65;font-size:.82em}.longdoc-handoff-needs p{margin:.4rem 0}@media(max-width:760px){.longdoc-handoff-head{flex-direction:column}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 120) clearInterval(timer);
  }, 75);
})();
