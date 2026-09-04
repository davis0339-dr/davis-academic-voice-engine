(() => {
  "use strict";

  function manuscriptWordCount(text) {
    const value = String(text || "").trim();
    if (!value) return 0;
    return value.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  }

  // app.js is a classic script, so its top-level function binding can be replaced
  // here without duplicating the entire editor controller. updateWordCounts then
  // continues to drive limits/buttons using this corrected tokenisation.
  window.wordCount = manuscriptWordCount;
  window.AcademicManuscriptWordCount = manuscriptWordCount;

  function relabel() {
    const source = document.getElementById("sourceWordCount");
    const revised = document.getElementById("revisedWordCount");
    const longdoc = document.getElementById("longdocWordCount");
    for (const el of [source, revised, longdoc]) {
      if (!el) continue;
      el.title = "Approximate manuscript word count. Microsoft Word, GPTZero and other products may differ slightly because they use different tokenisation rules.";
      el.dataset.countMethod = "whitespace-lexical-v2";
    }
    const sourceHint = document.getElementById("sourceLimitHint");
    if (sourceHint && !sourceHint.dataset.countNoteAdded) {
      sourceHint.dataset.countNoteAdded = "true";
      sourceHint.textContent = `${sourceHint.textContent} Count is approximate; external tools may differ slightly.`;
    }
  }

  function refresh() {
    try {
      if (typeof window.updateWordCounts === "function") window.updateWordCounts();
    } catch {}
    relabel();
  }

  refresh();
  window.addEventListener("load", refresh, { once: true });

  // Programmatic revised-text assignment does not fire an input event, so refresh
  // after rewrite responses as well as ordinary source/long-document input.
  const upstreamFetch = window.fetch.bind(window);
  window.fetch = async function wordCountCompatibilityFetch(input, init) {
    const response = await upstreamFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (/\/api\/rewrite(?:\?|$)/.test(url) || /\/api\/analyse(?:\?|$)/.test(url)) {
      window.setTimeout(refresh, 80);
    }
    return response;
  };

  document.getElementById("sourceText")?.addEventListener("input", refresh);
  document.getElementById("longdocSource")?.addEventListener("input", refresh);
})();
