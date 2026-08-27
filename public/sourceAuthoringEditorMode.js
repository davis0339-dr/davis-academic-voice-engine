(() => {
  "use strict";

  const HANDOFF_KEY = "academicVoice.sourceAuthoring.handoff.v1";

  function handoff() {
    try {
      const value = JSON.parse(localStorage.getItem(HANDOFF_KEY) || "null");
      return value?.assembledText && Array.isArray(value.lockedExtracts) ? value : null;
    } catch { return null; }
  }

  function init() {
    const params = new URLSearchParams(location.search);
    if (params.get("handoff") !== "source-authoring") return;
    const payload = handoff();
    if (!payload) return;
    const source = document.getElementById("sourceText");
    const revise = document.getElementById("analyseReviseBtn");
    if (!source || !revise) return;

    source.value = payload.assembledText;
    source.readOnly = true;
    source.dataset.sourceGroundedLocked = "true";
    source.dispatchEvent(new Event("input", { bubbles: true }));
    revise.disabled = true;
    revise.dataset.sourceGroundedLocked = "true";
    revise.textContent = "Revise connections in Source-Grounded Authoring";

    const banner = document.createElement("section");
    banner.className = "source-grounded-editor-banner";
    const title = document.createElement("strong");
    title.textContent = `${payload.lockedExtracts.length} verbatim extract(s) protected`;
    const explanation = document.createElement("span");
    explanation.textContent = " Analyse Only and detector review remain available here. The general rewriter is disabled because it would alter the preserved extracts. Return to the source workspace to edit the connecting passages, then send the updated assembly back.";
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "Return to Source-Grounded Authoring";
    back.addEventListener("click", () => { location.href = "/source-authoring"; });
    banner.append(title, explanation, back);
    source.closest(".pane")?.before(banner);

    document.addEventListener("click", (event) => {
      if (event.target?.id !== "analyseReviseBtn" || !handoff()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    const style = document.createElement("style");
    style.textContent = `.source-grounded-editor-banner{grid-column:1/-1;margin:.75rem 0;padding:.8rem;border:1px solid #3e7d68;border-left:4px solid #62e0b0;border-radius:8px;background:rgba(98,224,176,.08);display:flex;gap:.55rem;align-items:center;flex-wrap:wrap}.source-grounded-editor-banner span{flex:1 1 480px;color:var(--muted)}textarea[data-source-grounded-locked="true"]{border-color:#3e7d68!important;background:rgba(20,35,30,.7)!important}`;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
