// Long Document intelligence layer.
// Reads the manuscript as one intellectual object, supplies section-aware context,
// preserves researcher decisions, audits reassembly regularity, and now also checks
// whether the selected intervention mode was actually executed across the document.

import { llmProvider } from "./llmProvider.js";
import { diagnose } from "./diagnostics.js";
import { buildInterventionPlan, INTERVENTION_INTENTS } from "./planner.js";
import { analyseResidualWriting } from "./residualDiagnostics.js";
import { inferSectionFromHeading } from "./sectionLanguageGuide.js";
import { splitSentences } from "./sentences.js";
import { countWords } from "../config/limits.js";

const DEEP_INTENTS = new Set([
  INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION,
  INTERVENTION_INTENTS.DEEP_REDEVELOPMENT,
]);

function clean(value, max = 700) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normaliseHeading(value) {
  return clean(value, 180).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safeArray(value, max = 20) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function parseJsonObject(raw) {
  let text = String(raw || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  return JSON.parse(text);
}

function sectionExcerpt(fullText, heading, headings) {
  const current = headings.find((item) => item.text === heading);
  if (!current) return "";
  const index = headings.indexOf(current);
  const start = current.offset + current.lineText.length + 1;
  const end = index + 1 < headings.length ? headings[index + 1].offset : fullText.length;
  return clean(fullText.slice(start, end), 900);
}

export function buildFallbackBlueprint(fullText, documentMap) {
  const headings = documentMap?.headings || [];
  const argumentArc = headings.slice(0, 24).map((heading, index) => ({
    heading: heading.text,
    section: inferSectionFromHeading(heading.text) || null,
    role: index === 0
      ? "establish the opening stage of the document's argument"
      : "advance the document from the preceding stage toward its overall research objective",
    source_excerpt: sectionExcerpt(fullText, heading.text, headings),
    downstream_dependency: index + 1 < headings.length
      ? `prepare the reasoning needed for ${headings[index + 1].text}`
      : "support the document's final stated contribution or methodological end point",
  }));

  const title = clean(documentMap?.title || headings[0]?.text || "academic manuscript", 220);
  return {
    version: "longdoc-blueprint-v2",
    generated_by: "deterministic_fallback",
    document_goal: `Preserve and strengthen the complete argument of ${title} while keeping local sections aligned with the manuscript's end goal rather than treating them as independent passages.`,
    argument_arc: argumentArc,
    global_dependencies: [
      "Later sections must remain consistent with variables, constructs, definitions, study stage, population, period and methods established earlier.",
      "A local paragraph may be grammatically clean yet still require redevelopment when the selected authorial mode and whole-document context show that its discourse architecture should change.",
    ],
    consistency_constraints: [
      "Preserve section/chapter order unless the source itself clearly requires local repair.",
      "Preserve named variables, measures, hypotheses, dates, populations, methods, citations, numerical claims and proposal/completed-study tense.",
      "Carry intellectual continuity across chunks without copying sentence rhythm, transition formulas or paragraph closure patterns from one chunk to the next.",
    ],
    evidence_needs: [],
    rhetoric_safeguards: [
      "Do not make every paragraph resolve into claim-evidence-interpretation-implication.",
      "Do not repeatedly balance one benefit against one limitation using the same syntactic template.",
      "Do not increase lexical formality merely because the requested rewrite authority is Deep or Aggressive.",
      "Do not use expansion as a word-count target. Expand only identified reasoning, evidence, qualification, context, measurement distinction or gap work.",
      "In Deep Authorial mode, preserve the research and formal artefacts rather than defaulting to preservation of source sentence architecture across most substantive paragraphs.",
    ],
  };
}

function blueprintSystemPrompt() {
  return `You are the whole-document planning stage of an academic manuscript editor. Read the ENTIRE manuscript before any local chunk is revised. Do not rewrite the manuscript. Build a compact intellectual map that later chunk-level editors can use so they understand the end goal of the complete chapter/manuscript rather than treating an 800-word chunk as an isolated text.

Return one JSON object only with this exact top-level shape:
{
  "document_goal": "one precise paragraph",
  "argument_arc": [
    {
      "heading": "existing heading or descriptive stage",
      "role": "what this part must accomplish in the whole document",
      "must_preserve": ["claims/constructs/decisions that later sections depend on"],
      "development_opportunities": ["genuine missing/under-developed intellectual work or discourse work visible from whole-document context"],
      "downstream_dependency": "what later reasoning depends on this part"
    }
  ],
  "global_dependencies": ["cross-section reasoning dependencies"],
  "consistency_constraints": ["variables, methods, time period, study stage, definitions, evidence relationships that must not drift"],
  "evidence_needs": [
    {
      "section": "where evidence is needed",
      "need_type": "support|contradiction|qualification|measurement|context|methodology|gap",
      "query": "a concise evidence-bank search query",
      "rationale": "why this evidence would improve the argument"
    }
  ],
  "rhetoric_safeguards": ["document-wide patterns that must not be repeated across chunks"]
}

Rules:
- Read the full document as one intellectual object.
- Preserve the author's research design and claims. Never invent a new study, fact, citation, variable, hypothesis, result or method.
- Evidence needs are requests for the Research Evidence Bank; do not fabricate the missing evidence.
- Identify development opportunities only when the whole document reveals a real argumentative or discourse need.
- Do not recommend expansion merely because a section is short.
- Distinguish preservation of research meaning from preservation of sentence architecture.
- Keep the response compact: at most 24 argument-arc entries and 12 evidence needs.`;
}

function normaliseBlueprint(parsed, fallback) {
  const arc = safeArray(parsed?.argument_arc, 24).map((item) => ({
    heading: clean(item?.heading, 180),
    role: clean(item?.role, 500),
    must_preserve: safeArray(item?.must_preserve, 10).map((x) => clean(x, 300)),
    development_opportunities: safeArray(item?.development_opportunities, 10).map((x) => clean(x, 350)),
    downstream_dependency: clean(item?.downstream_dependency, 400),
  })).filter((item) => item.heading || item.role);

  const evidenceNeeds = safeArray(parsed?.evidence_needs, 12).map((item, index) => ({
    id: `evidence-need-${index + 1}`,
    section: clean(item?.section, 180),
    need_type: clean(item?.need_type, 80) || "support",
    query: clean(item?.query, 320),
    rationale: clean(item?.rationale, 500),
  })).filter((item) => item.query);

  return {
    version: "longdoc-blueprint-v2",
    generated_by: "whole_document_model",
    document_goal: clean(parsed?.document_goal, 1000) || fallback.document_goal,
    argument_arc: arc.length ? arc : fallback.argument_arc,
    global_dependencies: safeArray(parsed?.global_dependencies, 16).map((x) => clean(x, 450)).filter(Boolean),
    consistency_constraints: safeArray(parsed?.consistency_constraints, 20).map((x) => clean(x, 450)).filter(Boolean),
    evidence_needs: evidenceNeeds,
    rhetoric_safeguards: safeArray(parsed?.rhetoric_safeguards, 16).map((x) => clean(x, 450)).filter(Boolean),
  };
}

export async function buildWholeDocumentBlueprint({ fullText, documentMap }) {
  const fallback = buildFallbackBlueprint(fullText, documentMap);
  if (!llmProvider.isConfigured()) return fallback;

  try {
    const result = await llmProvider.callAnthropic({
      system: blueprintSystemPrompt(),
      messages: [{ role: "user", content: fullText }],
      maxTokens: 2600,
    });
    if (result.raw?.stop_reason === "max_tokens") {
      return { ...fallback, planning_warning: "Whole-document blueprint response was truncated; deterministic fallback used." };
    }
    return normaliseBlueprint(parseJsonObject(result.text), fallback);
  } catch (err) {
    return { ...fallback, planning_warning: `Whole-document planning fell back safely: ${err.message}` };
  }
}

function matchArcItem(blueprint, heading) {
  const wanted = normaliseHeading(heading);
  if (!wanted) return null;
  return (blueprint?.argument_arc || []).find((item) => {
    const candidate = normaliseHeading(item.heading);
    return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
  }) || null;
}

export function compactBlueprintForChunk(blueprint, chunk) {
  if (!blueprint) return null;
  const arcItem = matchArcItem(blueprint, chunk?.heading);
  const sectionName = normaliseHeading(chunk?.heading);
  const evidenceNeeds = (blueprint.evidence_needs || []).filter((need) => {
    const needSection = normaliseHeading(need.section);
    return !needSection || !sectionName || needSection.includes(sectionName) || sectionName.includes(needSection);
  }).slice(0, 5);

  return {
    document_goal: blueprint.document_goal,
    current_section: arcItem || (chunk?.heading ? { heading: chunk.heading } : null),
    global_dependencies: (blueprint.global_dependencies || []).slice(0, 8),
    consistency_constraints: (blueprint.consistency_constraints || []).slice(0, 10),
    evidence_needs: evidenceNeeds,
    rhetoric_safeguards: (blueprint.rhetoric_safeguards || []).slice(0, 10),
    instruction: "Use this map for intellectual continuity. Diagnosis chooses the operation; the researcher-selected intervention mode determines the authorised depth. Do not imitate prose rhythm from other chunks.",
  };
}

export function deriveLongDocumentChunkPolicy({ sourceText, requestedIntensity, requestedNaturalisation, requestedLengthPreference }) {
  const intensity = String(requestedIntensity || "auto").toLowerCase();
  const naturalisation = String(requestedNaturalisation || "faithful").toLowerCase();
  const lengthPreference = String(requestedLengthPreference || "auto").toLowerCase();

  const diagnostics = diagnose(sourceText);
  const scopePlan = buildInterventionPlan(diagnostics, {
    rewriteIntensity: intensity,
    lengthPreference: lengthPreference === "concise" ? "concise" : lengthPreference === "expand" ? "expand" : "maintain",
    naturalisation: naturalisation === "authorial" ? "aggressive" : naturalisation,
  });
  const recommended = scopePlan.intent?.recommended || INTERVENTION_INTENTS.PRESERVE_POLISH;
  const developmentNeed = diagnostics.argumentative_sufficiency?.development_need || "low";
  const deepDiagnosis = DEEP_INTENTS.has(recommended);
  const deepAuthority = intensity === "deep";
  const requestedAggressive = naturalisation === "aggressive" || naturalisation === "authorial";
  const authorialAuthority = deepAuthority && requestedAggressive;

  // Critical vNext correction: Deep + Aggressive/Authorial is no longer silently
  // narrowed to Faithful because an isolated chunk looked locally clean. The
  // planner still protects formal/evidential material and chooses paragraph actions.
  let effectiveNaturalisation = naturalisation === "off" ? "off" : "faithful";
  if (authorialAuthority || (naturalisation === "aggressive" && intensity !== "minor")) {
    effectiveNaturalisation = "aggressive";
  }

  let effectiveLengthPreference = lengthPreference;
  if (lengthPreference === "expand" && developmentNeed === "low" && !deepDiagnosis) {
    // Deep Authorial may reconstruct clean prose, but it must not manufacture new
    // intellectual content merely to make the document longer.
    effectiveLengthPreference = "maintain";
  }

  return {
    requested: { intensity, naturalisation, lengthPreference },
    effective: {
      intensity,
      naturalisation: effectiveNaturalisation,
      lengthPreference: effectiveLengthPreference,
    },
    diagnostic_intent: recommended,
    argumentative_development_need: developmentNeed,
    authorial_authority: authorialAuthority,
    aggressive_authorised: effectiveNaturalisation === "aggressive",
    expansion_authorised: effectiveLengthPreference === "expand",
    explanation: authorialAuthority
      ? "Deep Authorial authority is active. Diagnosis selects the operation, but substantive paragraphs are not silently downgraded to Faithful local polishing."
      : effectiveNaturalisation !== (naturalisation === "authorial" ? "aggressive" : naturalisation) || effectiveLengthPreference !== lengthPreference
        ? "Long Document narrowed only the treatment that would manufacture unsupported content or exceed the selected intensity ceiling."
        : "Requested treatment is consistent with the diagnosed chunk need.",
  };
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length);
}

function chunkCadence(text) {
  const lengths = splitSentences(text).map((sentence) => countWords(sentence)).filter(Boolean);
  return { mean: mean(lengths), sd: stddev(lengths), sentenceCount: lengths.length };
}

function residualRisk(text) {
  const audit = analyseResidualWriting(text);
  return { audit, risk: Number(audit?.metrics?.total_risk_score || 0) };
}

function normaliseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function exactRetention(sourceText, revisedText) {
  const sourceSentences = new Set(splitSentences(sourceText).map(normaliseText).filter((x) => x.length >= 12));
  const revisedSentences = splitSentences(revisedText).map(normaliseText).filter((x) => x.length >= 12);
  const exactSentences = revisedSentences.filter((sentence) => sourceSentences.has(sentence)).length;

  const sourceParagraphs = new Set(String(sourceText || "").split(/\n\s*\n+/).map(normaliseText).filter((x) => x.length >= 30));
  const revisedParagraphs = String(revisedText || "").split(/\n\s*\n+/).map(normaliseText).filter((x) => x.length >= 30);
  const exactParagraphs = revisedParagraphs.filter((paragraph) => sourceParagraphs.has(paragraph)).length;

  return {
    sentence_count: revisedSentences.length,
    exact_sentence_count: exactSentences,
    exact_sentence_retention_ratio: revisedSentences.length ? exactSentences / revisedSentences.length : 0,
    paragraph_count: revisedParagraphs.length,
    exact_paragraph_count: exactParagraphs,
    exact_paragraph_retention_ratio: revisedParagraphs.length ? exactParagraphs / revisedParagraphs.length : 0,
  };
}

function coverageThresholds(intensity, naturalisation) {
  const authorial = intensity === "deep" && ["aggressive", "authorial"].includes(naturalisation);
  if (authorial) return { sentence: 0.62, paragraph: 0.55, label: "deep_authorial" };
  if (intensity === "deep") return { sentence: 0.74, paragraph: 0.68, label: "deep_structural" };
  if (intensity === "moderate") return { sentence: 0.86, paragraph: 0.82, label: "moderate" };
  return { sentence: 1, paragraph: 1, label: intensity || "auto" };
}

export function auditTransformationCoverage({ sourceText, revisedText, chunks = [], requestedIntensity, requestedNaturalisation }) {
  const intensity = String(requestedIntensity || "auto").toLowerCase();
  const naturalisation = String(requestedNaturalisation || "faithful").toLowerCase();
  const overall = exactRetention(sourceText, revisedText);
  const thresholds = coverageThresholds(intensity, naturalisation);
  const enforced = ["moderate", "deep"].includes(intensity);

  const chunkRows = chunks
    .filter((chunk) => chunk?.sourceText && chunk?.revisedText && chunk.rewriteMode !== "passthrough")
    .map((chunk) => {
      const row = exactRetention(chunk.sourceText, chunk.revisedText);
      return {
        index: chunk.index,
        heading: chunk.heading || null,
        word_count: chunk.wordCount || countWords(chunk.sourceText),
        ...row,
      };
    });

  const targetChunkIndices = chunkRows
    .filter((row) => row.word_count >= 80)
    .filter((row) => row.exact_sentence_retention_ratio > thresholds.sentence || row.exact_paragraph_retention_ratio > thresholds.paragraph)
    .sort((a, b) =>
      (b.exact_paragraph_retention_ratio + b.exact_sentence_retention_ratio) -
      (a.exact_paragraph_retention_ratio + a.exact_sentence_retention_ratio)
    )
    .map((row) => row.index);

  const underTransformed = enforced && (
    overall.exact_sentence_retention_ratio > thresholds.sentence ||
    overall.exact_paragraph_retention_ratio > thresholds.paragraph
  );

  return {
    version: "longdoc-transformation-coverage-v1",
    passed: !underTransformed,
    enforced,
    mode_class: thresholds.label,
    thresholds: {
      exact_sentence_retention_review_above: thresholds.sentence,
      exact_paragraph_retention_review_above: thresholds.paragraph,
    },
    ...overall,
    under_transformed_for_selected_mode: underTransformed,
    target_chunk_indices: targetChunkIndices,
    chunk_diagnostics: chunkRows,
    note: "Retention thresholds are mode-consistency review signals, not quotas to alter every sentence. A failure means the selected Moderate/Deep intervention was not materially executed across enough substantive prose; formal artefacts, quotations and evidence may still remain verbatim.",
  };
}

export function auditWholeDocumentRegularity({ sourceText, revisedText, chunks = [] }) {
  const source = residualRisk(sourceText);
  const revised = residualRisk(revisedText);
  const riskDelta = revised.risk - source.risk;

  const sourceChunkMeans = [];
  const revisedChunkMeans = [];
  const chunkRows = [];
  for (const chunk of chunks) {
    if (!chunk?.sourceText || !chunk?.revisedText || chunk.rewriteMode === "passthrough") continue;
    const s = residualRisk(chunk.sourceText);
    const r = residualRisk(chunk.revisedText);
    const sCadence = chunkCadence(chunk.sourceText);
    const rCadence = chunkCadence(chunk.revisedText);
    sourceChunkMeans.push(sCadence.mean);
    revisedChunkMeans.push(rCadence.mean);
    chunkRows.push({
      index: chunk.index,
      heading: chunk.heading || null,
      source_risk: s.risk,
      revised_risk: r.risk,
      risk_delta: r.risk - s.risk,
      source_sentence_mean: Number(sCadence.mean.toFixed(2)),
      revised_sentence_mean: Number(rCadence.mean.toFixed(2)),
    });
  }

  const sourceAcrossChunkSd = stddev(sourceChunkMeans);
  const revisedAcrossChunkSd = stddev(revisedChunkMeans);
  const homogenisationRatio = sourceAcrossChunkSd > 0 ? revisedAcrossChunkSd / sourceAcrossChunkSd : 1;
  const highResidualSignals = (revised.audit.signals || []).filter((signal) => signal.severity === "high");
  const regularityRegression = riskDelta >= 8 && revised.risk >= Math.max(12, source.risk * 1.2);
  const severeHomogenisation = sourceChunkMeans.length >= 4 && sourceAcrossChunkSd >= 1.5 && homogenisationRatio < 0.58;
  const systemicSignals = highResidualSignals.filter((signal) => [
    "academic_bridge_choreography",
    "immediate_synthesis_density",
    "clause_stacking_pressure",
    "discourse_management_density",
    "nominalisation_pressure",
    "argument_packaging",
    "transition_saturation",
    "closure_regularisation",
  ].includes(signal.id));

  const targetChunkIndices = chunkRows
    .filter((row) => row.risk_delta >= 3 || row.revised_risk >= 8)
    .sort((a, b) => b.risk_delta - a.risk_delta || b.revised_risk - a.revised_risk)
    .slice(0, 6)
    .map((row) => row.index);

  const passed = !(regularityRegression || severeHomogenisation || systemicSignals.length >= 2);
  return {
    version: "longdoc-global-audit-v2",
    passed,
    status: passed ? "accepted" : "selective_repair_required",
    source_risk: source.risk,
    revised_risk: revised.risk,
    risk_delta: riskDelta,
    source_across_chunk_sentence_mean_sd: Number(sourceAcrossChunkSd.toFixed(3)),
    revised_across_chunk_sentence_mean_sd: Number(revisedAcrossChunkSd.toFixed(3)),
    homogenisation_ratio: Number(homogenisationRatio.toFixed(3)),
    regularity_regression: regularityRegression,
    severe_cross_chunk_homogenisation: severeHomogenisation,
    systemic_signal_ids: systemicSignals.map((signal) => signal.id),
    target_chunk_indices: targetChunkIndices,
    chunk_diagnostics: chunkRows,
    note: "This is a source-relative whole-document regularisation safeguard, not an AI-authorship score. It rejects a reassembled candidate when chunk-by-chunk rewriting creates stronger document-wide regularity than the source.",
  };
}

export function coverageRecoveryContext(blueprint, coverageAudit, chunk) {
  return {
    ...compactBlueprintForChunk(blueprint, chunk),
    transformation_coverage_recovery: {
      reason: "The assembled candidate retained too much source sentence/paragraph architecture for the researcher-selected intervention mode.",
      mode_class: coverageAudit.mode_class,
      overall_exact_sentence_retention: coverageAudit.exact_sentence_retention_ratio,
      overall_exact_paragraph_retention: coverageAudit.exact_paragraph_retention_ratio,
      instruction: "Rebuild this substantive chunk from its claims, evidence, qualifications and research purpose rather than editing the existing sentence shell. Preserve citations, numbers, technical relationships and formal artefacts. Do not synonym-spin, do not add unsupported facts, and do not force a uniform claim-evidence-synthesis template. Let paragraph function determine the new discourse path.",
    },
  };
}

export function globalRepairContext(blueprint, audit, chunk) {
  return {
    ...compactBlueprintForChunk(blueprint, chunk),
    selective_global_repair: {
      reason: "The first reassembled candidate developed stronger cross-chunk rhetorical regularity than the source.",
      source_risk: audit.source_risk,
      candidate_risk: audit.revised_risk,
      systemic_signals: audit.systemic_signal_ids,
      instruction: "Repair only the diagnosed local contribution to the global pattern. Prefer ordinary academic wording, vary paragraph function rather than forcing sentence-level difference, and do not add a polished synthesis sentence merely to close the paragraph. Do not simply restore the source sentence architecture if the selected mode required deeper reconstruction.",
    },
  };
}
