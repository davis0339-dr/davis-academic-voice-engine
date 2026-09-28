(() => {
  "use strict";

  const HANDOFF_KEY = "academicVoice.sourceAuthoring.handoff.v1";

  function readHandoff() {
    try {
      const value = JSON.parse(localStorage.getItem(HANDOFF_KEY) || "null");
      return value?.assembledText && Array.isArray(value.lockedExtracts) ? value : null;
    } catch { return null; }
  }

  // The protected handoff; null once the researcher has unlocked the draft.
  function handoff() {
    const value = readHandoff();
    return value && !value.unlocked ? value : null;
  }

  function showLongDocumentTab() {
    document.querySelectorAll(".tab-header").forEach((node) => node.classList.toggle("active", node.dataset.tab === "longdoc"));
    document.querySelectorAll(".tab-panel").forEach((node) => node.classList.toggle("active", node.id === "tab-longdoc"));
  }

  // An unlocked draft is ordinary editable text: reload the researcher's latest
  // working copy on refresh and keep saving their edits.
  function restoreUnlocked(payload, field, useLongDocument) {
    field.value = payload.workingText ?? payload.assembledText;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    if (useLongDocument) showLongDocumentTab();
    field.addEventListener("input", () => {
      try { localStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...readHandoff(), workingText: field.value })); } catch {}
    });
  }

  function init() {
    const params = new URLSearchParams(location.search);
    if (params.get("handoff") !== "source-authoring") return;
    const payload = readHandoff();
    if (!payload) return;
    const source = document.getElementById("sourceText");
    const revise = document.getElementById("analyseReviseBtn");
    const longdoc = document.getElementById("longdocSource");
    const startJob = document.getElementById("startJobBtn");
    if (!source || !revise || !longdoc) return;

    const words = Number(payload.wordCount) || (payload.assembledText.match(/[A-Za-z0-9']+/g) || []).length;
    const useLongDocument = payload.targetSurface === "longdoc" || words > 1500;
    const isSynthesis = payload.workflowMode === "source_synthesis";
    if (payload.unlocked) return restoreUnlocked(payload, useLongDocument ? longdoc : source, useLongDocument);
    const reviseLabel = revise.textContent;
    const startJobLabel = startJob?.textContent;
    revise.disabled = true;
    revise.dataset.sourceGroundedLocked = "true";
    revise.textContent = isSynthesis ? "Review synthesis in Source-Grounded Authoring" : "Revise connections in Source-Grounded Authoring";

    if (useLongDocument) {
      source.value = "";
      longdoc.value = payload.assembledText;
      longdoc.readOnly = true;
      longdoc.dataset.sourceGroundedLocked = "true";
      longdoc.dispatchEvent(new Event("input", { bubbles: true }));
      if (startJob) {
        startJob.disabled = true;
        startJob.dataset.sourceGroundedLocked = "true";
        startJob.textContent = isSynthesis ? "Verified source passages protected · review synthesis in Source-Grounded Authoring" : "Source extracts protected · edit connections in Source-Grounded Authoring";
      }
      showLongDocumentTab();
    } else {
      source.value = payload.assembledText;
      source.readOnly = true;
      source.dataset.sourceGroundedLocked = "true";
      source.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const banner = document.createElement("section");
    banner.className = "source-grounded-editor-banner";
    const title = document.createElement("strong");
    title.textContent = isSynthesis
      ? `${payload.lockedExtracts.length} verified quotation(s) protected · ${words.toLocaleString()}-word source synthesis`
      : `${payload.lockedExtracts.length} verbatim extract(s) protected · ${words.toLocaleString()} words`;
    const explanation = document.createElement("span");
    explanation.textContent = isSynthesis
      ? (useLongDocument
        ? " The complete synthesis is in Long Document review because it exceeds the single-section limit. Nothing was trimmed. It was generated outside the old preservation pipeline; a second automatic rewrite is disabled so its verified source treatment is not silently changed."
        : " Analyse Only and detector review remain available. The synthesis was generated from a visible evidence notebook outside the old preservation pipeline; return to Source-Grounded Authoring to revise its prose directly.")
      : (useLongDocument
        ? " The complete manuscript has been routed to Long Document review because it exceeds the single-section limit. Nothing was trimmed. Rewriting is disabled because it would alter the extracts; detector evidence can still be reviewed, and connections remain editable in Source-Grounded Authoring."
        : " Analyse Only and detector review remain available here. The general rewriter is disabled because it would alter the preserved extracts. Return to the source workspace to edit the connecting passages, then send the updated assembly back.");
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "Return to Source-Grounded Authoring";
    back.addEventListener("click", () => { location.href = "/source-authoring"; });
    // Protection is the default, but the researcher can release it so the
    // transferred draft is never left in a workspace with nothing to act on.
    const unlock = document.createElement("button");
    unlock.type = "button";
    unlock.textContent = useLongDocument ? "Unlock and work on this text in Long Document" : "Unlock and work on this text in the Editor";
    unlock.addEventListener("click", () => {
      if (!window.confirm("Unlock this draft? This authorises the Editor to rewrite the whole draft, including your own text and the verbatim source extracts. Check quotations against the studies afterwards.")) return;
      try { localStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...payload, unlocked: true })); } catch {}
      for (const field of [source, longdoc]) {
        field.readOnly = false;
        delete field.dataset.sourceGroundedLocked;
      }
      delete revise.dataset.sourceGroundedLocked;
      revise.disabled = false;
      revise.textContent = reviseLabel;
      if (startJob) {
        delete startJob.dataset.sourceGroundedLocked;
        startJob.disabled = false;
        startJob.textContent = startJobLabel;
      }
      banner.remove();
      restoreUnlocked({ ...payload, workingText: (useLongDocument ? longdoc : source).value }, useLongDocument ? longdoc : source, useLongDocument);
    });
    banner.append(title, explanation, back, unlock);
    (useLongDocument ? document.getElementById("tab-longdoc") : source.closest(".pane"))?.before(banner);

    document.addEventListener("click", (event) => {
      if (!["analyseReviseBtn", "startJobBtn"].includes(event.target?.id) || !handoff()) return;
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
