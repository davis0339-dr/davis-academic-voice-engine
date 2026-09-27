(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MANUSCRIPT_CAP = 30000;
  const state = {
    questions: [],
    assessments: [],
    coverage: [],
    diagnosisOverview: "",
    rawDraft: "",
    contributionLedger: [],
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

    const actionLabels = {
      respond_in_own_words: "Explain this in your own words",
      rephrase_in_own_words: "Rephrase the passage yourself",
      read_back_in_own_words: "Read it back, then restate what you mean",
      resolve_contradiction: "Resolve a contradiction",
      explain_mechanism: "Explain how or why the relationship works",
      qualify_claim: "Set the intended boundary or level of certainty",
      reorganize_section: "Explain the intended section order",
      contract_repetition: "Decide what is repeated and what must remain",
      evidence_check: "Identify or verify the required evidence",
    };
    const overview = state.diagnosisOverview ? `<div class="coauthor-diagnosis-overview"><strong>What this manuscript needs from you:</strong> ${esc(state.diagnosisOverview)}</div>` : "";
    const coverage = state.coverage.length ? `<div class="coauthor-coverage"><strong>Coverage:</strong> ${state.coverage.filter((row) => row.decision === "author_action").length} block(s) require author action; ${state.coverage.filter((row) => row.decision === "leave_for_now").length} were left alone in this pass.</div>` : "";

    target.innerHTML = `${overview}${coverage}` + state.questions.map((q, index) => `
      <article class="coauthor-question-card" data-question-card="${esc(q.id)}">
        <div class="coauthor-question-head">
          <strong>Author task ${index + 1}${q.paragraph_index ? ` · paragraph ${esc(q.paragraph_index)}` : ""}</strong>
          <span class="coauthor-sensitivity ${esc(q.verification_sensitivity || "conditional")}">${esc((q.verification_sensitivity || "conditional").replace(/_/g, " "))} verification sensitivity</span>
        </div>
        <p class="coauthor-task-meta"><strong>${esc(actionLabels[q.action] || "Respond in your own words")}</strong> · ${esc(q.scope || "paragraph")} · ${esc(q.section || "unlabelled section")}</p>
        ${q.anchor ? `<p class="coauthor-anchor"><strong>Exact location:</strong> “${esc(q.anchor)}”</p>` : ""}
        ${q.diagnosis ? `<div class="coauthor-diagnosis"><strong>What Davis found:</strong> ${esc(q.diagnosis)}</div>` : ""}
        <p class="coauthor-question-text">${esc(q.question)}</p>
        ${q.why_it_matters ? `<p class="muted">Why this matters: ${esc(q.why_it_matters)}</p>` : ""}
        ${q.preserve ? `<p class="coauthor-preserve"><strong>Do not lose:</strong> ${esc(q.preserve)}</p>` : ""}
        <details class="coauthor-source-block"><summary>Read the complete diagnosed passage</summary><p>${esc(q.source_text || "")}</p></details>
        <label>Your explanation
          <textarea data-coauthor-answer="${esc(q.id)}" rows="4" placeholder="Answer in your own words and understanding. Rough language is useful. You do not need to sound academic here."></textarea>
        </label>
        <div class="coauthor-use-controls">
          <label>Your decision
            <select data-coauthor-status="${esc(q.id)}">
              <option value="unreviewed">Keep unreviewed</option>
              <option value="accepted">Accept my words for the working draft</option>
              <option value="rejected">Do not use this response</option>
            </select>
          </label>
          <label>Use my exact words
            <select data-coauthor-operation="${esc(q.id)}">
              <option value="notes_only">As working notes only</option>
              <option value="append_after" ${["respond_in_own_words","explain_mechanism","qualify_claim","resolve_contradiction","evidence_check"].includes(q.action) ? "selected" : ""}>Add after this passage</option>
              <option value="insert_before">Insert before this passage</option>
              <option value="replace_block" ${["rephrase_in_own_words","read_back_in_own_words","contract_repetition"].includes(q.action) ? "selected" : ""}>Replace this passage</option>
            </select>
          </label>
        </div>
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
      state.coverage = data.coverage || [];
      state.diagnosisOverview = data.overview || "";
      state.assessments = [];
      renderQuestions();
      renderAssessmentSummary();
      status(state.questions.length
        ? `${state.questions.length} exact author task(s) ready. Read each diagnosis, answer in your own words, and explicitly decide whether and where your raw wording may enter the working draft.`
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
        block_id: q.block_id,
        action: q.action,
        question: q.question,
        answer: box?.value.trim() || "",
        input_mode: box?.dataset.inputMode || "typed",
        researcher_status: document.querySelector(`[data-coauthor-status="${CSS.escape(q.id)}"]`)?.value || "unreviewed",
        operation: document.querySelector(`[data-coauthor-operation="${CSS.escape(q.id)}"]`)?.value || "notes_only",
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
      status("Assessment complete. The displayed interpretation is advisory only. Your exact answer remains the material used by the raw working-draft builder; Davis has not rewritten it.");
    } catch (err) {
      status(`Could not assess the researcher responses: ${err.message}`, true);
    }
  }

  async function buildRawAuthorDraft() {
    const manuscript = manuscriptText();
    const responses = collectResponses();
    const accepted = responses.filter((item) => item.researcher_status === "accepted" && item.operation !== "notes_only");
    if (!manuscript) return status("The working manuscript is required before building the raw author draft.", true);
    if (!accepted.length) return status("Accept at least one response and choose where its exact wording should be used.", true);
    status("Placing your accepted wording into the diagnosed locations without polishing or paraphrasing…");
    try {
      const data = await postJson("/api/research/raw-integrate", {
        manuscriptText: manuscript,
        contributions: accepted.map((item) => ({
          contribution_id: item.question_id,
          block_id: item.block_id,
          raw_text: item.answer,
          operation: item.operation,
          researcher_status: item.researcher_status,
        })),
      });
      state.rawDraft = data.draft || "";
      state.contributionLedger = data.ledger || [];
      if ($("rawAuthorDraft")) $("rawAuthorDraft").value = state.rawDraft;
      if ($("rawAuthorLedger")) {
        $("rawAuthorLedger").innerHTML = `<div class="raw-author-note"><strong>No-polish confirmation:</strong> ${esc(data.note || "")}</div>${state.contributionLedger.map((row) => `
          <div class="raw-ledger-row"><strong>${esc(row.contribution_id)}</strong> → ${esc(row.section || "section")}${row.paragraph_index ? `, paragraph ${esc(row.paragraph_index)}` : ""} · ${esc(row.operation.replace(/_/g, " "))} · transformation: none</div>
        `).join("")}`;
      }
      status(`Raw author working draft built with ${data.contribution_count || 0} accepted contribution(s). No language model edited the inserted wording.`);
    } catch (err) {
      status(`Could not build the raw author working draft: ${err.message}`, true);
    }
  }

  function useRawDraftAsManuscript() {
    if (!state.rawDraft) return status("Build the raw author working draft first.", true);
    setManuscript(state.rawDraft, "Raw author working draft");
    if ($("sourceText")) $("sourceText").value = state.rawDraft;
    status("The raw author draft is now the working manuscript. Review its structure yourself or run another diagnosis pass; no polish was applied.");
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
          <p>This path works backward from the manuscript to the researcher's thinking: load the text, let Davis identify exact structural or intellectual problems, then answer the author tasks in your own words. Davis may diagnose and question, but this path does not polish, paraphrase or sharpen your response.</p>
        </div>
        <span class="coauthor-flow-badge">Manuscript → exact diagnosis → author response → raw working draft</span>
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
        <button id="generateCoauthorQuestionsBtn" class="primary" type="button">Diagnose and break the work into author tasks</button>
      </div>
      <p class="muted">The Source/Revised shortcuts are optional conveniences. A new coauthoring session can begin here from an uploaded or pasted manuscript without coming through the Editor.</p>
      <span id="coauthoringStatus" class="file-status">Ready for a working manuscript.</span>

      <div id="coauthorQuestionList" class="coauthor-question-list"><p class="muted">Load a manuscript and ask Davis to identify the highest-value questions for your own reasoning.</p></div>
      <div class="coauthor-own-words-callout"><strong>Answer from your understanding, not for polish.</strong> If your answer is an interpretation, mechanism, boundary or judgment, Davis can use it as part of your intellectual position. If you state an external fact, Davis will preserve the idea but mark the factual part for verification before it is presented as established evidence.</div>
      <div class="action-row">
        <button id="assessCoauthorResponsesBtn" type="button">Check what my responses contribute</button>
        <button id="buildRawAuthorDraftBtn" class="primary" type="button">Build raw author working draft — no polishing</button>
      </div>
      <div id="coauthorAssessmentSummary"></div>
      <p id="coauthorOverallAssessment" class="muted"></p>
      <section class="raw-author-output">
        <h5>Raw author working draft</h5>
        <p class="muted">Only responses you explicitly accept are inserted, exactly as supplied. Use this as unfinished research material: read it, reorganise it and diagnose it again where necessary.</p>
        <textarea id="rawAuthorDraft" rows="12" readonly placeholder="Your unpolished author-led working draft will appear here."></textarea>
        <div id="rawAuthorLedger"></div>
        <button id="useRawAuthorDraftBtn" type="button">Use this raw draft for the next diagnosis pass</button>
      </section>
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
    $("buildRawAuthorDraftBtn")?.addEventListener("click", buildRawAuthorDraft);
    $("useRawAuthorDraftBtn")?.addEventListener("click", useRawDraftAsManuscript);

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
    .coauthor-diagnosis-overview,.coauthor-coverage,.raw-author-note{padding:.75rem;border:1px solid #3f5872;border-radius:8px;background:#111820;margin:.7rem 0}
    .coauthor-task-meta,.coauthor-preserve{color:#c9d8e8}.coauthor-diagnosis{padding:.7rem;border-left:4px solid #a67833;background:rgba(166,120,51,.08);margin:.65rem 0}
    .coauthor-source-block{margin:.65rem 0}.coauthor-source-block p{white-space:pre-wrap;color:#c8d1da}
    .coauthor-use-controls{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin:.7rem 0}
    .raw-author-output{margin-top:1rem;padding-top:1rem;border-top:1px solid #344354}.raw-author-output textarea{width:100%;box-sizing:border-box}
    .raw-ledger-row{padding:.55rem;border-bottom:1px solid #2c3946;font-size:.86rem}
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
    @media(max-width:760px){.coauthor-manuscript-actions,.question-input-actions,.question-voice-actions,.coauthor-use-controls{display:grid;grid-template-columns:1fr}.coauthor-manuscript-actions>*,.question-input-actions>*,.question-voice-actions>*{width:100%}}
  `;
  document.head.appendChild(style);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 160) clearInterval(timer);
  }, 50);
})();
