(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let voiceRecognition = null;
  let voiceFinalTranscript = "";
  let activeMode = "typed";

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
    if (activeMode === "voice") {
      const supported = Boolean(speechRecognitionCtor());
      voiceStatus(supported
        ? "Voice mode ready. Confirm the privacy notice, then start speaking."
        : "This browser does not expose speech recognition. Use Typed Reasoning or another supported browser for live transcription.", !supported);
    }
  }

  function startVoiceReasoning() {
    if (!window.isSecureContext && location.hostname !== "localhost") {
      voiceStatus("Microphone capture requires a secure HTTPS context.", true);
      return;
    }
    if (!$("voiceReasoningConsent")?.checked) {
      voiceStatus("Confirm the microphone/privacy notice before recording.", true);
      return;
    }
    const SpeechRecognition = speechRecognitionCtor();
    if (!SpeechRecognition) {
      voiceStatus("Voice transcription is not supported by this browser. Typed Reasoning remains fully available.", true);
      return;
    }
    voiceFinalTranscript = $("voiceReasoningTranscript")?.value.trim() || "";
    const recognition = new SpeechRecognition();
    voiceRecognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = $("voiceReasoningLanguage")?.value || navigator.language || "en-NG";
    recognition.onstart = () => {
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = true;
      if ($("stopVoiceReasoningBtn")) $("stopVoiceReasoningBtn").disabled = false;
      voiceStatus("Listening… speak naturally. The transcript remains editable before you use it.");
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
      const detail = code === "not-allowed" ? "Microphone permission was denied by the browser." : `Voice capture stopped: ${code}.`;
      voiceStatus(detail, true);
    };
    recognition.onend = () => {
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = !$("voiceReasoningConsent")?.checked || !speechRecognitionCtor();
      if ($("stopVoiceReasoningBtn")) $("stopVoiceReasoningBtn").disabled = true;
      voiceRecognition = null;
      if (!$("voiceReasoningStatus")?.classList.contains("voice-error")) voiceStatus("Voice capture stopped. Review the transcript, then build the argument map directly or append it to typed reasoning.");
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
    if (!transcript || !thoughts || !build) return voiceStatus("Record or type a voice transcript first.", true);
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
      <button id="reasoningModeTypedBtn" class="active" type="button">Typed Reasoning</button>
      <button id="reasoningModeVoiceBtn" type="button">Voice Reasoning</button>
      <span class="muted">Independent input modes · both feed the same researcher-approved argument map</span>`;
    thoughts.insertAdjacentElement("beforebegin", switcher);

    const box = document.createElement("div");
    box.id = "voiceReasoningBox";
    box.className = "voice-reasoning-box";
    box.hidden = true;
    box.innerHTML = `
      <div class="voice-reasoning-head"><strong>Voice Reasoning</strong><span>independent mode</span></div>
      <p class="muted">Explain the idea aloud before reconstruction. Davis does not store raw audio. Browser speech recognition may use your browser/vendor speech service; only continue if you accept that processing. The transcript is editable and can build the argument map without first being merged into Typed Reasoning.</p>
      <div class="voice-config-row">
        <label class="research-check"><input id="voiceReasoningConsent" type="checkbox" /> I understand and want to enable microphone transcription for this session.</label>
        <label>Recognition language
          <select id="voiceReasoningLanguage">
            <option value="en-NG">English (Nigeria)</option>
            <option value="en-GB">English (UK)</option>
            <option value="en-US">English (US)</option>
          </select>
        </label>
      </div>
      <div class="action-row">
        <button id="startVoiceReasoningBtn" type="button" disabled>Start speaking</button>
        <button id="stopVoiceReasoningBtn" type="button" disabled>Stop</button>
        <button id="buildFromVoiceBtn" class="primary" type="button">Build Argument Map from Voice</button>
        <button id="addVoiceTranscriptBtn" type="button">Append to Typed Reasoning</button>
        <button id="clearVoiceTranscriptBtn" type="button">Clear transcript</button>
      </div>
      <textarea id="voiceReasoningTranscript" rows="7" placeholder="Your editable voice transcript will appear here. You can also correct or add to it manually before building the argument map."></textarea>
      <span id="voiceReasoningStatus" class="file-status">Microphone is off.</span>`;
    thoughts.insertAdjacentElement("afterend", box);

    $("reasoningModeTypedBtn")?.addEventListener("click", () => setMode("typed"));
    $("reasoningModeVoiceBtn")?.addEventListener("click", () => setMode("voice"));
    $("voiceReasoningConsent")?.addEventListener("change", () => {
      const enabled = Boolean($("voiceReasoningConsent")?.checked);
      const supported = Boolean(speechRecognitionCtor());
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = !enabled || !supported;
      if (!enabled) stopVoiceReasoning();
      if (enabled && !supported) voiceStatus("Consent recorded, but this browser does not support live SpeechRecognition.", true);
      else if (enabled) voiceStatus("Microphone transcription enabled for this session. Press Start speaking when ready.");
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

    setMode("typed");
    return true;
  }

  const style = document.createElement("style");
  style.textContent = `
    .reasoning-mode-switcher{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.65rem 0}.reasoning-mode-switcher button.active{border-color:#62e0b0;background:rgba(98,224,176,.12)}.voice-reasoning-box{margin:.7rem 0;padding:1rem;border:1px solid #405269;border-radius:10px;background:rgba(22,31,44,.42)}.voice-reasoning-head{display:flex;justify-content:space-between;gap:1rem}.voice-reasoning-head span{opacity:.65}.voice-reasoning-box textarea{width:100%;box-sizing:border-box}.voice-config-row{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:.8rem;align-items:end}.voice-config-row select{width:100%}.voice-error{color:#d66}@media(max-width:760px){.voice-config-row{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 100) clearInterval(timer);
  }, 50);
})();
