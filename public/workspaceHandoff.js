(() => {
  "use strict";

  const SOURCE_KEY = "academicVoice.workspace.source.v1";
  const REVISED_KEY = "academicVoice.workspace.revised.v1";
  const DRAFT_KEY = "academicVoice.workspace.studioDraft.v1";

  function saveEditorContext() {
    try {
      const source = document.getElementById("sourceText")?.value || "";
      const revised = document.getElementById("revisedText")?.value || "";
      localStorage.setItem(SOURCE_KEY, source);
      localStorage.setItem(REVISED_KEY, revised);
    } catch {}
  }

  function restoreStudioDraftIfRequested() {
    const params = new URLSearchParams(location.search);
    if (params.get("handoff") !== "studio") return;
    try {
      const draft = localStorage.getItem(DRAFT_KEY) || "";
      const revised = document.getElementById("revisedText");
      if (draft && revised) {
        revised.value = draft;
        revised.dispatchEvent(new Event("input", { bubbles: true }));
        const status = document.getElementById("statusMessage");
        if (status) status.textContent = "Draft returned from Research & Evidence Studio. Review it before further editing or detector analysis.";
      }
    } catch {}
  }

  document.getElementById("openStudioLink")?.addEventListener("click", saveEditorContext);
  restoreStudioDraftIfRequested();
})();
