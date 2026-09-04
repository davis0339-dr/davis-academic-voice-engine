import { Router } from "express";
import { llmProvider, HealthState } from "../lib/llmProvider.js";
import {
  acceptedArgumentNodes,
  extractJsonObject,
  normalizeArgumentMap,
  normalizeEvidenceLinks,
  retrieveEvidenceCandidates,
  summarizeAgency,
} from "../lib/researcherAgency.js";
import {
  buildManuscriptDevelopmentUnits,
  buildStudioHumanReasoningGuide,
  integrateRawAuthorContributions,
  normalizeDevelopmentDiagnosis,
} from "../lib/researchDevelopment.js";

export const researchStudioRouter = Router();

const REASONING_SYSTEM = `You are the reasoning-analysis layer of an academic manuscript development system.
Your job is to recover and structure the RESEARCHER'S intellectual position before any prose is rewritten.
Do not reward polished wording. Do not infer human authorship from style. Do not invent evidence, citations, theories, variables, findings, methods or sources.
Preserve uncertainty, disagreement, boundaries, causal caution and distinctions the researcher makes.
Treat spoken, typed or rough language as potentially valuable reasoning. Separate what the researcher clearly supplied from what you are only suggesting.
A researcher's explanation can establish what they mean, intend, interpret, prefer or wish to argue. It does NOT by itself establish an external empirical fact.
When a researcher supplies a factual, empirical, historical, statistical, legal, technical or literature claim without visible support, retain the reasoning but describe the evidence need explicitly rather than silently treating the claim as verified.
Do not penalise ordinary language or rough grammar. Do not write the final academic paragraph in this step.

Return valid JSON only with this exact shape:
{
  "researcher_summary": "plain-language summary of what the researcher appears to mean",
  "nodes": [
    {
      "id": "arg-1",
      "type": "claim|mechanism|qualification|assumption|counterargument|interpretation|implication|boundary|evidence_need|methodological_choice",
      "statement": "one precise intellectual move",
      "origin": "researcher|system_suggestion|shared",
      "researcher_status": "unreviewed",
      "confidence": "low|moderate|high",
      "evidence_need": "state what would need support; use an empty string only when the node is purely the researcher's own boundary, decision, interpretation or intended meaning",
      "rationale": "why this node matters to the argument"
    }
  ],
  "unresolved_questions": ["only questions that materially affect the argument"],
  "boundaries": ["things the researcher is explicitly not claiming"],
  "researcher_decisions": ["clear decisions already made by the researcher"]
}`;

const MANUSCRIPT_QUESTION_SYSTEM = `You are an author-development diagnostician, not a rewriting or polishing system.
The researcher supplied an indexed manuscript. Locate the exact blocks where the AUTHOR must provide missing reasoning, resolve a contradiction, reorganise thought, rephrase the passage in their own words, read it back in their own words, contract repetition, qualify a claim or verify evidence.

Do not rewrite any sentence. Do not offer a polished replacement. Do not sharpen clarity on the author's behalf. Do not answer your own questions. Do not reward smooth prose or treat rough wording as a defect by itself.
Diagnose intellectual and structural problems: conflicting claims or measures, missing mechanism, unexplained inference, literature tension that has been flattened, unsupported certainty, repeated material with no new job, misplaced material, unclear section purpose, missing boundary, or a passage whose machine-shaped formulation should be re-expressed by the researcher.
The human-thesis guidance in the payload describes reasoning operations, not a style to imitate. Use it to recognise where thought needs to become visible. Never copy thesis wording or manufacture grammar errors.

Return as many tasks as the manuscript genuinely requires, from 2 up to 18. A whole section may need several separate author tasks. Every task must use a supplied block_id and must tell the researcher what is wrong before asking what they mean.
Allowed actions: respond_in_own_words, rephrase_in_own_words, read_back_in_own_words, resolve_contradiction, explain_mechanism, qualify_claim, reorganize_section, contract_repetition, evidence_check.
When an answer is likely to introduce an external factual assertion, use high verification sensitivity. Authorial intention, interpretation and boundaries may be low or conditional.

Return valid JSON only:
{"overview":"what the manuscript most needs from its author","tasks":[{"id":"task-1","block_id":"block-001","section":"section label","scope":"sentence|paragraph|section","action":"respond_in_own_words|rephrase_in_own_words|read_back_in_own_words|resolve_contradiction|explain_mechanism|qualify_claim|reorganize_section|contract_repetition|evidence_check","anchor":"exact short phrase from the block","diagnosis":"specific intellectual or structural problem; no rewrite","question":"direct question the author must answer","why_it_matters":"what this answer would repair","preserve":"meaning, evidence, citation, uncertainty or useful authorial feature that must not be lost","verification_sensitivity":"low|conditional|high"}]}`;

const RESPONSE_ASSESS_SYSTEM = `You are the researcher-response assessment layer of an academic coauthoring system.
The researcher has answered questions about their own manuscript in rough, ordinary language. The answer may be typed or transcribed from voice. Input mode must never determine intellectual value.
Do NOT rewrite the answer into polished prose. Do NOT invent supporting scholarship. Do NOT reject an answer merely because it lacks a citation.
Your job is to separate authorial understanding from assertions that require external verification.

For each answer:
1. Decide how it aligns with the manuscript: clarifies, extends, qualifies, contradicts, or unclear.
2. Classify its main role: authorial_judgment, interpretive_explanation, mechanism_reasoning, methodological_decision, boundary, empirical_or_factual_assertion, or mixed.
3. Decide verification status:
   - not_required_for_authorial_intent: the answer is mainly the researcher's own intended meaning, boundary, judgment or interpretation. This can guide argument development, although later prose must still avoid presenting unsupported external facts as established.
   - verify_before_factual_use: the answer contains an external factual/empirical/technical claim that must be checked before it is written as fact.
   - evidence_workspace_check: the answer appears potentially supportable from sources, but it should be checked against the supplied evidence workspace before factual use.
   - unclear: the distinction cannot be made safely.
4. Explain exactly what can be used now as the researcher's reasoning and what, if anything, must be verified.
Do not treat fluency, grammar, accent, vocabulary or roughness as proof of authorship.

Return valid JSON only:
{"assessments":[{"question_id":"mq-1","manuscript_alignment":"clarifies|extends|qualifies|contradicts|unclear","role":"authorial_judgment|interpretive_explanation|mechanism_reasoning|methodological_decision|boundary|empirical_or_factual_assertion|mixed","verification_status":"not_required_for_authorial_intent|verify_before_factual_use|evidence_workspace_check|unclear","usable_reasoning":"what the answer contributes to the researcher's intellectual position","verification_note":"what must be checked, or empty if none","caution":"brief caution if the answer would become stronger when converted into manuscript prose"}],"overall_note":"brief statement about how the answers can be used without confusing researcher understanding with verified evidence"}`;

const EVIDENCE_SYSTEM = `You are the evidence-alignment layer of an academic research system.
You will receive approved/reviewable argument nodes and candidate excerpts retrieved from researcher-supplied source files.
Classify only what the excerpt actually supports. Do not invent bibliographic details or claim a source supports something merely because vocabulary overlaps.
Use only these relationships: supports, qualifies, contradicts, contextualises, insufficient.
If the excerpt is not enough, choose insufficient.
Preserve the supplied source id, source title, citation string and locator exactly.
Return valid JSON only:
{"links":[{"id":"evidence-1","argument_id":"arg-1","source_id":"source-1","source_title":"...","citation":"...","locator":"...","relationship":"supports","explanation":"...","excerpt":"verbatim supplied excerpt","researcher_status":"unreviewed"}]}`;

const CHALLENGE_SYSTEM = `You are a rigorous but economical academic challenge layer.
Do not rewrite the manuscript. Ask at most TWO questions, only where an answer would materially strengthen, narrow, correct or evidence the researcher's argument.
Prefer questions about mechanisms, unsupported inference, competing explanation, evidential fit, causal strength, boundaries, interpretation or methodological implications.
Do not ask for information already present. Do not ask generic questions such as 'Can you elaborate?'.
The researcher may answer in rough language by voice or typing. Encourage intellectual explanation rather than polished or generated wording.
Return valid JSON only:
{"questions":[{"argument_id":"arg-1","question":"...","why_it_matters":"...","evidence_gap":"..."}]}`;

const RECONSTRUCT_SYSTEM = `You are the controlled academic reconstruction layer of an academic writing system.
The argument map is authoritative. The researcher's accepted/modified reasoning, boundaries and decisions must govern the prose.
Evidence links are supporting material, not permission to invent facts. Use only citations explicitly supplied in evidence links. Never fabricate a citation.
A researcher-origin node records the researcher's intellectual position; it is not automatically verified evidence. If a node contains an unresolved evidence_need and there is no accepted supporting evidence link, do not present its external factual content as established fact. Preserve it as a cautious interpretation, rationale, hypothesis, boundary or evidence need as appropriate.
Do not strengthen causal or epistemic force. Preserve may/might/suggest/associate distinctions. Do not create new variables, moderators, methods, results or theoretical claims unless they are explicitly approved argument nodes.
Do not make every paragraph structurally symmetrical. Let sentence and paragraph architecture follow the intellectual work being done. Prefer conceptual transitions over decorative transitions. Preserve ordinary precise language over inflated academic vocabulary.
Return valid JSON only:
{"draft":"...","used_argument_ids":["arg-1"],"used_evidence_ids":["evidence-1"],"warnings":["..."],"agency_note":"brief explanation of how researcher decisions governed the draft"}`;

const INTEGRITY_SYSTEM = `You are an argument-integrity auditor.
Compare candidate prose against an approved researcher argument map. Do not judge whether the prose is human or AI. Judge whether the candidate preserves the researcher's intellectual decisions.
For each approved node classify status as preserved, strengthened, weakened, lost or contradicted. Flag new material that is not licensed by the argument map. Pay special attention to changed causal strength, removed qualifications, changed variable meaning, reversed direction, new claims, and lost boundaries.
Return valid JSON only:
{"node_results":[{"argument_id":"arg-1","status":"preserved","explanation":"..."}],"new_claims":["..."],"lost_boundaries":["..."],"epistemic_drift":["..."],"overall":"preserved|minor_drift|material_drift","summary":"..."}`;

function providerError(res, err, requestId) {
  const state = err?.healthState || HealthState.PROVIDER_ERROR;
  const status = state === HealthState.NOT_CONFIGURED ? 503 : state === HealthState.RATE_LIMITED ? 429 : 502;
  return res.status(status).json({ error: state, message: err?.message || "Research reasoning service unavailable.", requestId });
}

function shortString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sanitizeStyleFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return {};
  const out = {};
  for (const [key, value] of Object.entries(filters).slice(0, 12)) {
    if (typeof key === "string" && typeof value === "string") out[key.slice(0, 80)] = value.slice(0, 160);
  }
  return out;
}

function normalizeResponseAssessments(raw = {}, knownQuestionIds = new Set()) {
  const alignments = new Set(["clarifies", "extends", "qualifies", "contradicts", "unclear"]);
  const roles = new Set(["authorial_judgment", "interpretive_explanation", "mechanism_reasoning", "methodological_decision", "boundary", "empirical_or_factual_assertion", "mixed"]);
  const statuses = new Set(["not_required_for_authorial_intent", "verify_before_factual_use", "evidence_workspace_check", "unclear"]);
  const assessments = Array.isArray(raw.assessments) ? raw.assessments.slice(0, 8).map((row) => {
    const questionId = shortString(row?.question_id, 80);
    const alignment = shortString(row?.manuscript_alignment, 40).toLowerCase();
    const role = shortString(row?.role, 80).toLowerCase();
    const status = shortString(row?.verification_status, 80).toLowerCase();
    return {
      question_id: questionId,
      manuscript_alignment: alignments.has(alignment) ? alignment : "unclear",
      role: roles.has(role) ? role : "mixed",
      verification_status: statuses.has(status) ? status : "unclear",
      usable_reasoning: shortString(row?.usable_reasoning, 1800),
      verification_note: shortString(row?.verification_note, 1600),
      caution: shortString(row?.caution, 1200),
    };
  }).filter((row) => row.question_id && (!knownQuestionIds.size || knownQuestionIds.has(row.question_id))) : [];
  return {
    assessments,
    overall_note: shortString(raw.overall_note, 1800),
  };
}

async function modelJson({ system, payload, maxTokens = 4096 }) {
  const result = await llmProvider.callAnthropic({
    system,
    messages: [{ role: "user", content: JSON.stringify(payload) }],
    maxTokens,
  });
  return extractJsonObject(result.text);
}

researchStudioRouter.post("/research/manuscript-questions", async (req, res) => {
  const manuscriptText = shortString(req.body?.manuscriptText, 30000);
  const styleFilters = sanitizeStyleFilters(req.body?.styleFilters);
  if (!manuscriptText) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Provide a working manuscript or passage before starting manuscript-first coauthoring.", requestId: req.requestId });
  }
  const units = buildManuscriptDevelopmentUnits(manuscriptText);
  try {
    const raw = await modelJson({
      system: MANUSCRIPT_QUESTION_SYSTEM,
      payload: {
        indexed_manuscript_blocks: units,
        academic_context: styleFilters,
        human_thesis_reasoning_guide: buildStudioHumanReasoningGuide(styleFilters.section),
        instruction: "Diagnose before questioning. Leave adequate blocks alone. Do not generate, polish or rephrase the author's prose.",
      },
      maxTokens: 7200,
    });
    const diagnosis = normalizeDevelopmentDiagnosis(raw, units);
    return res.json({
      questions: diagnosis.tasks,
      overview: diagnosis.overview,
      coverage: diagnosis.coverage,
      diagnosis_version: diagnosis.diagnosis_version,
      human_reasoning_profiles: 3,
      persistence: "none",
      requestId: req.requestId,
    });
  } catch (err) {
    return providerError(res, err, req.requestId);
  }
});

researchStudioRouter.post("/research/raw-integrate", (req, res) => {
  const manuscriptText = shortString(req.body?.manuscriptText, 30000);
  if (!manuscriptText) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Provide the working manuscript before integrating researcher wording.", requestId: req.requestId });
  }
  const result = integrateRawAuthorContributions(manuscriptText, req.body?.contributions);
  return res.json({ ...result, persistence: "none", requestId: req.requestId });
});

researchStudioRouter.post("/research/response-assess", async (req, res) => {
  const manuscriptText = shortString(req.body?.manuscriptText, 30000);
  const styleFilters = sanitizeStyleFilters(req.body?.styleFilters);
  const responses = Array.isArray(req.body?.responses) ? req.body.responses.slice(0, 8).map((item, index) => ({
    question_id: shortString(item?.question_id, 80) || `mq-${index + 1}`,
    question: shortString(item?.question, 1600),
    answer: shortString(item?.answer, 5000),
    input_mode: ["typed", "voice", "mixed", "unknown"].includes(item?.input_mode) ? item.input_mode : "unknown",
  })).filter((item) => item.answer) : [];
  if (!manuscriptText || !responses.length) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Provide the manuscript and at least one researcher response.", requestId: req.requestId });
  }
  const knownIds = new Set(responses.map((item) => item.question_id));
  try {
    const raw = await modelJson({
      system: RESPONSE_ASSESS_SYSTEM,
      payload: {
        manuscript: manuscriptText,
        researcher_responses: responses,
        academic_context: styleFilters,
        instruction: "Preserve the researcher's own words as the source of reasoning. Flag verification needs without blocking use of genuine interpretation or judgment.",
      },
      maxTokens: 4200,
    });
    return res.json({ ...normalizeResponseAssessments(raw, knownIds), persistence: "none", requestId: req.requestId });
  } catch (err) {
    return providerError(res, err, req.requestId);
  }
});

researchStudioRouter.post("/research/reasoning-map", async (req, res) => {
  const thoughts = shortString(req.body?.thoughts, 16000);
  const manuscriptContext = shortString(req.body?.manuscriptContext, 12000);
  const styleFilters = sanitizeStyleFilters(req.body?.styleFilters);
  if (!thoughts) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "`thoughts` is required. Give the researcher's own explanation, rough notes or argument.", requestId: req.requestId });
  }
  try {
    const raw = await modelJson({
      system: REASONING_SYSTEM,
      payload: {
        researcher_thoughts: thoughts,
        manuscript_context: manuscriptContext || null,
        academic_context: styleFilters,
        instruction: "Recover the reasoning; do not polish it into final prose. Distinguish the researcher's intended meaning from external claims that still require evidence.",
      },
      maxTokens: 5000,
    });
    const argumentMap = normalizeArgumentMap(raw);
    return res.json({ argumentMap, agency: summarizeAgency(argumentMap), persistence: "none", requestId: req.requestId });
  } catch (err) {
    return providerError(res, err, req.requestId);
  }
});

researchStudioRouter.post("/research/evidence-align", async (req, res) => {
  const argumentMap = normalizeArgumentMap(req.body?.argumentMap || {});
  const sources = Array.isArray(req.body?.sources) ? req.body.sources.slice(0, 8).map((source, index) => ({
    id: shortString(source?.id, 80) || `source-${index + 1}`,
    title: shortString(source?.title || source?.name, 300) || `Source ${index + 1}`,
    citation: shortString(source?.citation, 500),
    text: shortString(source?.text, 40000),
  })).filter((source) => source.text) : [];
  if (!argumentMap.nodes.length) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "An argument map with at least one node is required.", requestId: req.requestId });
  }
  if (!sources.length) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Upload or add at least one source before aligning evidence.", requestId: req.requestId });
  }

  const retrieval = retrieveEvidenceCandidates(argumentMap, sources, { perNode: 3 });
  const candidateCount = retrieval.reduce((sum, item) => sum + item.candidates.length, 0);
  if (!candidateCount) {
    return res.json({ links: [], retrieval, mode: "no_candidate_overlap", warning: "No plausible passages were retrieved. This is not evidence that the argument is unsupported; the supplied sources may use different terminology.", requestId: req.requestId });
  }

  try {
    const raw = await modelJson({
      system: EVIDENCE_SYSTEM,
      payload: {
        arguments: acceptedArgumentNodes(argumentMap),
        retrieved_candidates: retrieval,
        instruction: "Classify evidential relationship conservatively and only from the supplied excerpts.",
      },
      maxTokens: 6500,
    });
    const links = normalizeEvidenceLinks(raw);
    return res.json({ links, retrieval, mode: "retrieval_plus_model_alignment", persistence: "none", requestId: req.requestId });
  } catch (err) {
    if (err?.healthState === HealthState.NOT_CONFIGURED) {
      const links = retrieval.flatMap((item, itemIndex) => item.candidates.map((candidate, candidateIndex) => ({
        id: `candidate-${itemIndex + 1}-${candidateIndex + 1}`,
        argument_id: item.argument_id,
        source_id: candidate.source_id,
        source_title: candidate.source_title,
        citation: candidate.citation,
        locator: candidate.locator,
        relationship: "candidate",
        explanation: "Lexically relevant passage retrieved; evidential relationship has not been model-classified.",
        excerpt: candidate.text,
        researcher_status: "unreviewed",
      })));
      return res.json({ links, retrieval, mode: "lexical_retrieval_only", warning: "LLM is not configured, so passages were retrieved but not interpreted.", requestId: req.requestId });
    }
    return providerError(res, err, req.requestId);
  }
});

researchStudioRouter.post("/research/challenge", async (req, res) => {
  const argumentMap = normalizeArgumentMap(req.body?.argumentMap || {});
  const evidenceLinks = normalizeEvidenceLinks({ links: req.body?.evidenceLinks || [] });
  const researchContext = shortString(req.body?.researchContext, 6000);
  if (!argumentMap.nodes.length) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "An argument map is required before challenge mode.", requestId: req.requestId });
  }
  try {
    const raw = await modelJson({
      system: CHALLENGE_SYSTEM,
      payload: { argument_map: argumentMap, evidence_links: evidenceLinks, research_context: researchContext || null },
      maxTokens: 1800,
    });
    const questions = Array.isArray(raw.questions) ? raw.questions.slice(0, 2).map((q) => ({
      argument_id: shortString(q?.argument_id, 80),
      question: shortString(q?.question, 1200),
      why_it_matters: shortString(q?.why_it_matters, 1200),
      evidence_gap: shortString(q?.evidence_gap, 1200),
    })).filter((q) => q.question) : [];
    return res.json({ questions, requestId: req.requestId });
  } catch (err) {
    return providerError(res, err, req.requestId);
  }
});

researchStudioRouter.post("/research/reconstruct", async (req, res) => {
  const argumentMap = normalizeArgumentMap(req.body?.argumentMap || {});
  const evidenceLinks = normalizeEvidenceLinks({ links: req.body?.evidenceLinks || [] });
  const styleFilters = sanitizeStyleFilters(req.body?.styleFilters);
  const section = shortString(req.body?.section, 120);
  const constraints = shortString(req.body?.constraints, 4000);
  const approvedNodes = acceptedArgumentNodes(argumentMap);
  if (!approvedNodes.length) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "No accepted/reviewable argument nodes are available for reconstruction.", requestId: req.requestId });
  }
  try {
    const raw = await modelJson({
      system: RECONSTRUCT_SYSTEM,
      payload: {
        approved_argument_nodes: approvedNodes,
        boundaries: argumentMap.boundaries,
        researcher_decisions: argumentMap.researcher_decisions,
        evidence_links: evidenceLinks.filter((link) => link.researcher_status !== "rejected" && link.relationship !== "insufficient"),
        academic_context: styleFilters,
        section: section || styleFilters.section || null,
        additional_constraints: constraints || null,
      },
      maxTokens: 6000,
    });
    return res.json({
      draft: shortString(raw.draft, 30000),
      used_argument_ids: Array.isArray(raw.used_argument_ids) ? raw.used_argument_ids.slice(0, 40).map((x) => shortString(x, 80)).filter(Boolean) : [],
      used_evidence_ids: Array.isArray(raw.used_evidence_ids) ? raw.used_evidence_ids.slice(0, 80).map((x) => shortString(x, 80)).filter(Boolean) : [],
      warnings: Array.isArray(raw.warnings) ? raw.warnings.slice(0, 12).map((x) => shortString(x, 1200)).filter(Boolean) : [],
      agency_note: shortString(raw.agency_note, 2000),
      requestId: req.requestId,
    });
  } catch (err) {
    return providerError(res, err, req.requestId);
  }
});

researchStudioRouter.post("/research/integrity", async (req, res) => {
  const argumentMap = normalizeArgumentMap(req.body?.argumentMap || {});
  const candidateText = shortString(req.body?.candidateText, 30000);
  if (!argumentMap.nodes.length || !candidateText) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Provide an argument map and candidate text for integrity checking.", requestId: req.requestId });
  }
  try {
    const raw = await modelJson({
      system: INTEGRITY_SYSTEM,
      payload: { approved_argument_map: argumentMap, candidate_text: candidateText },
      maxTokens: 4500,
    });
    return res.json({ ...raw, requestId: req.requestId });
  } catch (err) {
    return providerError(res, err, req.requestId);
  }
});
