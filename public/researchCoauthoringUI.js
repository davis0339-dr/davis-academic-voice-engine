(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MANUSCRIPT_CAP = 30000;
  const state = {
    questions: [],
    assessments: [],
    manuscriptFileName: "",
    activeQuestionVoice: null,
  };

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function styleFilters() {
    const mapping = {
      documentType: "document_type",
      region: "region",
      degree: "degree",
      discipline: "discipline",
      researchMode: "research_mode",
      section: "section",
    };
    const out = {};
    for (const [id, key] of Object.entries(mapping)) {
      const value = $(id)?.value;
      if (value) out[key] = value;
    }
    return out;
  }

  function status(message, error = false) {
    const el = $("coauthoringStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `file-status ${error ? "error" : ""}`.trim();
  }

  function questionVoiceStatus(questionId, message, error = false) {
    const el = document.querySelector(`[data-question-voice-status="${CSS.escape(questionId || "")}"]`);
    if (!el) return;
    el.textContent = message;
    el.className = `question-voice-status ${error ? "error" : ""}`.trim();
  }

  function speechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function currentVoiceLanguage() {
    return document.querySelector("[data-voice-language].selected")?.dataset.voiceLanguage || "en-NG";
  }

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
    return data;
  }

  function manuscriptText() {
    return $("coauthorManuscriptText")?.value.trim() || "";
  }

  function setManuscript(text, label = "") {
    const box = $("coauthorManuscriptText");
    if (!box) return;
    box.value = String(text || "").slice(0, MANUSCRIPT_CAP);
    state.manuscriptFileName = label;
    if (label) status(`${label} loaded as the manuscript-first coauthoring context.`);
  }

  async function importManuscript(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    status(`Reading ${file.name}…`);
    try {
      if (!window.AcademicFileImport?.readAcademicFile) throw new Error("Academic file reader is not ready.");
      const result = await window.AcademicFileImport.readAcademicFile(file, 5 * 1024 * 1024);
      const text = String(result.text || "").trim();
      if (!text) throw new Error("No readable text found. Scanned/image-only PDFs are not supported in this browser workflow.");
      setManuscript(text, file.name);
      if (text.length > MANUSCRIPT_CAP) status(`${file.name} loaded. The coauthoring interview uses the first ${MANUSCRIPT_CAP.toLocaleString()} characters in this build; the source file itself was not changed.`);
    } catch (err) {
      status(`${file.name}: ${err.message}`, true);
    }
  }

  function stopQuestionVoice(questionId = "") {
    const active = state.activeQuestionVoice;
    if (!active) return;
    if (questionId && active.questionId !== questionId) return;
    try { active.recognition.stop(); } catch {}
  }

  function openQuestionVoicePanel(questionId) {
    const panel = document.querySelector(`[data-question-voice-panel="${CSS.escape(questionId || "")}"]`);
    const button = document.querySelector(`[data-toggle-question-voice="${CSS.escape(questionId || "")}"]`);
    if (!panel || !button) return;
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    button.classList.toggle("active", willOpen);
    if (willOpen) {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const supported = Boolean(speechRecognitionCtor());
      questionVoiceStatus(
        questionId,
        supported
          ? "Voice panel ready. Press Start microphone only when you are ready to speak; the transcript will appear directly in this answer box."
          : "This browser does not expose speech recognition. You can still type the answer or use an existing Studio voice transcript.",
        !supported,
      );
    }
  }

  function startQuestionVoice(questionId) {
    if (!window.isSecureContext && location.hostname !== "localhost") {
      questionVoiceStatus(questionId, "Microphone capture requires HTTPS. The browser has not started voice capture.", true);
      return;
    }
    const SpeechRecognition = speechRecognitionCtor();
    if (!SpeechRecognition) {
      questionVoiceStatus(questionId, "Speech recognition is not available in this browser. Type the answer or use an existing Studio transcript instead.", true);
      return;
    }

    const answer = document.querySelector(`[data-coauthor-answer="${CSS.escape(questionId || "")}"]`);
    if (!answer) return;

    if (state.activeQuestionVoice) stopQuestionVoice();

    let finalTranscript = answer.value.trim();
    const recognition = new SpeechRecognition();
    const language = currentVoiceLanguage();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    state.activeQuestionVoice = { recognition, questionId };

    recognition.onstart = () => {
      const start = document.querySelector(`[data-start-question-voice="${CSS.escape(questionId)}"]`);
      const stop = document.querySelector(`[data-stop-question-voice="${CSS.escape(questionId)}"]`);
      if (start) start.disabled = true;
      if (stop) stop.disabled = false;
      answer.dataset.inputMode = answer.value.trim() ? "mixed" : "voice";
      questionVoiceStatus(questionId, `Listening in ${language}. Speak naturally; the live transcript is being written into this answer box.`);
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalTranscript = `${finalTranscript} ${text}`.trim();
        else interim += text;
      }
      answer.value = `${finalTranscript}${interim ? ` ${interim}` : ""}`.trim();
      answer.dataset.inputMode = finalTranscript ? "voice" : answer.dataset.inputMode || "voice";
      answer.dispatchEvent(new Event("input", { bubbles: true }));
    };

    recognition.onerror = (event) => {
      const code = event.error || "speech recognition error";
      const message = code === "not-allowed"
        ? "The browser denied microphone permission. Allow microphone access for this site, then press Start microphone again."
        : `Voice capture stopped: ${code}.`;
      questionVoiceStatus(questionId, message, true);
    };

    recognition.onend = () => {
      const start = document.querySelector(`[data-start-question-voice="${CSS.escape(questionId)}"]`);
      const stop = document.querySelector(`[data-stop-question-voice="${CSS.escape(questionId)}"]`);
      if (start) start.disabled = false;
      if (stop) stop.disabled = true;
      if (state.activeQuestionVoice?.questionId === questionId) state.activeQuestionVoice = null;
      const current = document.querySelector(`[data-question-voice-status="${CSS.escape(questionId)}"]`);
      if (!current?.classList.contains("error")) questionVoiceStatus(questionId, "Voice capture stopped. Review or edit the transcript in the answer box before assessment.");
    };

    try {
      recognition.start();
    } catch (err) {
      state.activeQuestionVoice = null;
      questionVoiceStatus(questionId, `Could not start microphone capture: ${err.message}`, true);
    }
  }

  function useStudioVoiceTranscript(questionId) {
    const transcript = $("voiceReasoningTranscript")?.value.trim() || "";
    const answer = document.querySelector(`[data-coauthor-answer="${CSS.escape(questionId || "")}"]`);
    if (!answer) return;
    if (!transcript) {
      questionVoiceStatus(questionId, "There is no Studio Voice transcript to copy yet. Use Start microphone here, type directly, or record in Voice Reasoning first.", true);
      return;
    }
    answer.value = transcript;
    answer.dataset.inputMode = "voice";
    answer.dispatchEvent(new Event("input", { bubbles: true }));
    questionVoiceStatus(questionId, "Existing Studio Voice transcript copied into this answer. You can edit it before assessment.");
  }

  function clearQuestionAnswer(questionId) {
    stopQuestionVoice(questionId);
    const answer = document.querySelector(`[data-coauthor-answer="${CSS.escape(questionId || "")}"]`);
    if (!answer) return;
    answer.value = "";
    answer.dataset.inputMode = "typed";
    answer.dispatchEvent(new Event("input", { bubbles: true }));
    questionVoiceStatus(questionId, "Answer cleared. Type a new response or start voice capture.");
  }

  function renderQuestions() {
    const target = $("coauthorQuestionList");
    if (!target) return;
    stopQuestionVoice();
    if (!state.questions.length) {
      target.innerHTML = '<p class="muted">Load a manuscript and ask Davis to identify the highest-value questions for your own reasoning.</p>';
      return;
    }

    target.innerHTML = state.questions.map((q, index) => `
      <article class="coauthor-question-card" data-question-card="${esc(q.id)}">
        <div class="coauthor-question-head">
          <strong>Question ${index + 1}</strong>
          <span class="coauthor-sensitivity ${esc(q.verification_sensitivity || "conditional")}">${esc((q.verification_sensitivity || "conditional").replace(/_/g, " "))} verification sensitivity</span>
        </div>
        ${q.anchor ? `<p class="coauthor-anchor"><strong>Prompted by:</strong> “${esc(q.anchor)}”</p>` : ""}
        <p class="coauthor-question-text">${esc(q.question)}</p>
        ${q.why_it_matters ? `<p class="muted">Why this matters: ${esc(q.why_it_matters)}</p>` : ""}
        <label>Your explanation
          <textarea data-coauthor-answer="${esc(q.id)}" rows="4" placeholder="Answer in your own words and understanding. Rough language is useful. You do not need to sound academic here."></textarea>
        </label>
        <div class="question-input-actions">
          <button class="question-voice-launch" type="button" data-toggle-question-voice="${esc(q.id)}" aria-expanded="false">🎙 Answer this question by voice</button>
          <button type="button" data-clear-question-answer="${esc(q.id)}">Clear answer</button>
        </div>
        <div class="question-voice-panel" data-question-voice-panel="${esc(q.id)}" hidden>
          <div class="question-voice-explainer"><strong>Voice answer for Question ${index + 1}</strong><span>Your browser may use its speech-recognition service. Davis does not store raw audio. Nothing starts until you press Start microphone.</span></div>
          <div class="question-voice-actions">
            <button class="primary" type="button" data-start-question-voice="${esc(q.id)}">Start microphone</button>
            <button type="button" data-stop-question-voice="${esc(q.id)}" disabled>Stop</button>
            <button type="button" data-use-studio-voice="${esc(q.id)}">Use existing Studio voice transcript</button>
          </div>
          <span class="question-voice-status" data-question-voice-status="${esc(q.id)}">Voice panel ready.</span>
        </div>
        <div data-response-assessment="${esc(q.id)}"></div>
      </article>
    `).join("");

    target.querySelectorAll("[data-coauthor-answer]").forEach((box) => {
      box.dataset.inputMode = "typed";
      box.addEventListener("input", () => {
        if (box.dataset.inputMode === "voice") box.dataset.inputMode = "mixed";
      });
    });

    target.querySelectorAll("[data-toggle-question-voice]").forEach((button) => {
      button.addEventListener("click", () => openQuestionVoicePanel(button.dataset.toggleQuestionVoice || ""));
    });
    target.querySelectorAll("[data-start-question-voice]").forEach((button) => {
      button.addEventListener("click", () => startQuestionVoice(button.dataset.startQuestionVoice || ""));
    });
    target.querySelectorAll("[data-stop-question-voice]").forEach((button) => {
      button.addEventListener("click", () => stopQuestionVoice(button.dataset.stopQuestionVoice || ""));
    });
    target.querySelectorAll("[data-use-studio-voice]").forEach((button) => {
      button.addEventListener("click", () => useStudioVoiceTranscript(button.dataset.useStudioVoice || ""));
    });
    target.querySelectorAll("[data-clear-question-answer]").forEach((button) => {
      button.addEventListener("click", () => clearQuestionAnswer(button.dataset.clearQuestionAnswer || ""));
    });
  }

  async function generateQuestions() {
    const manuscript = manuscriptText();
    if (!manuscript) return status("Paste or upload the working manuscript/passage first.", true);
    status("Reading the manuscript for places where your own intellectual explanation is most valuable…");
    try {
      const data = await postJson("/api/research/manuscript-questions", {
        manuscriptText: manuscript,
        styleFilters: styleFilters(),
      });
      state.questions = data.questions || [];
      state.assessments = [];
      renderQuestions();
      renderAssessmentSummary();
      status(state.questions.length
        ? `${state.questions.length} manuscript-led question(s) ready. Each question now supports direct typed or microphone input with local feedback.`
        : "No high-value coauthoring question was generated from this passage. You can still explain what you think in the Reasoning Studio below.");
    } catch (err) {
      status(`Could not generate manuscript questions: ${err.message}`, true);
    }
  }

  function collectResponses() {
    return state.questions.map((q) => {
      const box = document.querySelector(`[data-coauthor-answer="${CSS.escape(q.id)}"]`);
      return {
        question_id: q.id,
        question: q.question,
        answer: box?.value.trim() || "",
        input_mode: box?.dataset.inputMode || "typed",
      };
    }).filter((item) => item.answer);
  }

  function renderAssessmentSummary() {
    const summary = $("coauthorAssessmentSummary");
    if (!summary) return;
    if (!state.assessments.length) {
      summary.innerHTML = "";
      return;
    }
    const verifyCount = state.assessments.filter((row) => ["verify_before_factual_use", "evidence_workspace_check"].includes(row.verification_status)).length;
    summary.innerHTML = `<div class="coauthor-assessment-summary"><strong>${state.assessments.length} response(s) assessed.</strong> ${verifyCount ? `${verifyCount} contain material that should be verified before it is presented as an external fact.` : "No response was classified as requiring factual verification before use."}</div>`;
  }

  function renderAssessments(overallNote = "") {
    for (const row of state.assessments) {
      const target = document.querySelector(`[data-response-assessment="${CSS.escape(row.question_id)}"]`);
      if (!target) continue;
      const needsVerification = row.verification_status === "verify_before_factual_use" || row.verification_status === "evidence_workspace_check";
      target.innerHTML = `
        <div class="response-assessment ${needsVerification ? "needs-verification" : "reasoning-usable"}">
          <div><strong>${esc(row.manuscript_alignment.replace(/_/g, " "))}</strong> · ${esc(row.role.replace(/_/g, " "))}</div>
          <p><strong>What can be used as your reasoning:</strong> ${esc(row.usable_reasoning || "No clear reasoning contribution was identified.")}</p>
          ${needsVerification
            ? `<p><strong>Verification needed:</strong> ${esc(row.verification_note || "Check this factual component against a reliable source before presenting it as established fact.")}</p>`
            : `<p><strong>Verification:</strong> This can be used to represent your intended interpretation, judgment, boundary or reasoning. It does not automatically prove any external fact.</p>`}
          ${row.caution ? `<p class="muted">Caution: ${esc(row.caution)}</p>` : ""}
        </div>`;
    }
    const overall = $("coauthorOverallAssessment");
    if (overall) overall.textContent = overallNote || "";
    renderAssessmentSummary();
  }

  function stripPriorCoauthoringLog(text) {
    const start = "[[COAUTHORING-RESPONSES-START]]";
    const end = "[[COAUTHORING-RESPONSES-END]]";
    const raw = String(text || "");
    const a = raw.indexOf(start);
    const b = raw.indexOf(end);
    if (a < 0 || b < a) return raw.trim();
    return `${raw.slice(0, a)}${raw.slice(b + end.length)}`.trim();
  }

  function writeResponsesIntoResearcherReasoning(responses) {
    const thoughts = $("researcherThoughts");
    if (!thoughts) return false;
    const base = stripPriorCoauthoringLog(thoughts.value);
    const rawLog = responses.map((item, index) => `Question ${index + 1}: ${item.question}\nResearcher's answer (${item.input_mode}): ${item.answer}`).join("\n\n");
    const block = `[[COAUTHORING-RESPONSES-START]]\n${rawLog}\n[[COAUTHORING-RESPONSES-END]]`;
    thoughts.value = `${base}${base ? "\n\n" : ""}${block}`;
    thoughts.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  async function assessAndBuild() {
    const manuscript = manuscriptText();
    const responses = collectResponses();
    if (!manuscript) return status("The working manuscript is required before response assessment.", true);
    if (!responses.length) return status("Answer at least one coauthoring question first. Typing and voice are both allowed.", true);

    status("Comparing your explanations with the manuscript and separating authorial reasoning from claims that need verification…");
    try {
      const data = await postJson("/api/research/response-assess", {
        manuscriptText: manuscript,
        responses,
        styleFilters: styleFilters(),
      });
      state.assessments = data.assessments || [];
      renderAssessments(data.overall_note || "");

      writeResponsesIntoResearcherReasoning(responses);
      if ($("sourceText")) $("sourceText").value = manuscript;
      if ($("includeEditorContext")) $("includeEditorContext").checked = true;

      const build = $("buildArgumentMapBtn");
      if (build) {
        status("Assessment complete. Your raw answers—not Davis's interpretation of them—are now feeding the argument map. Building the map…");
        build.click();
      } else {
        status("Assessment complete. Your raw answers were preserved, but the argument-map control is not ready yet.", true);
      }
    } catch (err) {
      status(`Could not assess the researcher responses: ${err.message}`, true);
    }
  }

  function installOwnWordsGuidance() {
    const thoughts = $("researcherThoughts");
    if (!thoughts || $("ownWordsResearchGuidance")) return;
    const note = document.createElement("div");
    note.id = "ownWordsResearchGuidance";
    note.className = "own-words-guidance";
    note.innerHTML = `<strong>Use your own understanding here.</strong> Voice is useful because spontaneous explanation often exposes what you actually mean, but it is not compulsory. Typing is equally allowed. Avoid pasting a generated answer if you can: the coauthoring value comes from your reasoning, uncertainty, judgment and explanation, even when the wording is rough.`;
    thoughts.insertAdjacentElement("beforebegin", note);
  }

  function install() {
    const panel = $("tab-researchstudio");
    const intro = panel?.querySelector(".research-studio-intro");
    const grid = panel?.querySelector(".research-studio-grid");
    if (!panel || !intro || !grid || $("manuscriptFirstCoauthoring")) return false;

    const section = document.createElement("section");
    section.id = "manuscriptFirstCoauthoring";
    section.className = "research-studio-card manuscript-first-coauthoring";
    section.innerHTML = `
      <div class="coauthor-flow-head">
        <div>
          <h4>Researcher-led coauthoring — manuscript first</h4>
          <p>This path works backward from the manuscript to the researcher's thinking: load the text, let Davis identify where intellectual judgment is thin or unclear, then answer the questions in your own words. Davis uses those answers to develop the argument and flags factual parts that still need verification.</p>
        </div>
        <span class="coauthor-flow-badge">Manuscript → questions → researcher reasoning → evidence → prose</span>
      </div>
      <div class="coauthor-framework-note"><strong>The existing post-editor framework remains separate and intact.</strong> You can still send a revised Editor/Long Document output into this Studio for explanation, evidence alignment and judgment. This manuscript-first path does not replace that forward workflow.</div>

      <label><strong>Working manuscript or passage</strong>
        <textarea id="coauthorManuscriptText" rows="8" placeholder="Paste the manuscript/passage here, or upload a TXT, DOCX or text-based PDF. This can start independently of the Editor."></textarea>
      </label>
      <div class="action-row coauthor-manuscript-actions">
        <label class="file-button" for="coauthorManuscriptFile">Upload working manuscript</label>
        <input id="coauthorManuscriptFile" class="visually-hidden" type="file" accept=".txt,.md,.markdown,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
        <button id="useSourceAsCoauthorManuscriptBtn" type="button">Use current Source text</button>
        <button id="useRevisedAsCoauthorManuscriptBtn" type="button">Use current Revised text</button>
        <button id="generateCoauthorQuestionsBtn" class="primary" type="button">Ask me the important questions</button>
      </div>
      <p class="muted">The Source/Revised shortcuts are optional conveniences. A new coauthoring session can begin here from an uploaded or pasted manuscript without coming through the Editor.</p>
      <span id="coauthoringStatus" class="file-status">Ready for a working manuscript.</span>

      <div id="coauthorQuestionList" class="coauthor-question-list"><p class="muted">Load a manuscript and ask Davis to identify the highest-value questions for your own reasoning.</p></div>
      <div class="coauthor-own-words-callout"><strong>Answer from your understanding, not for polish.</strong> If your answer is an interpretation, mechanism, boundary or judgment, Davis can use it as part of your intellectual position. If you state an external fact, Davis will preserve the idea but mark the factual part for verification before it is presented as established evidence.</div>
      <div class="action-row">
        <button id="assessCoauthorResponsesBtn" class="primary" type="button">Assess my responses &amp; build/update argument map</button>
      </div>
      <div id="coauthorAssessmentSummary"></div>
      <p id="coauthorOverallAssessment" class="muted"></p>
    `;
    grid.insertAdjacentElement("beforebegin", section);

    $("coauthorManuscriptFile")?.addEventListener("change", importManuscript);
    $("useSourceAsCoauthorManuscriptBtn")?.addEventListener("click", () => {
      const source = $("sourceText")?.value || "";
      if (!source.trim()) return status("The current Source text is empty. Paste/upload a manuscript here instead.", true);
      setManuscript(source, "Current Source text");
    });
    $("useRevisedAsCoauthorManuscriptBtn")?.addEventListener("click", () => {
      const revised = $("revisedText")?.value || "";
      if (!revised.trim()) return status("The current Revised text is empty. Paste/upload a manuscript here instead.", true);
      setManuscript(revised, "Current Revised text");
    });
    $("generateCoauthorQuestionsBtn")?.addEventListener("click", generateQuestions);
    $("assessCoauthorResponsesBtn")?.addEventListener("click", assessAndBuild);

    installOwnWordsGuidance();
    return true;
  }

  const style = document.createElement("style");
  style.textContent = `
    .manuscript-first-coauthoring{border-color:#3f5872!important}
    .coauthor-flow-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap}
    .coauthor-flow-head h4{margin:.1rem 0}
    .coauthor-flow-badge{display:inline-flex;padding:.3rem .55rem;border:1px solid #557aa0;border-radius:999px;font-size:.78rem;background:rgba(85,122,160,.10);color:#c9d8e8}
    .coauthor-framework-note,.coauthor-own-words-callout,.own-words-guidance{margin:.75rem 0;padding:.8rem;border-left:4px solid #557aa0;background:rgba(85,122,160,.10);color:var(--text)}
    .coauthor-manuscript-actions{margin:.65rem 0}
    .coauthor-question-list{display:grid;gap:.9rem;margin:1rem 0}
    .coauthor-question-card{padding:1rem;border:1px solid #344354;border-radius:12px;background:#151b22;box-shadow:0 8px 24px rgba(0,0,0,.12)}
    .coauthor-question-head{display:flex;justify-content:space-between;gap:.6rem;align-items:center;flex-wrap:wrap}
    .coauthor-sensitivity{font-size:.76rem;padding:.2rem .48rem;border:1px solid #62758a;border-radius:999px;background:#111820;color:#b9c8d8}
    .coauthor-sensitivity.high{font-weight:700;border-color:#a67833;color:#f0c47a}
    .coauthor-anchor{font-size:.9rem}
    .coauthor-question-text{font-size:1.02rem;line-height:1.55}
    .question-input-actions,.question-voice-actions{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;margin:.65rem 0}
    .question-voice-launch{background:#17352d!important;border-color:#4aa982!important;color:#effff8!important;font-weight:700}
    .question-voice-launch:hover,.question-voice-launch.active{background:#1e493d!important;border-color:#62e0b0!important}
    .question-voice-panel{padding:.8rem;border:1px solid #3d5b70;border-radius:10px;background:#10171e;margin:.5rem 0 .8rem}
    .question-voice-panel[hidden]{display:none!important}
    .question-voice-explainer{display:grid;gap:.2rem}.question-voice-explainer span{font-size:.84rem;color:#9fb0c2;line-height:1.4}
    .question-voice-status{display:block;margin-top:.45rem;font-size:.8rem;color:#8fbda9}.question-voice-status.error{color:#f08b8b}
    .response-assessment{margin-top:.7rem;padding:.7rem;border-radius:8px;border-left:4px solid #6b8e7a;background:rgba(107,142,122,.08)}
    .response-assessment.needs-verification{border-left-color:#a67833;background:rgba(166,120,51,.08)}
    .coauthor-assessment-summary{padding:.75rem;border:1px solid #344354;border-radius:8px;margin:.7rem 0;background:#151b22}
    @media(max-width:760px){.coauthor-manuscript-actions,.question-input-actions,.question-voice-actions{display:grid;grid-template-columns:1fr}.coauthor-manuscript-actions>*,.question-input-actions>*,.question-voice-actions>*{width:100%}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 160) clearInterval(timer);
  }, 50);
})();