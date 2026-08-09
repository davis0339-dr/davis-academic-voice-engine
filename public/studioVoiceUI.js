(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let voiceRecognition = null;
  let voiceFinalTranscript = "";

  function voiceStatus(message, isError = false) {
    const el = $("voiceReasoningStatus");
    if (!el) return;
    el.textContent = message;
    el.className = isError ? "file-status voice-error" : "file-status";
  }

  function stopVoiceReasoning() {
    try { voiceRecognition?.stop(); } catch {}
  }

  function startVoiceReasoning() {
    if (!$("voiceReasoningConsent")?.checked) {
      voiceStatus("Confirm the microphone/privacy notice before recording.", true);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      voiceStatus("Voice transcription is not supported by this browser. You can still type your reasoning normally.", true);
      return;
    }
    voiceFinalTranscript = $("voiceReasoningTranscript")?.value.trim() || "";
    const recognition = new SpeechRecognition();
    voiceRecognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en";
    recognition.onstart = () => {
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = true;
      if ($("stopVoiceReasoningBtn")) $("stopVoiceReasoningBtn").disabled = false;
      voiceStatus("Listening… speak naturally. You can edit the transcript before using it.");
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
    recognition.onerror = (event) => voiceStatus(`Voice capture stopped: ${event.error || "speech recognition error"}.`, true);
    recognition.onend = () => {
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = false;
      if ($("stopVoiceReasoningBtn")) $("stopVoiceReasoningBtn").disabled = true;
      voiceRecognition = null;
    };
    try { recognition.start(); } catch (err) { voiceStatus(`Could not start microphone capture: ${err.message}`, true); }
  }

  function addVoiceTranscriptToThoughts() {
    const transcript = $("voiceReasoningTranscript")?.value.trim() || "";
    const thoughts = $("researcherThoughts");
    if (!transcript || !thoughts) return voiceStatus("There is no transcript to add yet.", true);
    thoughts.value = `${thoughts.value.trim()}${thoughts.value.trim() ? "\n\n" : ""}${transcript}`;
    thoughts.dispatchEvent(new Event("input", { bubbles: true }));
    voiceStatus("Transcript added to your reasoning box. Edit it freely before building the argument map.");
  }

  function install() {
    const thoughts = $("researcherThoughts");
    if (!thoughts || $("voiceReasoningBox")) return;
    const box = document.createElement("div");
    box.id = "voiceReasoningBox";
    box.className = "voice-reasoning-box";
    box.innerHTML = `
      <div class="voice-reasoning-head"><strong>Voice Reasoning</strong><span>optional</span></div>
      <p class="muted">Explain the idea aloud before reconstruction. Davis does not store raw audio. Browser speech recognition may use your browser/vendor speech service; only continue if you accept that processing.</p>
      <label class="research-check"><input id="voiceReasoningConsent" type="checkbox" /> I understand and want to enable microphone transcription for this session.</label>
      <div class="action-row">
        <button id="startVoiceReasoningBtn" type="button" disabled>Start speaking</button>
        <button id="stopVoiceReasoningBtn" type="button" disabled>Stop</button>
        <button id="addVoiceTranscriptBtn" type="button">Add transcript to my reasoning</button>
        <button id="clearVoiceTranscriptBtn" type="button">Clear transcript</button>
      </div>
      <textarea id="voiceReasoningTranscript" rows="5" placeholder="Your editable voice transcript will appear here…"></textarea>
      <span id="voiceReasoningStatus" class="file-status">Microphone is off.</span>`;
    thoughts.insertAdjacentElement("afterend", box);
    $("voiceReasoningConsent")?.addEventListener("change", () => {
      const enabled = Boolean($("voiceReasoningConsent")?.checked);
      if ($("startVoiceReasoningBtn")) $("startVoiceReasoningBtn").disabled = !enabled;
      if (!enabled) stopVoiceReasoning();
    });
    $("startVoiceReasoningBtn")?.addEventListener("click", startVoiceReasoning);
    $("stopVoiceReasoningBtn")?.addEventListener("click", stopVoiceReasoning);
    $("addVoiceTranscriptBtn")?.addEventListener("click", addVoiceTranscriptToThoughts);
    $("clearVoiceTranscriptBtn")?.addEventListener("click", () => {
      stopVoiceReasoning();
      voiceFinalTranscript = "";
      if ($("voiceReasoningTranscript")) $("voiceReasoningTranscript").value = "";
      voiceStatus("Transcript cleared. Microphone is off.");
    });
  }

  const style = document.createElement("style");
  style.textContent = `.voice-reasoning-box{margin:.7rem 0;padding:1rem;border:1px solid #405269;border-radius:10px;background:rgba(22,31,44,.42)}.voice-reasoning-head{display:flex;justify-content:space-between;gap:1rem}.voice-reasoning-head span{opacity:.65}.voice-reasoning-box textarea{width:100%;box-sizing:border-box}.voice-error{color:#d66}`;
  document.head.appendChild(style);
  install();
})();
