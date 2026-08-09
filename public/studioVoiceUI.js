(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let voiceRecognition = null;
  let voiceFinalTranscript = "";
  let activeMode = "typed";
  let consentState = "pending";
  let voiceLanguage = "en-NG";

  function speechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function voiceStatus(message, isError = false) {
    const el = $("voiceReasoningStatus");
    if (!el) return;
    el.textContent = message;
    el.className = isError ? "file-status voice-error" : "file-status";
  }

  function stopVoiceReasoning() {
    try { voiceRecognition?.stop(); } catch {}
  }

  function updateConsentUi() {
    const accepted = consentState === "accepted";
    const declined = consentState === "declined";
    $("acceptVoiceConsentBtn")?.classList.toggle("selected", accepted);
    $("declineVoiceConsentBtn")?.classList.toggle("selected-decline", declined);
    if ($("startVoiceReasoningBtn")) {
      $("startVoiceReasoningBtn").disabled = !accepted || !speechRecognitionCtor();
    }
    const badge = $("voiceConsentState");
    if (badge) {
      badge.textContent = accepted ? "Accepted for this session" : declined ? "Declined" : "Not decided";
      badge.className = `voice-consent-state ${accepted ? "accepted" : declined ? "declined" : "pending"}`;
    }
  }

  function updateLanguageUi() {
    document.querySelectorAll("[data-voice-language]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.voiceLanguage === voiceLanguage);
      button.setAttribute("aria-pressed", button.dataset.voiceLanguage === voiceLanguage ? "true" : "false");
    });
  }

  function setMode(mode) {
    activeMode = mode === "voice" ? "voice" : "typed";
    const thoughts = $("researcherThoughts");
    const voice = $("voiceReasoningBox");
    const typedButton = $("reasoningModeTypedBtn");
    const voiceButton = $("reasoningModeVoiceBtn");
    if (thoughts) thoughts.hidden = activeMode !== "typed";
    if (voice) voice.hidden = activeMode !== "voice";
    typedButton?.classList.toggle("active", activeMode === "typed");
    voiceButton?.classList.toggle("active", activeMode === "voice");
    typedButton?.setAttribute("aria-pressed", activeMode === "typed" ? "true" : "false");
    voiceButton?.setAttribute("aria-pressed", activeMode === "voice" ? "true" : "false");
    if (activeMode === "voice") {
      const supported = Boolean(speechRecognitionCtor());
      if (!supported) {
        voiceStatus("This browser does not expose speech recognition. You can still type or paste into the Voice transcript box, or use Typed Reasoning.", true);
      } else if (consentState === "accepted") {
        voiceStatus("Voice mode ready. Press Start speaking when you want the browser to request microphone access.");
      } else if (consentState === "declined") {
        voiceStatus("Microphone transcription is declined for this session. You can still type or paste a transcript manually.");
      } else {
        voiceStatus("Choose Accept or Decline below. The browser will not request microphone access until you accept and then press Start speaking.");
      }
    }
  }

  function acceptVoiceConsent() {
    consentState = "accepted";
    updateConsentUi();
    voiceStatus("Microphone transcription accepted for this session. No recording has started. Press Start speaking when ready.");
  }

  function declineVoiceConsent() {
    consentState = "declined";
    stopVoiceReasoning();
    updateConsentUi();
    voiceStatus("Microphone transcription declined. Voice capture is off; manual transcript entry remains available.");
  }

  function startVoiceReasoning() {
    if (!window.isSecureContext && location.hostname !== "localhost") {
      voiceStatus("Microphone capture requires a secure HTTPS context.", true);
      return;
    }
    if (consentState !== "accepted") {
      voiceStatus("Select Accept microphone transcription before starting voice capture.", true);
      return;
    }
    const SpeechRecognition = speechRecognitionCtor();
    if (!SpeechRecognition) {
      voiceStatus("Voice transcription is not supported by this browser. Typed/manual transcript entry remains available.", true);
      return;
    }
    voiceFinalTranscript = $("voiceReasoningTranscript")?.value.trim() || "";
    const recognition = new SpeechRecognition();
    voiceRecognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = voiceLanguage;
    recognition.onstart = () => {
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = true;
      if ($("stopVoiceReasoningBtn")) $("stopVoiceReasoningBtn").disabled = false;
      voiceStatus(`Listening in ${voiceLanguage}. Speak naturally; the transcript remains editable.`);
    };
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) voiceFinalTranscript = `${voiceFinalTranscript} ${text}`.trim();
        else interim += text;
      }
      const transcript = $("voiceReasoningTranscript");
      if (transcript) transcript.value = `${voiceFinalTranscript}${interim ? ` ${interim}` : ""}`.trim();
    };
    recognition.onerror = (event) => {
      const code = event.error || "speech recognition error";
      const detail = code === "not-allowed"
        ? "The browser denied microphone permission. Check the site microphone permission, then try again."
        : `Voice capture stopped: ${code}.`;
      voiceStatus(detail, true);
    };
    recognition.onend = () => {
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = consentState !== "accepted" || !speechRecognitionCtor();
      if ($("stopVoiceReasoningBtn")) $("stopVoiceReasoningBtn").disabled = true;
      voiceRecognition = null;
      if (!$("voiceReasoningStatus")?.classList.contains("voice-error")) {
        voiceStatus("Voice capture stopped. Review the transcript, then build the argument map or append it to Typed Reasoning.");
      }
    };
    try { recognition.start(); } catch (err) { voiceStatus(`Could not start microphone capture: ${err.message}`, true); }
  }

  function appendVoiceTranscriptToThoughts() {
    const transcript = $("voiceReasoningTranscript")?.value.trim() || "";
    const thoughts = $("researcherThoughts");
    if (!transcript || !thoughts) return voiceStatus("There is no transcript to add yet.", true);
    thoughts.value = `${thoughts.value.trim()}${thoughts.value.trim() ? "\n\n" : ""}${transcript}`;
    thoughts.dispatchEvent(new Event("input", { bubbles: true }));
    voiceStatus("Transcript appended to Typed Reasoning. You can switch modes and edit it before building the argument map.");
  }

  function buildFromVoice() {
    const transcript = $("voiceReasoningTranscript")?.value.trim() || "";
    const thoughts = $("researcherThoughts");
    const build = $("buildArgumentMapBtn");
    if (!transcript || !thoughts || !build) return voiceStatus("Record, type or paste a voice transcript first.", true);
    thoughts.value = transcript;
    thoughts.dispatchEvent(new Event("input", { bubbles: true }));
    voiceStatus("Voice transcript loaded as the active reasoning source. Building the argument map…");
    build.click();
  }

  function install() {
    const thoughts = $("researcherThoughts");
    if (!thoughts || $("voiceReasoningBox")) return false;

    const switcher = document.createElement("div");
    switcher.id = "reasoningModeSwitcher";
    switcher.className = "reasoning-mode-switcher";
    switcher.innerHTML = `
      <button id="reasoningModeTypedBtn" class="active" type="button" aria-pressed="true">Typed Reasoning</button>
      <button id="reasoningModeVoiceBtn" type="button" aria-pressed="false">Voice Reasoning</button>
      <span class="muted">Independent input modes · both feed the same researcher-approved argument map</span>`;
    thoughts.insertAdjacentElement("beforebegin", switcher);

    const box = document.createElement("div");
    box.id = "voiceReasoningBox";
    box.className = "voice-reasoning-box";
    box.hidden = true;
    box.innerHTML = `
      <div class="voice-reasoning-head"><strong>Voice Reasoning</strong><span>independent mode</span></div>
      <p class="muted">Explain the idea aloud before reconstruction. Davis does not store raw audio. Browser speech recognition may use your browser/vendor speech service. Nothing starts until you explicitly accept below and press Start speaking.</p>

      <div class="voice-consent-panel" role="group" aria-label="Microphone transcription consent">
        <div class="voice-consent-copy">
          <strong>Microphone transcription permission</strong>
          <span>Choose one. You can change this decision during the current session.</span>
        </div>
        <div class="voice-consent-actions">
          <button id="acceptVoiceConsentBtn" type="button">Accept microphone transcription</button>
          <button id="declineVoiceConsentBtn" type="button">Decline</button>
          <span id="voiceConsentState" class="voice-consent-state pending">Not decided</span>
        </div>
      </div>

      <div class="voice-language-panel">
        <strong>Recognition language</strong>
        <div class="voice-language-actions" role="group" aria-label="Recognition language">
          <button type="button" data-voice-language="en-NG" class="selected" aria-pressed="true">English (Nigeria)</button>
          <button type="button" data-voice-language="en-GB" aria-pressed="false">English (UK)</button>
          <button type="button" data-voice-language="en-US" aria-pressed="false">English (US)</button>
        </div>
      </div>

      <div class="action-row voice-action-row">
        <button id="startVoiceReasoningBtn" type="button" disabled>Start speaking</button>
        <button id="stopVoiceReasoningBtn" type="button" disabled>Stop</button>
        <button id="buildFromVoiceBtn" class="primary" type="button">Build Argument Map from Voice</button>
        <button id="addVoiceTranscriptBtn" type="button">Append to Typed Reasoning</button>
        <button id="clearVoiceTranscriptBtn" type="button">Clear transcript</button>
      </div>
      <textarea id="voiceReasoningTranscript" rows="7" placeholder="Your editable voice transcript will appear here. You can also type or paste into this box without enabling the microphone."></textarea>
      <span id="voiceReasoningStatus" class="file-status">Microphone is off. Consent has not been decided.</span>`;
    thoughts.insertAdjacentElement("afterend", box);

    $("reasoningModeTypedBtn")?.addEventListener("click", () => setMode("typed"));
    $("reasoningModeVoiceBtn")?.addEventListener("click", () => setMode("voice"));
    $("acceptVoiceConsentBtn")?.addEventListener("click", acceptVoiceConsent);
    $("declineVoiceConsentBtn")?.addEventListener("click", declineVoiceConsent);
    document.querySelectorAll("[data-voice-language]").forEach((button) => {
      button.addEventListener("click", () => {
        voiceLanguage = button.dataset.voiceLanguage || "en-NG";
        updateLanguageUi();
        voiceStatus(`Recognition language set to ${button.textContent.trim()}.`);
      });
    });
    $("startVoiceReasoningBtn")?.addEventListener("click", startVoiceReasoning);
    $("stopVoiceReasoningBtn")?.addEventListener("click", stopVoiceReasoning);
    $("buildFromVoiceBtn")?.addEventListener("click", buildFromVoice);
    $("addVoiceTranscriptBtn")?.addEventListener("click", appendVoiceTranscriptToThoughts);
    $("clearVoiceTranscriptBtn")?.addEventListener("click", () => {
      stopVoiceReasoning();
      voiceFinalTranscript = "";
      if ($("voiceReasoningTranscript")) $("voiceReasoningTranscript").value = "";
      voiceStatus("Transcript cleared. Microphone is off.");
    });

    updateConsentUi();
    updateLanguageUi();
    setMode("typed");
    return true;
  }

  const style = document.createElement("style");
  style.textContent = `
    .reasoning-mode-switcher{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.65rem 0}.reasoning-mode-switcher button{background:#171b21;color:#e6e9ee;border:1px solid #405269}.reasoning-mode-switcher button.active{border-color:#62e0b0;background:#17352d;color:#f4fff9}.voice-reasoning-box{margin:.7rem 0;padding:1rem;border:1px solid #405269;border-radius:10px;background:#9aa0a6;color:#fff}.voice-reasoning-head{display:flex;justify-content:space-between;gap:1rem}.voice-reasoning-head span{opacity:.8}.voice-reasoning-box .muted{color:#e4e8ee}.voice-reasoning-box textarea{width:100%;box-sizing:border-box;background:#fff;color:#111;border:1px solid #59636f;border-radius:4px}.voice-consent-panel,.voice-language-panel{margin:.8rem 0;padding:.8rem;border:1px solid #697582;border-radius:8px;background:rgba(20,27,35,.18)}.voice-consent-copy{display:flex;flex-direction:column;gap:.2rem}.voice-consent-copy span{font-size:.86em;color:#eef1f5}.voice-consent-actions,.voice-language-actions{display:flex;gap:.55rem;flex-wrap:wrap;margin-top:.65rem}.voice-consent-actions button,.voice-language-actions button,.voice-action-row button{background:#171b21;color:#fff;border:1px solid #2a3440}.voice-consent-actions button.selected,.voice-language-actions button.selected{background:#146c52;border-color:#62e0b0}.voice-consent-actions button.selected-decline{background:#6c2f32;border-color:#f09a9a}.voice-consent-state{display:inline-flex;align-items:center;padding:.35rem .6rem;border-radius:999px;background:#303740;color:#fff;font-size:.82em}.voice-consent-state.accepted{background:#146c52}.voice-consent-state.declined{background:#6c2f32}.voice-error{color:#8b0000!important;font-weight:600}@media(max-width:760px){.voice-consent-actions,.voice-language-actions{display:grid;grid-template-columns:1fr}.voice-action-row{display:grid;grid-template-columns:1fr}.voice-action-row button{width:100%}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 100) clearInterval(timer);
  }, 50);
})();
