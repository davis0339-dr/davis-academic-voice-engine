(() => {
  "use strict";

  const HANDOFF_KEY = "academicVoice.longdocEvidenceNeeds.v1";
  const downstreamFetch = window.fetch.bind(window);

  function handoff() {
    try {
      const value = JSON.parse(localStorage.getItem(HANDOFF_KEY) || "null");
      return value?.candidateText ? value : null;
    } catch { return null; }
  }

  function isJsonRequest(init) {
    return typeof init?.body === "string" && (!init?.headers || String(init.headers["content-type"] || init.headers["Content-Type"] || "application/json").includes("json"));
  }

  window.fetch = async function researchStudioCandidateFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url || "";
    const h = handoff();
    if (!h || !isJsonRequest(init)) return downstreamFetch(input, init);

    if (/\/api\/research\/reasoning-map(?:\?|$)/.test(url)) {
      try {
        const body = JSON.parse(init.body);
        body.manuscriptContext = h.candidateText;
        body.longDocumentContext = {
          jobId: h.jobId || null,
          documentGoal: h.documentGoal || null,
          evidenceNeeds: h.needs || [],
          instruction: "Recover the argument from the reworked candidate; use the original source only as a fidelity reference.",
        };
        return downstreamFetch(input, { ...init, body: JSON.stringify(body) });
      } catch { return downstreamFetch(input, init); }
    }

    if (/\/api\/research\/reconstruct(?:\?|$)/.test(url) && h.includeEvidence) {
      try {
        const body = JSON.parse(init.body);
        const candidate = document.getElementById("revisedText")?.value || h.candidateText;
        const source = document.getElementById("sourceText")?.value || h.sourceText || "";
        return downstreamFetch("/api/research/evidence-enhance-candidate", {
          ...init,
          body: JSON.stringify({
            ...body,
            baseDraft: candidate,
            sourceText: source,
            includeEvidence: true,
            evidenceDepth: h.evidenceDepth || "targeted",
          }),
        });
      } catch { return downstreamFetch(input, init); }
    }

    return downstreamFetch(input, init);
  };

  function explainMode() {
    const h = handoff();
    if (!h) return;
    const apply = () => {
      const checkbox = document.getElementById("includeEditorContext");
      const label = checkbox?.closest("label");
      if (label) {
        label.innerHTML = '<input id="includeEditorContext" type="checkbox" checked /> Use the <strong>reworked Long Document candidate</strong> as manuscript context';
      }
      const button = document.getElementById("reconstructResearchBtn");
      if (button) button.textContent = "Enhance Reworked Candidate with Approved Evidence";
      const constraints = document.getElementById("researchReconstructConstraints");
      if (constraints && !constraints.placeholder.includes("reworked candidate")) {
        constraints.placeholder = "Optional: specify what must remain unchanged in the reworked candidate, evidence limits, proposal tense, variable direction, etc.";
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(apply, 100), { once: true });
    else setTimeout(apply, 100);
  }

  explainMode();
})();
