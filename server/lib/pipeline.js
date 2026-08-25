// Orchestrates Passes A-F end to end. This is the one production path
// used by both the demo and arbitrary user input.

import { extractProtectedSpans } from "./protect.js";
import { diagnose } from "./diagnostics.js";
import { buildDiagnosisScopedPlan } from "./diagnosisScopedPlanner.js";
import { resolveProfile } from "./styleProfileStore.js";
import { buildSystemPrompt } from "./promptContract.js";
import { buildRhetoricalLedger } from "./rhetoricalPreservation.js";
import { auditPreservation } from "./preservation.js";
import { llmProvider } from "./llmProvider.js";
import { assessCadenceDeviation } from "./cadenceDeviation.js";
import { assessTransformationQuality } from "./transformationQuality.js";
import { measureLanguageFingerprint } from "./languageFingerprint.js";
import { assessLanguageDeviation } from "./languageFamilyEngine.js";
import { getBuildInfo } from "./buildInfo.js";
import { parseStructuredResponseText, buildJsonRepairSystemPrompt } from "./modelResponse.js";
import { ensureCollaborativeReviewInputs, normalizeAdditionalInputs, normalizeRevisionPurpose } from "./collaborativeRevision.js";
import {
  assessIterativeRegularisation,
  buildIterativeRewriteDirective,
  iterativeCorrectionBlock,
  iterativeRegularisationPenalty,
  normaliseRewriteLineage,
} from "./iterativeRewriteGuard.js";
import { candidateHistoryPromptBlock } from "./candidateHistory.js";
import { buildLengthContract, lengthContractSatisfied, manuscriptWordCount } from "./lengthContract.js";
import { classifyPreservationRelease } from "./preservationRelease.js";
import { detectorFeedbackPromptBlock } from "./detectorFeedback.js";

const NATURALISATION_LEVELS = new Set(["off", "faithful", "aggressive"]);
const SUBSTANTIVE_PLAN_LEVELS = new Set([
  "SENTENCE_RESTRUCTURE",
  "SPLIT_OR_MERGE",
  "PARAGRAPH_REORDER",
  "CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT",
  "COMPRESS",
  "DISCOURSE_REPACKAGE",
]);

function measuredGuidance(deviation, family) {
  return {
    measurement_version: family?.measurement_version || null,
    family_document_count: family?.measured_document_count || 0,
    family_evidence_strength: family?.evidence_strength || "pilot-insufficient",
    family_alignment_score: deviation?.family_alignment_score ?? null,
    high_priority_signals: (deviation?.signals || []).filter((s) => s.severity === "high"),
    other_signals: (deviation?.signals || []).filter((s) => s.severity !== "high"),
    recommendations: deviation?.recommendations || [],
    preserve_not_targeted: deviation?.preserve_not_targeted || [],
    instruction: "Use these corpus-derived signals selectively. Correct the measured structural/language problems that are actually present in this source; do not force every metric toward a median, and do not alter research voice, hedging, citation form, or technical terminology merely to match a frequency distribution.",
  };
}

export function analyse({ sourceText, styleFilters, rewriteIntensity, grammarIntensity, lengthPreference, naturalisation, detectorFeedback }) {
  const protectedSpans = extractProtectedSpans(sourceText);
  const diagnostics = diagnose(sourceText);
  const plan = buildDiagnosisScopedPlan(diagnostics, { rewriteIntensity, lengthPreference, naturalisation, detectorFeedback });
  const profileResolution = resolveProfile(styleFilters);
  const cadenceDeviation = assessCadenceDeviation(sourceText, styleFilters);
  const languageFingerprint = measureLanguageFingerprint(sourceText);
  const measuredLanguageFamily = profileResolution.measured_language_family || null;
  const languageDeviation = assessLanguageDeviation(languageFingerprint, measuredLanguageFamily);

  const effectiveStyleProfile = {
    ...profileResolution.effective,
    features: {
      ...profileResolution.effective.features,
      source_specific_measured_guidance: measuredGuidance(languageDeviation, measuredLanguageFamily),
    },
  };

  return {
    protectedSpans,
    diagnostics: {
      generic_phrasing: diagnostics.generic_phrasing,
      structural_monotony: diagnostics.structural_monotony,
      paragraph_patterns: diagnostics.paragraph_patterns,
      rhetorical_scaffolding: diagnostics.rhetorical_scaffolding,
      text_structure: diagnostics.text_structure,
      machine_language_forensics: diagnostics.machine_language_forensics,
      discourse_regularity_forensics: diagnostics.discourse_regularity_forensics,
      discourse_architecture: diagnostics.discourse_architecture,
      argumentative_sufficiency: diagnostics.argumentative_sufficiency,
      qualitative_human_discourse: diagnostics.qualitative_human_discourse,
      contrastive_language: diagnostics.contrastive_language,
      cohesion: diagnostics.cohesion,
      evidence_alignment: diagnostics.evidence_alignment,
      cadence_deviation: cadenceDeviation,
      language_fingerprint: languageFingerprint,
      measured_language_deviation: languageDeviation,
    },
    plan,
    measured_language_family: measuredLanguageFamily,
    style_profile_used: {
      requested: profileResolution.requested,
      effective: effectiveStyleProfile,
      fallback_applied: profileResolution.fallback_applied,
      evidence_strength: profileResolution.evidence_strength,
      message: profileResolution.message,
    },
  };
}

export function sanitiseProse(text) {
  let out = text;
  out = out.replace(/\s*[—–]\s*/g, ", ");
  out = out.replace(/,\s*,/g, ",");
  out = out.replace(/\s+,/g, ",").replace(/,\s*([.;:])/g, "$1");
  return out;
}

function validateShape(parsed) {
  const errors = [];
  if (typeof parsed.revised_text !== "string" || parsed.revised_text.length === 0) errors.push("revised_text missing or empty");
  if (!parsed.edit_summary || typeof parsed.edit_summary !== "object") {
    errors.push("edit_summary missing");
  } else {
    for (const key of ["kept", "micro_edits", "sentence_restructures", "split_or_merge", "paragraph_reorders"]) {
      if (typeof parsed.edit_summary[key] !== "number") errors.push(`edit_summary.${key} missing or not a number`);
    }
    if (!Array.isArray(parsed.edit_summary.flags_for_author)) errors.push("edit_summary.flags_for_author missing or not an array");
  }
  return errors;
}

export function modelOutputTokenBudget(sourceText, revisionPurpose = "fidelity") {
  const wordCount = String(sourceText || "").trim().split(/\s+/).filter(Boolean).length;
  const metadataAllowance = normalizeRevisionPurpose(revisionPurpose) === "collaborative" ? 3200 : 1800;
  const estimatedNeed = Math.ceil(wordCount * 2.75 + metadataAllowance);
  const roundedNeed = Math.ceil(estimatedNeed / 1024) * 1024;
  return Math.min(8192, Math.max(4096, roundedNeed));
}

async function runModelPass({ systemPrompt, sourceText, maxTokens = 4096 }) {
  const sourceWords = String(sourceText || "").trim().split(/\s+/).filter(Boolean).length;
  // A near-limit academic rewrite can legitimately need longer than the former
  // fixed 90-second provider window. Give the primary pass one realistic window
  // instead of aborting and restarting the entire expensive pipeline three times.
  const primaryPassTimeoutMs = Math.min(150000, Math.max(90000, sourceWords * 100));
  const llmResult = await llmProvider.callAnthropic({
    system: systemPrompt,
    messages: [{ role: "user", content: sourceText }],
    maxTokens,
    timeoutOverrideMs: primaryPassTimeoutMs,
  });

  if (llmResult.raw?.stop_reason === "max_tokens") {
    const err = new Error("Model response was truncated before the structured revision completed.");
    err.code = "MODEL_RESPONSE_TRUNCATED";
    throw err;
  }

  let parseResult = parseStructuredResponseText(llmResult.text);
  let responseRepairUsed = false;

  if (!parseResult.ok) {
    const repairResult = await llmProvider.callAnthropic({
      system: buildJsonRepairSystemPrompt(),
      messages: [{ role: "user", content: llmResult.text }],
      maxTokens,
      timeoutOverrideMs: 60000,
    });
    if (repairResult.raw?.stop_reason === "max_tokens") {
      const err = new Error("JSON syntax recovery was truncated before completion.");
      err.code = "MODEL_RESPONSE_REPAIR_TRUNCATED";
      throw err;
    }
    parseResult = parseStructuredResponseText(repairResult.text);
    responseRepairUsed = true;
  }

  if (!parseResult.ok) {
    const err = new Error(`Model did not return valid JSON after one syntax-recovery attempt: ${parseResult.error?.message || "unknown parse error"}`);
    err.rawResponse = llmResult.text;
    err.code = "INVALID_MODEL_RESPONSE";
    throw err;
  }

  const parsed = parseResult.parsed;
  const shapeErrors = validateShape(parsed);
  if (shapeErrors.length > 0) {
    const err = new Error(`Model response failed schema validation: ${shapeErrors.join("; ")}`);
    err.rawResponse = parsed;
    err.code = "SCHEMA_VALIDATION_FAILED";
    throw err;
  }

  parsed.revised_text = sanitiseProse(parsed.revised_text);
  parsed.__response_repair_used = responseRepairUsed;
  parsed.__response_envelope_recovered = parseResult.recovered;
  return parsed;
}

export function buildExpansionCompletionPrompt(contract) {
  return [
    "You are completing an academic EXPAND revision that did not meet its binding development contract.",
    `The original source contains ${contract.source_words} words. The completed revision MUST contain at least ${contract.minimum_candidate_words} words and should ordinarily fall between ${contract.target_candidate_words} and ${contract.maximum_candidate_words} words.`,
    "Work from the CURRENT CANDIDATE rather than reverting to the source. Preserve its useful reconstruction while adding the missing intellectual development across several appropriate paragraphs.",
    "Use the ORIGINAL SOURCE as the sole authority for facts, citations, numbers, variables, methods, study stage, scope, modality, causality and argumentative meaning.",
    "Develop reasoning already present or directly entailed by the source: unpack conceptual relationships, creditor or managerial logic already stated, boundary conditions, evidential relevance, methodological implications, distinctions between measures, and transitions between argumentative levels.",
    "Do not invent empirical evidence, citations, statistics, findings, named examples or causal mechanisms absent from the source. Do not repeat sentences, add generic significance claims, inflate synonyms, or append filler merely to reach the count.",
    "Distribute the added development; do not place the entire deficit in one paragraph. Retain headings and the source's section purposes.",
    "A response below the mandatory minimum is invalid.",
    "Return one JSON object only: {\"revised_text\":\"the complete expanded manuscript\",\"edit_summary\":{\"kept\":0,\"micro_edits\":0,\"sentence_restructures\":0,\"split_or_merge\":0,\"paragraph_reorders\":0,\"flags_for_author\":[]},\"additional_inputs\":[]}",
  ].join("\n");
}

async function completeExpansionContract({ sourceText, candidate, contract, maxTokens }) {
  let selected = candidate;
  const attempts = [];
  for (let attempt = 1; attempt <= 1 && !lengthContractSatisfied(selected.revised_text, contract); attempt += 1) {
    const currentWords = manuscriptWordCount(selected.revised_text);
    const deficit = Math.max(0, contract.minimum_candidate_words - currentWords);
    const payload = [
      `CURRENT WORD COUNT: ${currentWords}`,
      `MANDATORY MINIMUM WORD COUNT: ${contract.minimum_candidate_words}`,
      `CURRENT DEFICIT: ${deficit} words`,
      "",
      "ORIGINAL SOURCE (factual and argumentative authority):",
      sourceText,
      "",
      "CURRENT CANDIDATE (develop this version):",
      selected.revised_text,
    ].join("\n");
    const recovered = await runModelPass({
      systemPrompt: buildExpansionCompletionPrompt(contract),
      sourceText: payload,
      maxTokens,
    });
    const recoveredPreservation = auditPreservation(sourceText, recovered.revised_text, extractProtectedSpans(sourceText), { lengthPreference: "expand" });
    const recoveredWords = manuscriptWordCount(recovered.revised_text);
    const hardFailure = classifyPreservationRelease(recoveredPreservation).hard_failure;
    const improved = !hardFailure && recoveredWords > currentWords;
    attempts.push({ attempt, current_words: currentWords, recovered_words: recoveredWords, preservation_hard_failure: hardFailure, selected: improved });
    if (improved) selected = recovered;
  }
  return {
    candidate: selected,
    attempts,
    satisfied: lengthContractSatisfied(selected.revised_text, contract),
  };
}

function nearSourceExamples(quality) {
  const examples = quality.near_source_examples || [];
  if (!examples.length) return "";
  return [
    "Examples of sentences still too structurally close to the source:",
    ...examples.map((item, i) => `${i + 1}. CURRENT: ${item.revised}\n   SOURCE: ${item.source}`),
  ].join("\n");
}

function qualityCorrectionBlock(quality) {
  const issueLines = (quality.reasons || []).map((reason) => `- ${reason}`).join("\n");
  return [
    "",
    "--- AGGRESSIVE REWRITE QUALITY CORRECTION ---",
    "The previous attempt failed one or more structural/cadence quality checks inside material that the diagnostic plan actually selected for substantive reconstruction.",
    issueLines || "- The previous attempt did not meet the required quality profile.",
    nearSourceExamples(quality),
    "Rewrite again from the ORIGINAL source below, not by cosmetically editing the previous attempt.",
    "Where concrete structural work was diagnosed, change information packaging: vary which idea becomes the grammatical subject, move causes/conditions/qualifications to different positions, and redistribute propositions across neighbouring sentences when the argument supports it.",
    "Do not equate stronger rewriting with lexical elevation. Prefer ordinary, precise academic verbs over newly invented abstract noun phrases; do not convert straightforward wording into dense noun stacks merely to make the revision look more scholarly.",
    "Do not solve structural similarity by chopping prose into strings of short sentences, and do not solve it by making every sentence long, compressed and perfectly balanced. Cadence should follow the reasoning.",
    "A clean source sentence may remain or be only lightly changed when the plan does not require reconstruction. Rewrite distance is evidence, not an objective.",
    "Do not introduce second-person address, contractions, decorative idioms, journalistic phrasing, slang, fake roughness or random errors.",
    "Preserve the argument, citations, numbers, quotations, technical terms and factual relationships exactly. Do not add any fact or citation.",
  ].filter(Boolean).join("\n");
}

function finalRescueBlock(quality) {
  const issueLines = (quality.reasons || []).map((reason) => `- ${reason}`).join("\n");
  return [
    "",
    "--- FINAL ACADEMIC CADENCE AND STRUCTURE RESCUE ---",
    "A second rewrite still fails one or more quality checks.",
    issueLines || "- Residual cadence/register/structural problems remain.",
    nearSourceExamples(quality),
    "The user message for this pass contains both the ORIGINAL SOURCE and the CURRENT CANDIDATE REVISION.",
    "Repair the CURRENT CANDIDATE. Use the original as factual/citation authority and as evidence of the writer's lexical register; do not automatically restore or automatically reject its wording.",
    "Where a candidate sentence still follows a diagnosed unwanted source skeleton, rebuild it from the underlying proposition. Where the candidate instead became more abstract, compressed or over-polished than the source, simplify it and restore ordinary academic verbs and natural asymmetry.",
    "If phrase overlap remains high, change information packaging only where the plan requires it. If lexical formality or nominalisation has inflated, reduce that drift rather than chasing more textual distance.",
    "If the prose is choppy, merge adjacent statements that belong to one analytical unit. If it is uniformly dense, allow concise descriptive or evidential sentences where the reasoning permits them.",
    "Maintain defensible postgraduate academic prose without turning every paragraph into a mini-abstract or every sentence into a polished summary statement.",
    "Every citation, number, quotation, acronym, technical term and factual relationship from the original must remain correct and no new factual content may be introduced.",
  ].filter(Boolean).join("\n");
}

function qualityScore(q) {
  const shortPenalty = Math.max(0, (q.short_sentence_ratio || 0) - 0.27);
  const registerPenalty = (q.direct_address_introduced || 0) * 0.2 + (q.formality_risks_introduced || 0) * 0.15;
  const cadencePenalty = Math.max(0, 14 - (q.mean_sentence_length || 14)) / 14;
  const nearSourcePenalty = Math.max(0, (q.near_source_sentence_ratio || 0) - 0.30);
  return q.five_gram_overlap + q.unchanged_sentence_ratio + nearSourcePenalty + shortPenalty + registerPenalty + cadencePenalty;
}

function measuredLanguagePenalty(text, family) {
  if (!family) return 0;
  const fp = measureLanguageFingerprint(text);
  const deviation = assessLanguageDeviation(fp, family);
  if (!deviation.available || !Number.isFinite(deviation.family_alignment_score)) return 0;
  return (1 - deviation.family_alignment_score) * 0.25;
}

function candidateScore(q, text, family, iterativeQuality) {
  return qualityScore(q) + measuredLanguagePenalty(text, family) + iterativeRegularisationPenalty(iterativeQuality);
}

function qualityOptions(analysis, humanCadence) {
  return {
    humanCadence,
    protectedSpans: analysis.protectedSpans,
  };
}

function plannedSubstantiveRatio(plan) {
  const entries = Object.entries(plan?.summary || {});
  const total = entries.reduce((sum, [, count]) => sum + (Number(count) || 0), 0) || 1;
  const substantive = entries.reduce((sum, [level, count]) => sum + (SUBSTANTIVE_PLAN_LEVELS.has(level) ? Number(count) || 0 : 0), 0);
  return substantive / total;
}

function qualityNeedsCorrection(naturalisationLevel, transformationQuality, iterativeQuality, plan) {
  const substantiveRatio = plannedSubstantiveRatio(plan);
  // Aggressive quality gates only apply when diagnosis already placed a material
  // part of the passage inside substantive reconstruction scope. This prevents
  // unchanged-sentence/phrase-overlap thresholds from forcing needless rewrites.
  return naturalisationLevel === "aggressive" && substantiveRatio >= 0.30 && (!transformationQuality.passed || iterativeQuality?.blocking);
}

function wholeDocumentContextBlock(documentContext) {
  if (!documentContext) return "";
  return [
    "",
    "--- WHOLE-DOCUMENT INTELLECTUAL CONTEXT (Long Document only) ---",
    "This chunk belongs to a larger manuscript that has already been read as a whole. Use the map below to understand what this local passage must contribute to the complete argument. This context grants NO additional rewrite authority. The local diagnostic plan still decides what may change.",
    "Carry forward intellectual dependencies, variables, definitions, methods, study stage and unresolved argument needs. Do NOT carry forward sentence rhythm, transition formulas, preferred paragraph closures or other stylistic templates from previous chunks.",
    "If the whole-document map identifies an evidence need, do not invent evidence. Leave that need for the Research Evidence Bank/researcher workflow unless the evidence is already present in the supplied source/context.",
    JSON.stringify(documentContext, null, 2),
  ].join("\n");
}

export async function rewrite({
  sourceText,
  styleFilters,
  rewriteIntensity,
  grammarIntensity,
  lengthPreference,
  naturalisation,
  revisionPurpose,
  precedingContext,
  followingContext,
  documentGlossary,
  documentContext,
  rewriteLineage,
  priorCandidateHistory,
  minimumExpansionWords,
  detectorFeedback,
}) {
  const naturalisationLevel = NATURALISATION_LEVELS.has(naturalisation) ? naturalisation : "faithful";
  const effectiveRevisionPurpose = normalizeRevisionPurpose(revisionPurpose);
  const outputTokenBudget = modelOutputTokenBudget(sourceText, effectiveRevisionPurpose);
  const lengthContract = buildLengthContract({ sourceText, preference: lengthPreference, minimumExpansionWords });
  const lineage = normaliseRewriteLineage(rewriteLineage, sourceText);
  const analysis = analyse({
    sourceText,
    styleFilters,
    rewriteIntensity,
    grammarIntensity,
    lengthPreference,
    naturalisation: naturalisationLevel,
    detectorFeedback,
  });

  const humanCadence = analysis.diagnostics.cadence_deviation?.family || null;
  const qOptions = qualityOptions(analysis, humanCadence);
  const measuredLanguageFamily = analysis.measured_language_family;
  const substantiveRatio = plannedSubstantiveRatio(analysis.plan);
  const qualityGateEnforced = naturalisationLevel === "aggressive" && substantiveRatio >= 0.30;
  // One interactive request gets one full-manuscript generation. Repeating the
  // same large Deep prompt produced the same historical local optimum while
  // multiplying latency and cost. Completed-output defects are handled later by
  // the paragraph-targeted residual stage, where unaffected prose stays locked.
  const fullDocumentQualityRecoveryAllowed = false;

  const systemPrompt = buildSystemPrompt({
    sourceText,
    minimumExpansionWords,
    styleProfile: analysis.style_profile_used.effective,
    protectedSpans: analysis.protectedSpans,
    plan: analysis.plan,
    grammarIntensity: grammarIntensity || "standard",
    lengthPreference,
    rhetoricalLedger: buildRhetoricalLedger(sourceText),
    precedingContext,
    followingContext,
    documentGlossary,
    humanCadence,
    naturalisation: naturalisationLevel,
    revisionPurpose: effectiveRevisionPurpose,
  }) + wholeDocumentContextBlock(documentContext) + buildIterativeRewriteDirective({ sourceText, rewriteLineage: lineage }) + candidateHistoryPromptBlock(priorCandidateHistory) + detectorFeedbackPromptBlock(detectorFeedback);

  let parsed = await runModelPass({ systemPrompt, sourceText, maxTokens: outputTokenBudget });
  let expansionRecovery = { required: lengthContract.mode === "expand", attempted: false, attempts: [], contract: lengthContract };
  let transformationQuality = assessTransformationQuality(sourceText, parsed.revised_text, naturalisationLevel, qOptions);
  let iterativeQuality = assessIterativeRegularisation({
    sourceText,
    candidateText: parsed.revised_text,
    rewriteLineage: lineage,
  });
  let qualityRetryUsed = false;
  let rescueRetryUsed = false;
  let qualityRetryError = null;
  let rescueRetryError = null;
  let responseRepairUsed = Boolean(parsed.__response_repair_used);
  let responseEnvelopeRecovered = Boolean(parsed.__response_envelope_recovered);
  let firstAttemptQuality = null;
  let firstAttemptIterativeQuality = null;
  let preRescueQuality = null;
  let preRescueIterativeQuality = null;

  if (
    fullDocumentQualityRecoveryAllowed &&
    qualityNeedsCorrection(naturalisationLevel, transformationQuality, iterativeQuality, analysis.plan)
  ) {
    firstAttemptQuality = transformationQuality;
    firstAttemptIterativeQuality = iterativeQuality;
    qualityRetryUsed = true;
    try {
      const corrected = await runModelPass({
        systemPrompt: systemPrompt + qualityCorrectionBlock(transformationQuality) + iterativeCorrectionBlock(iterativeQuality),
        sourceText,
        maxTokens: outputTokenBudget,
      });
      const correctedQuality = assessTransformationQuality(sourceText, corrected.revised_text, naturalisationLevel, qOptions);
      const correctedIterativeQuality = assessIterativeRegularisation({
        sourceText,
        candidateText: corrected.revised_text,
        rewriteLineage: lineage,
      });
      responseRepairUsed = responseRepairUsed || Boolean(corrected.__response_repair_used);
      responseEnvelopeRecovered = responseEnvelopeRecovered || Boolean(corrected.__response_envelope_recovered);

      const correctedPasses = correctedQuality.passed && !correctedIterativeQuality.blocking;
      const correctedIsBetter = correctedPasses || candidateScore(correctedQuality, corrected.revised_text, measuredLanguageFamily, correctedIterativeQuality) < candidateScore(transformationQuality, parsed.revised_text, measuredLanguageFamily, iterativeQuality);
      if (correctedIsBetter) {
        parsed = corrected;
        transformationQuality = correctedQuality;
        iterativeQuality = correctedIterativeQuality;
      }
    } catch (err) {
      qualityRetryError = {
        code: err.code || err.healthState || "QUALITY_RETRY_FAILED",
        message: err.message || "Optional quality refinement failed.",
      };
    }
  }

  if (lengthContract.mode === "expand" && !lengthContractSatisfied(parsed.revised_text, lengthContract)) {
    const completed = await completeExpansionContract({
      sourceText,
      candidate: parsed,
      contract: lengthContract,
      maxTokens: outputTokenBudget,
    });
    parsed = completed.candidate;
    transformationQuality = assessTransformationQuality(sourceText, parsed.revised_text, naturalisationLevel, qOptions);
    iterativeQuality = assessIterativeRegularisation({
      sourceText,
      candidateText: parsed.revised_text,
      rewriteLineage: lineage,
    });
    responseRepairUsed = responseRepairUsed || Boolean(parsed.__response_repair_used);
    responseEnvelopeRecovered = responseEnvelopeRecovered || Boolean(parsed.__response_envelope_recovered);
    expansionRecovery = {
      required: true,
      attempted: true,
      attempts: completed.attempts,
      contract: lengthContract,
      completed: completed.satisfied,
      best_complete_candidate_retained: true,
      exhausted_without_empty_result: !completed.satisfied,
    };
  }

  if (
    fullDocumentQualityRecoveryAllowed &&
    !qualityRetryError &&
    qualityNeedsCorrection(naturalisationLevel, transformationQuality, iterativeQuality, analysis.plan)
  ) {
    preRescueQuality = transformationQuality;
    preRescueIterativeQuality = iterativeQuality;
    const candidateText = parsed.revised_text;
    const rescuePayload = [
      "ORIGINAL SOURCE (factual/citation authority):",
      sourceText,
      "",
      "CURRENT CANDIDATE REVISION (repair this prose; do not merely copy the source):",
      candidateText,
    ].join("\n");
    rescueRetryUsed = true;
    try {
      const rescued = await runModelPass({
        systemPrompt: systemPrompt + finalRescueBlock(transformationQuality) + iterativeCorrectionBlock(iterativeQuality),
        sourceText: rescuePayload,
        maxTokens: outputTokenBudget,
      });
      const rescuedQuality = assessTransformationQuality(sourceText, rescued.revised_text, naturalisationLevel, qOptions);
      const rescuedIterativeQuality = assessIterativeRegularisation({
        sourceText,
        candidateText: rescued.revised_text,
        rewriteLineage: lineage,
      });
      responseRepairUsed = responseRepairUsed || Boolean(rescued.__response_repair_used);
      responseEnvelopeRecovered = responseEnvelopeRecovered || Boolean(rescued.__response_envelope_recovered);

      const rescuedPasses = rescuedQuality.passed && !rescuedIterativeQuality.blocking;
      if (rescuedPasses || candidateScore(rescuedQuality, rescued.revised_text, measuredLanguageFamily, rescuedIterativeQuality) < candidateScore(transformationQuality, parsed.revised_text, measuredLanguageFamily, iterativeQuality)) {
        parsed = rescued;
        transformationQuality = rescuedQuality;
        iterativeQuality = rescuedIterativeQuality;
      }
    } catch (err) {
      rescueRetryError = {
        code: err.code || err.healthState || "RESCUE_RETRY_FAILED",
        message: err.message || "Optional final rescue failed.",
      };
    }
  }

  const preservation = auditPreservation(sourceText, parsed.revised_text, analysis.protectedSpans, { lengthPreference });
  const revisedLanguageFingerprint = measureLanguageFingerprint(parsed.revised_text);
  const revisedLanguageDeviation = assessLanguageDeviation(revisedLanguageFingerprint, measuredLanguageFamily);
  const sourceAlignment = analysis.diagnostics.measured_language_deviation?.family_alignment_score;
  const revisedAlignment = revisedLanguageDeviation?.family_alignment_score;
  const alignmentDelta = Number.isFinite(sourceAlignment) && Number.isFinite(revisedAlignment)
    ? Number((revisedAlignment - sourceAlignment).toFixed(3))
    : null;

  return {
    revised_text: parsed.revised_text,
    revision_purpose: effectiveRevisionPurpose,
    length_contract: {
      ...lengthContract,
      satisfied: lengthContractSatisfied(parsed.revised_text, lengthContract),
      recovery: expansionRecovery,
    },
    additional_inputs: ensureCollaborativeReviewInputs({
      sourceText,
      revisionPurpose: effectiveRevisionPurpose,
      modelInputs: normalizeAdditionalInputs(parsed.additional_inputs, effectiveRevisionPurpose),
    }),
    style_profile_used: analysis.style_profile_used,
    edit_summary: parsed.edit_summary,
    intervention_plan_summary: analysis.plan.summary,
    intervention_intent: analysis.plan.intent,
    paragraph_plan_summary: analysis.plan.paragraphSummary,
    planner_version: analysis.plan.plannerVersion,
    planner_scope_policy_version: analysis.plan.scopePolicyVersion || null,
    external_detector_feedback_execution: analysis.plan.externalFeedbackExecution || null,
    planner_sequence: analysis.plan.sequence,
    preservation,
    transformation_quality: {
      ...transformationQuality,
      enforced: qualityGateEnforced,
      full_document_quality_recovery_allowed: fullDocumentQualityRecoveryAllowed,
      selective_residual_recovery_preferred: true,
      substantive_plan_ratio: Number(substantiveRatio.toFixed(3)),
      corrective_retry_used: qualityRetryUsed,
      rescue_retry_used: rescueRetryUsed,
      corrective_retry_error: qualityRetryError,
      rescue_retry_error: rescueRetryError,
      first_attempt: firstAttemptQuality,
      pre_rescue_attempt: preRescueQuality,
    },
    iterative_rewrite_quality: {
      ...iterativeQuality,
      first_attempt: firstAttemptIterativeQuality,
      pre_rescue_attempt: preRescueIterativeQuality,
    },
    rewrite_lineage: {
      source_generation: lineage.source_generation,
      chained_from_prior_revision: lineage.chained_from_prior_revision,
      root_anchor_available: Boolean(lineage.root_source_text),
      root_source_text_exposed: false,
    },
    model_response_recovery: {
      syntax_repair_used: responseRepairUsed,
      envelope_recovery_used: responseEnvelopeRecovered,
      max_syntax_repair_attempts: 1,
    },
    language_quality: {
      measurement_version: revisedLanguageFingerprint.measurement_version,
      family_measurement_version: measuredLanguageFamily?.measurement_version || null,
      family_document_count: measuredLanguageFamily?.measured_document_count || 0,
      source_fingerprint: analysis.diagnostics.language_fingerprint,
      source_deviation: analysis.diagnostics.measured_language_deviation,
      revised_fingerprint: revisedLanguageFingerprint,
      revised_deviation: revisedLanguageDeviation,
      family_alignment_delta: alignmentDelta,
      note: "Family alignment is a descriptive academic-language diagnostic from the measured pilot corpus, not an AI-authorship score and not a hard acceptance target.",
    },
    diagnostics: analysis.diagnostics,
    detector_feedback_applied: detectorFeedback || null,
    model_notes: parsed.diagnostics_notes || "",
    naturalisation_applied: {
      level: naturalisationLevel,
      em_dash_ban: true,
      cadence_targeting: naturalisationLevel !== "off",
      syntactic_diversity: naturalisationLevel !== "off",
      texture_exemplar: naturalisationLevel === "aggressive",
      aggressive_keep_override: false,
      diagnosis_scoped_naturalisation: true,
      expand_is_development_permission_not_quota: true,
      transformation_quality_gate: qualityGateEnforced,
      academic_register_gate: qualityGateEnforced,
      protected_span_adjusted_overlap: qualityGateEnforced,
      near_source_sentence_gate: qualityGateEnforced,
      measured_language_family_guidance: naturalisationLevel !== "off",
      measured_language_soft_candidate_selection: qualityGateEnforced,
      final_academic_rescue: qualityGateEnforced,
      iterative_rewrite_guard: lineage.chained_from_prior_revision,
      iterative_regularisation_gate: lineage.chained_from_prior_revision && qualityGateEnforced,
      hierarchical_intent_planning: true,
      paragraph_discourse_planning: true,
      discourse_architecture_diagnostics: true,
      semantic_text_structure: true,
      scholarly_trace_preservation: true,
      evidence_assembled_reasoning_guidance: true,
      whole_document_context_used: Boolean(documentContext),
      response_syntax_recovery: true,
      human_family_measured_sources: humanCadence?.measuredSources ?? 0,
      measured_language_pilot_sources: measuredLanguageFamily?.measured_document_count ?? 0,
    },
    build: getBuildInfo(),
  };
}

