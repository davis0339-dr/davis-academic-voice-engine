(() => {
  "use strict";

  const STORAGE_KEY = "academicVoiceEngine.rewriteLineage.v1";
  const OBSERVATION_STORAGE_KEY = "academicVoice.detectorObservations.v1";
  const MAX_FEEDBACK_REFINEMENTS = 2;
  const upstreamFetch = window.fetch.bind(window);

  function normalise(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.root_source !== "string" || typeof parsed.last_revision !== "string") return null;
      return {
        root_source: parsed.root_source,
        last_revision: parsed.last_revision,
        request_source: typeof parsed.request_source === "string" ? parsed.request_source : parsed.root_source,
        candidate_id: typeof parsed.candidate_id === "string" ? parsed.candidate_id : null,
        generation: Math.max(1, Math.min(8, Number(parsed.generation) || 1)),
        versions: Array.isArray(parsed.versions) ? parsed.versions.slice(-4) : [],
      };
    } catch {
      return null;
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The editor must remain usable if storage is unavailable or full.
    }
  }

  function resolveLineage(text) {
    const state = readState();
    if (state && normalise(text) === normalise(state.last_revision)) {
      return {
        sourceGeneration: state.generation,
        rootSourceText: state.root_source,
        chainedFromPriorRevision: true,
      };
    }
    return {
      sourceGeneration: 0,
      rootSourceText: "",
      chainedFromPriorRevision: false,
    };
  }

  function saveSuccessfulRevision(source, revised, lineage, responseData) {
    if (!revised || normalise(source) === normalise(revised)) return;
    if (lineage?.chainedFromPriorRevision && lineage.rootSourceText) {
      const previous = readState();
      const nextGeneration = Math.min(8, Math.max(1, Number(lineage.sourceGeneration) + 1));
      const versions = [...(previous?.versions || []), {
        generation: nextGeneration,
        candidate_id: responseData?.candidate_history?.current_candidate_id || null,
        text: revised,
        word_count: typeof window.AcademicManuscriptWordCount === "function"
          ? window.AcademicManuscriptWordCount(revised)
          : String(revised).trim().split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length,
        recorded_at: new Date().toISOString(),
      }].slice(-4);
      writeState({
        root_source: lineage.rootSourceText,
        request_source: source,
        last_revision: revised,
        candidate_id: responseData?.candidate_history?.current_candidate_id || null,
        generation: nextGeneration,
        versions,
      });
      window.dispatchEvent(new CustomEvent("academicVoice:rewrite-lineage-updated"));
      return;
    }
    const candidateId = responseData?.candidate_history?.current_candidate_id || null;
    writeState({
      root_source: source,
      request_source: source,
      last_revision: revised,
      candidate_id: candidateId,
      generation: 1,
      versions: [{
        generation: 1,
        candidate_id: candidateId,
        text: revised,
        word_count: typeof window.AcademicManuscriptWordCount === "function"
          ? window.AcademicManuscriptWordCount(revised)
          : String(revised).trim().split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length,
        recorded_at: new Date().toISOString(),
      }],
    });
    window.dispatchEvent(new CustomEvent("academicVoice:rewrite-lineage-updated"));
  }

  function linkedObservationsFor(sourceText) {
    const state = readState();
    if (!state?.candidate_id) return [];
    if (normalise(sourceText) !== normalise(state.last_revision)) return [];
    try {
      const rows = JSON.parse(localStorage.getItem(OBSERVATION_STORAGE_KEY) || "[]");
      if (!Array.isArray(rows)) return [];
      return rows.filter((row) => row?.candidateId === state.candidate_id).slice(-8);
    } catch {
      return [];
    }
  }

  function annotateObservation(observation, candidateText) {
    const state = readState();
    if (!state?.candidate_id || normalise(candidateText) !== normalise(state.last_revision)) return { ...observation };
    return { ...observation, candidateId: state.candidate_id };
  }

  window.fetch = async function rewriteLineageFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    if (!/\/api\/rewrite(?:\?|$)/.test(url) || !init || String(init.method || "GET").toUpperCase() !== "POST") {
      return upstreamFetch(input, init);
    }

    let body;
    try {
      body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    if (!body || typeof body.text !== "string") return upstreamFetch(input, init);

    const lineage = resolveLineage(body.text);
    // Detector evidence is deliberately opt-in. Attach it only after the
    // researcher presses the explicit tested-candidate refinement control.
    const linkedObservations = body.refinementMode === "tested_candidate"
      ? linkedObservationsFor(body.text)
      : [];
    const nextInit = {
      ...init,
      body: JSON.stringify({
        ...body,
        rewriteLineage: lineage,
        ...(linkedObservations.length ? { detectorFeedback: { candidateId: linkedObservations[0].candidateId, observations: linkedObservations } } : {}),
      }),
    };

    const response = await upstreamFetch(input, nextInit);
    if (response.ok) {
      response.clone().json().then((data) => {
        if (typeof data?.revised_text === "string") {
          saveSuccessfulRevision(body.text, data.revised_text, lineage, data);
        }
      }).catch(() => {});
    }
    return response;
  };

  window.AcademicRewriteLineage = {
    clear() {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    },
    status() {
      const state = readState();
      return state ? { generation: state.generation, tracked: true } : { generation: 0, tracked: false };
    },
    annotateObservation,
    linkedObservationCount(sourceText) {
      return linkedObservationsFor(sourceText).length;
    },
    refinementPreflight(candidateText) {
      const state = readState();
      const exactCandidate = Boolean(state?.candidate_id && normalise(candidateText) === normalise(state.last_revision));
      const observations = exactCandidate ? linkedObservationsFor(state.last_revision) : [];
      const completedRefinements = state ? Math.max(0, state.generation - 1) : 0;
      return {
        ready: exactCandidate && observations.length > 0 && completedRefinements < MAX_FEEDBACK_REFINEMENTS,
        exact_candidate: exactCandidate,
        candidate_id: exactCandidate ? state.candidate_id : null,
        generation: state?.generation || 0,
        completed_refinements: completedRefinements,
        maximum_refinements: MAX_FEEDBACK_REFINEMENTS,
        remaining_refinements: Math.max(0, MAX_FEEDBACK_REFINEMENTS - completedRefinements),
        observation_count: observations.length,
        observations,
        root_source: state?.root_source || "",
        candidate_text: exactCandidate ? state.last_revision : "",
        versions: state?.versions || [],
      };
    },
    versionHistory() {
      return readState()?.versions || [];
    },
  };
})();
