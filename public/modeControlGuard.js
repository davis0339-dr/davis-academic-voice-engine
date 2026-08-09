(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function ensureStatus() {
    let el = $("modeCompatibilityStatus");
    if (el) return el;
    const naturalisation = $("naturalisation");
    if (!naturalisation) return null;
    el = document.createElement("div");
    el.id = "modeCompatibilityStatus";
    el.className = "limit-hint mode-compatibility-status";
    naturalisation.closest("label")?.insertAdjacentElement("afterend", el);
    return el;
  }

  function setStatus(message, kind = "info") {
    const el = ensureStatus();
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind;
  }

  function syncFromNaturalisation() {
    const intensity = $("rewriteIntensity");
    const naturalisation = $("naturalisation");
    if (!intensity || !naturalisation) return;

    if (naturalisation.value === "authorial" && intensity.value !== "deep") {
      intensity.value = "deep";
      intensity.dispatchEvent(new Event("change", { bubbles: true }));
      setStatus("Deep Authorial Reconstruction requires Deep / Structural intensity. Rewrite intensity was switched to Deep so the selected mode is actually executed.", "changed");
      return;
    }

    if (naturalisation.value === "authorial") {
      setStatus("Deep Authorial Reconstruction is active: preserve research meaning, evidence and formal artefacts while allowing broad sentence/paragraph redevelopment where warranted.", "active");
    } else if (intensity.value === "deep") {
      setStatus("Deep / Structural authority is active. Naturalisation controls expression; it does not by itself create or remove structural authority.", "info");
    } else {
      setStatus("Rewrite intensity sets the intervention ceiling. Minor and Moderate cannot silently execute Deep Authorial Reconstruction.", "info");
    }
  }

  function syncFromIntensity() {
    const intensity = $("rewriteIntensity");
    const naturalisation = $("naturalisation");
    if (!intensity || !naturalisation) return;

    if (naturalisation.value === "authorial" && intensity.value !== "deep") {
      naturalisation.value = "faithful";
      naturalisation.dispatchEvent(new Event("change", { bubbles: true }));
      setStatus(`${intensity.options[intensity.selectedIndex]?.text || intensity.value} is an explicit intervention ceiling. Deep Authorial was turned off rather than being silently downgraded to Faithful behind the scenes.`, "changed");
      return;
    }
    syncFromNaturalisation();
  }

  function bind() {
    const intensity = $("rewriteIntensity");
    const naturalisation = $("naturalisation");
    if (!intensity || !naturalisation) return;

    const authorialOption = [...naturalisation.options].find((option) => option.value === "authorial");
    if (authorialOption) authorialOption.textContent = "Deep Authorial Reconstruction — requires Deep";

    naturalisation.addEventListener("change", syncFromNaturalisation);
    intensity.addEventListener("change", syncFromIntensity);
    syncFromNaturalisation();
  }

  const style = document.createElement("style");
  style.textContent = `
    .mode-compatibility-status{margin-top:-.2rem;padding:.5rem .65rem;border-left:3px solid #53677f;background:rgba(17,27,40,.35)}
    .mode-compatibility-status[data-kind="changed"]{border-left-color:#e3ad4b;color:#e8cf9b}
    .mode-compatibility-status[data-kind="active"]{border-left-color:#62e0b0;color:#aee9d2}
  `;
  document.head.appendChild(style);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();