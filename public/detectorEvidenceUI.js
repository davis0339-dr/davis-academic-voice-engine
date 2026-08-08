(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  async function loadEvidence() {
    const host = $("detectorResearchResults");
    if (!host) return;
    try {
      const response = await fetch("/api/detector-research/evidence");
      const data = await response.json();
      if (!response.ok) return;
      let panel = $("detectorEvidenceBasis");
      if (!panel) {
        panel = document.createElement("section");
        panel.id = "detectorEvidenceBasis";
        panel.className = "detector-evidence-basis";
        host.insertAdjacentElement("afterend", panel);
      }
      const sourceRows = (data.sources || []).map((source) => `
        <div class="evidence-source-card">
          <strong>${esc(source.citation)}</strong>
          <span>${esc(source.title)}</span>
          <span>DOI ${esc(source.doi)}</span>
          <ul>${(source.contribution || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
        </div>`).join("");
      const featureRows = (data.feature_families || []).map((family) => `
        <details>
          <summary><strong>${esc(family.label)}</strong></summary>
          <p><strong>Measured now:</strong> ${(family.measures_now || []).map(esc).join(", ") || "none"}</p>
          <p><strong>Planned deeper measurement:</strong> ${(family.planned || []).map(esc).join(", ") || "none"}</p>
          <p class="muted"><strong>Caution:</strong> ${esc(family.caution || "")}</p>
        </details>`).join("");
      const classifierRows = (data.classifier_families || []).map((family) => `
        <div class="classifier-family"><strong>${esc(family.id.replace(/_/g, " "))}</strong><span>${esc(family.description)}</span></div>`).join("");

      panel.innerHTML = `
        <h4>Academic evidence basis</h4>
        <p class="muted">Version ${esc(data.version)}. The lab separates features we genuinely measure today from deeper NLP/statistical measurements that still require implementation. No proxy is presented as dependency parsing, POS analysis, LIWC or token-probability analysis unless the required model/parser exists.</p>
        <div class="evidence-source-grid">${sourceRows}</div>
        <h4>Feature families</h4>${featureRows}
        <h4>Classifier families covered by the research model</h4>
        <div class="classifier-family-grid">${classifierRows}</div>`;
    } catch {
      // Evidence display is additive; detector research remains usable if it fails.
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    .detector-manual-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:12px 0}.detector-manual-grid label{display:flex;flex-direction:column;gap:5px}.detector-manual-grid input,.detector-manual-grid select{width:100%}.detector-wide{grid-column:1/-1}.detector-observation{margin:7px 0;padding:9px 10px;border:1px solid #34475e;border-radius:7px}.detector-observation button{margin-left:8px}.detector-research-report,.detector-evidence-basis{margin-top:14px;padding:14px;border:1px solid #34475e;border-radius:9px;background:rgba(18,30,44,.55)}.research-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px;margin:10px 0}.research-summary-grid>div{padding:8px;background:rgba(4,10,18,.35);border-radius:6px}.research-summary-grid span{display:block;font-size:.76em;opacity:.7}.research-observation-strip{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.research-observation-strip span{padding:5px 7px;border:1px solid #41566f;border-radius:5px}.research-table{width:100%;border-collapse:collapse}.research-table th,.research-table td{padding:7px;border-bottom:1px solid #34475e;text-align:left}.evidence-source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}.evidence-source-card{padding:10px;border:1px solid #34475e;border-radius:7px}.evidence-source-card>span{display:block;font-size:.82em;opacity:.72;margin-top:4px}.classifier-family-grid{display:grid;gap:7px}.classifier-family{display:grid;grid-template-columns:minmax(130px,200px) 1fr;gap:10px;padding:8px;background:rgba(4,10,18,.28);border-radius:6px}.classifier-family strong{text-transform:capitalize}
  `;
  document.head.appendChild(style);
  loadEvidence();
})();
