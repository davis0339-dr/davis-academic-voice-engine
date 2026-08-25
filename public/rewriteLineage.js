(() => {
  "use strict";

  const STORAGE_KEY = "academicVoiceEngine.rewriteLineage.v1";
  const OBSERVATION_STORAGE_KEY = "academicVoice.detectorObservations.v1";
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
      writeState({
        root_source: lineage.rootSourceText,
        request_source: source,
        last_revision: revised,
        candidate_id: responseData?.candidate_history?.current_candidate_id || null,
        generation: Math.min(8, Math.max(1, Number(lineage.sourceGeneration) + 1)),
      });
      return;
    }
    writeState({
      root_source: source,
      request_source: source,
      last_revision: revised,
      candidate_id: responseData?.candidate_history?.current_candidate_id || null,
      generation: 1,
    });
  }

  function linkedObservationsFor(sourceText) {
    const state = readState();
    if (!state?.candidate_id) return [];
    if (![state.request_source, state.last_revision].some((text) => normalise(text) === normalise(sourceText))) return [];
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
    const linkedObservations = linkedObservationsFor(body.text);
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
  };
})();
