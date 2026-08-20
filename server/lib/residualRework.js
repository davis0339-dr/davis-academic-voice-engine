// Selective second-pass repair for residual discourse problems introduced or
// left unresolved by the first rewrite. Only diagnosed paragraph blocks are
// eligible for replacement; unaffected blocks are never regenerated.
//
// v5 extends completed-output recovery beyond paragraph choreography. Fluent
// academic prose can still fail when modern LLM-favoured machine language remains
// dense: editorial pivots, abstract signposting, polished binary qualifications,
// compressed synthesis frames and noun-heavy discourse management.

import { llmProvider } from "./llmProvider.js";
import { parseStructuredResponseText, buildJsonRepairSystemPrompt } from "./modelResponse.js";
import { parseTextStructure } from "./textStructure.js";
import { extractProtectedSpans } from "./protect.js";
import { auditPreservation } from "./preservation.js";
import { analyseResidualWriting } from "./residualDiagnostics.js";
import { splitSentences } from "./sentences.js";
import { auditOutputAcceptance, acceptanceImproved } from "./outputAcceptance.js";
import { MANDATORY_REVISION_GUARDRAILS } from "./promptContract.js";
import { repairPreservationCandidate } from "./preservationRepair.js";

function preservationPassed(p) {
  return Boolean(
    p?.numbers_ok &&
    p?.citations_ok &&
    p?.technical_terms_ok &&
    p?.quotes_ok &&
    p?.study_stage_ok !== false &&
    p?.rhetorical_semantic_ok !== false &&
    !p?.new_factual_claims_detected
  );
}

function normalise(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function shouldAcceptResidualCandidate({
  preservationOk,
  noResidualRegression,
  beforeScore,
  afterScore,
  beforeAcceptance,
  afterAcceptance,
}) {
  const riskImproved = afterScore < beforeScore;
  const riskMateriallyImproved = riskImproved && afterScore <= beforeScore - 3;
  const acceptanceBetter = acceptanceImproved(beforeAcceptance, afterAcceptance);
  const acceptanceCleared = afterAcceptance.status === "pass";
  const acceptanceNotWorse = Number(afterAcceptance.score || 0) >= Number(beforeAcceptance.score || 0);
  const beforeAcceptanceScore = Number(beforeAcceptance.score || 0);
  const afterAcceptanceScore = Number(afterAcceptance.score || 0);
  const veryLargeResidualGain = beforeScore >= 12 && afterScore <= Math.min(beforeScore - 15, Math.floor(beforeScore * 0.55));
  const acceptanceNearlyStable = afterAcceptanceScore >= beforeAcceptanceScore - 2;
  const beforeReasons = new Set(beforeAcceptance.reasons || []);
  const afterReasons = new Set(afterAcceptance.reasons || []);
  const newAcceptanceReasons = [...afterReasons].filter((reason) => !beforeReasons.has(reason));
  const afterHardFailures = afterAcceptance.hard_failures || [];
  const beforeDimensions = beforeAcceptance.dimensions || {};
  const afterDimensions = afterAcceptance.dimensions || {};
  const noMaterialAcceptanceRegression = (
    Number(afterDimensions.candidate_machine_pattern || 0) <= Number(beforeDimensions.candidate_machine_pattern || 0) + 0.03 &&
    Number(afterDimensions.candidate_machine_language || 0) <= Number(beforeDimensions.candidate_machine_language || 0) + 0.03 &&
    Number(afterDimensions.candidate_discourse_regularity || 0) <= Number(beforeDimensions.candidate_discourse_regularity || 0) + 0.03 &&
    Number(afterDimensions.source_dependence || 0) <= Number(beforeDimensions.source_dependence || 0) + 0.04 &&
    Number(afterDimensions.candidate_authorial_texture || 0) >= Number(beforeDimensions.candidate_authorial_texture || 0) - 0.05
  );
  const largeSafeResidualGain = (
    veryLargeResidualGain &&
    acceptanceNearlyStable &&
    noMaterialAcceptanceRegression &&
    newAcceptanceReasons.length === 0 &&
    afterHardFailures.length === 0
  );

  return Boolean(
    preservationOk &&
    noResidualRegression &&
    (
      acceptanceCleared ||
      acceptanceBetter ||
      (riskMateriallyImproved && acceptanceNotWorse) ||
      largeSafeResidualGain
    )
  );
}

function targetSignalLabels(diagnostics, target) {
  const sentenceSet = new Set(target.sentenceIndices || []);
  return (diagnostics.signals || [])
    .filter((signal) => (signal.sentenceIndices || []).some((i) => sentenceSet.has(i)))
    .map((signal) => ({ id: signal.id, interpretation: signal.interpretation, action: signal.action }));
}

function ordinarySentencesForTarget(text, diagnostics, target) {
  const sentences = splitSentences(text);
  const ordinary = new Set(diagnostics.ordinary_content_sentence_indices || []);
  return (target.sentenceIndices || [])
    .filter((index) => ordinary.has(index))
    .map((index) => sentences[index])
    .filter(Boolean);
}

function sourceReferenceForTarget(sourceStructure, target) {
  if (!Number.isInteger(target.paragraphOrdinal)) return null;
  return sourceStructure.blocks.find(
    (block) => block.paragraphOrdinal === target.paragraphOrdinal && (block.type === "paragraph" || block.type === "list_item")
  ) || null;
}

function replaceBlocksSequentially(candidateText, replacements, structure) {
  let out = String(candidateText || "").replace(/\r\n?/g, "\n");
  const ordered = [...replacements].sort((a, b) => b.block_index - a.block_index);

  for (const replacement of ordered) {
    const block = structure.blocks[replacement.block_index];
    if (!block || block.type !== "paragraph") continue;
    const oldText = block.text;
    const start = out.lastIndexOf(oldText);
    if (start < 0) continue;
    out = out.slice(0, start) + replacement.revised_text.trim() + out.slice(start + oldText.length);
  }
  return out;
}

function acceptanceTargetBlockIndices(candidateText, candidateStructure, acceptance) {
  const wantedParagraphIndices = new Set(acceptance?.target_paragraph_indices || []);
  if (!wantedParagraphIndices.size) return [];
  const rawParagraphs = String(candidateText || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((text, index) => ({ index, text: text.trim() }))
    .filter((row) => row.text);
  const targetTexts = rawParagraphs
    .filter((row) => wantedParagraphIndices.has(row.index))
    .map((row) => normalise(row.text));
  const found = [];
  for (const targetText of targetTexts) {
    const index = candidateStructure.blocks.findIndex((block) => block.type === "paragraph" && normalise(block.text) === targetText);
    if (index >= 0) found.push(index);
  }
  return [...new Set(found)];
}

export function prioritiseResidualBlockIndices(forensicBlockIndices = [], legacyBlockIndices = [], maxBlocks = 8) {
  return [...new Set([...forensicBlockIndices, ...legacyBlockIndices])].slice(0, maxBlocks);
}

function machineForensicLabels(acceptance, blockIndex, candidateStructure) {
  const block = candidateStructure.blocks[blockIndex];
  if (!block) return [];
  const reasons = acceptance?.reasons || [];
  const choreography = acceptance?.candidate_machine_pattern?.choreography || {};
  const discourse = acceptance?.candidate_machine_pattern?.discourse_regularity || {};
  const machineLanguage = acceptance?.candidate_machine_pattern?.machine_language || {};
  const labels = [];

  if (
    reasons.includes("machine_pattern_reduction_insufficient") ||
    reasons.includes("high_machine_pattern_residual") ||
    reasons.includes("machine_pattern_regression")
  ) {
    labels.push({
      id: "machine_pattern_residual",
      interpretation: "The completed candidate still exhibits material machine-pattern regularity after the first rewrite.",
      action: "Change the paragraph's rhetorical packaging where needed; do not merely substitute synonyms or polish sentences independently.",
    });
  }

  if (
    reasons.includes("machine_language_residual") ||
    reasons.includes("high_machine_language_residual") ||
    reasons.includes("machine_language_reduction_insufficient") ||
    reasons.includes("machine_language_regression")
  ) {
    labels.push({
      id: "modern_machine_language_density",
      interpretation: "The paragraph contributes to a document-level concentration of polished LLM-favoured academic language: editorial pivots, abstract issue-framing, binary qualification frames, compressed synthesis or noun-heavy discourse management.",
      action: "Preserve the substantive judgement but make it more direct. Remove sentences that mainly announce complexity, conditionality, significance or the next move; reduce repeated 'not X but Y' staging; prefer actors, evidence and direct verbs where the technical meaning permits.",
    });
  }

  if (
    reasons.includes("high_discourse_regularity_residual") ||
    reasons.includes("discourse_regularity_reduction_insufficient") ||
    reasons.includes("discourse_regularity_regression") ||
    Number(discourse.score || 0) >= 0.55
  ) {
    labels.push({
      id: "calibrated_discourse_regularity",
      interpretation: "The richer cross-paragraph audit still finds repeated paragraph-job announcement, bounded completion, serial evidence reporting, immediate interpretation or micro-signpost choreography.",
      action: "Let this paragraph follow its local scholarly function rather than a completed template. Evidence may lead, a condition may remain unresolved, or interpretation may carry across a paragraph boundary when the argument warrants it.",
    });
  }

  if (Number(machineLanguage?.score || 0) >= 0.38) {
    const relevantSignals = (machineLanguage.signals || []).slice(0, 3);
    for (const signal of relevantSignals) {
      labels.push({
        id: signal.issue || "machine_language_signal",
        interpretation: signal.interpretation,
        action: signal.action,
      });
    }
  }

  if (Number(choreography.dominant_signature_ratio || 0) >= 0.45) {
    labels.push({
      id: "repeated_paragraph_signature",
      interpretation: "Multiple narrative paragraphs perform their claim/evidence/interpretation work in the same sequence.",
      action: "Let this paragraph's evidence and reasoning determine its own sequence rather than repeating the dominant document template.",
    });
  }
  if (Number(choreography.closure_ratio || 0) >= 0.35) {
    labels.push({
      id: "tidy_closure_recurrence",
      interpretation: "Narrative paragraphs too often end with an explicit polished synthesis or implication sentence.",
      action: "Keep a closing synthesis only when the argument requires it; otherwise allow the evidence, qualification, or unresolved tension to carry forward naturally.",
    });
  }
  if (Number(choreography.evidence_position_consistency || 0) >= 0.62) {
    labels.push({
      id: "predictable_evidence_position",
      interpretation: "Evidence repeatedly arrives at similar positions within paragraphs.",
      action: "Repackage the local reasoning so evidence can lead, interrupt, qualify, or follow a claim according to its argumentative role.",
    });
  }
  if (reasons.includes("source_skeleton_dependence_high")) {
    labels.push({
      id: "source_skeleton_dependence",
      interpretation: "The candidate remains too dependent on the source sentence/discourse skeleton for the authorised treatment.",
      action: "Rebuild the local proposition packaging without changing the researcher's meaning, evidence, qualifications, or technical decisions.",
    });
  }
  if (reasons.includes("proposition_echo_introduced") || reasons.includes("proposition_echo_residual")) {
    labels.push({
      id: "reconstruction_retention_duplication",
      interpretation: "This block is part of a sentence- or paragraph-level source-plus-reconstruction echo. The same intellectual contribution appears more than once.",
      action: "Coordinate with the neighbouring target block so each distinct proposition, qualification, citation and rhetorical function appears once. Do not retain an original paragraph beside its reconstructed replacement.",
    });
  }
  return labels;
}

export function buildResidualSystemPrompt() {
  return `You are performing a SELECTIVE COMPLETED-OUTPUT RECOVERY on an already revised academic passage.

This is not a fresh rewrite. Only the paragraph blocks supplied in TARGETS may change. Every other paragraph is locked and will be reinserted verbatim by the server.

Objective: reduce the specific residual writing-quality, machine-language and discourse-regularity risks supplied for each target while preserving the argument, factual relationships, authorial stance, examples, context, citations, numbers, quotations, technical terms and macro-order.

MANDATORY PRESERVATION CONTRACT (higher priority than the residual style lessons below):
${MANDATORY_REVISION_GUARDRAILS.join("\n")}

The most important distinction is this: good grammar, clarity, sophistication and coherence are not sufficient. A candidate can be academically excellent and still fail because its language is visibly machine-shaped or because its paragraph choreography, evidence placement, sentence roles and closures remain too mechanically regular.

Important lessons from prior testing:
- Different is not automatically better. Do not rewrite merely to maximise distance from the source.
- Do not perform synonym substitution as a substitute for discourse reconstruction.
- Modern machine language is often polished rather than clichéd. Look beyond phrases such as "plays a crucial role". Repair repeated editorial pivots, abstract issue-framing, compressed synthesis, noun-heavy signposting and highly curated qualification patterns.
- Do not repeatedly stage distinctions as "not X, but Y", "not merely", "more than", "does not imply", or similarly elegant reversals when the distinction can be carried directly by evidence or explanation. Keep such constructions where they are genuinely the clearest form.
- Do not open successive paragraphs with abstract announcements such as complexity, conditionality, variation, assessment, difficulty, significance or context merely to tell the reader what the paragraph will now do.
- Delete or absorb sentences whose main function is to announce that something is complex, conditional, instructive, important, useful, unresolved or more specific when the surrounding argument already demonstrates that point.
- Prefer concrete scholarly actors and direct verbs where possible: firms borrow, creditors price, boards monitor, evidence contradicts, results vary. Do not force directness when a technical construct genuinely requires abstraction.
- Do not make every paragraph follow claim -> evidence -> interpretation -> synthesis.
- Do not append a polished summary/implication sentence simply to make every paragraph feel complete.
- Let evidence sometimes lead, qualify, interrupt or follow a claim when its actual argumentative role warrants it.
- Preserve productive asymmetry: one important study may need two explanatory sentences while another may need only a clause; do not give every source equal rhetorical packaging.
- Do not convert direct verbs and ordinary academic sentences into abstract noun-led formulations merely to sound scholarly.
- Avoid nominalisation pressure such as repeated openings built around "recognition", "realisation", "development", "implementation", "conceptual evolution" or similar abstract noun phrases when a direct subject and verb are clearer.
- Reduce discourse-management sentences that mainly announce what was learned, why a distinction matters, or what comes next without adding a substantive proposition.
- Reduce rhetorical valuation that repeatedly labels points as major, crucial, consequential or promising when the surrounding evidence already demonstrates their importance.
- Do not narrate an intellectual journey as a perfectly tidy chain of breakthrough -> lesson -> next stage unless the supplied material genuinely requires that chronology.
- Preserve useful simple sentences. A short, ordinary, content-bearing sentence is not a defect and must not be "upgraded" merely because it is simple.
- Preserve first-person or authorial stance where it genuinely belongs to the supplied text. Do not replace a personal but academically defensible statement with an impersonal slogan.
- Keep source-defined taxonomies and product modes when the categories are substantive. Remove only rhetorical packaging that creates categories for neatness rather than meaning.
- Formal academic artefacts such as purpose statements, research questions and hypotheses are not targets merely because they are formulaic.
- Do not add facts, citations, studies, context, examples or claims that are not already present.
- Remove reconstruction-plus-retention echoes across both sentences and adjacent paragraphs. When an original paragraph and its reconstructed replacement both survive, rebuild the two target blocks as complementary reasoning units so each distinct proposition, qualification, citation and rhetorical function appears once. Do not preserve the source paragraph beside its replacement, and do not delete a genuinely distinct contribution merely because vocabulary overlaps.
- HARD_PROTECTED_SPANS supplied for a block must remain verbatim in that block's revised text.

Return JSON only in this exact shape:
{
  "replacements": [
    {"block_index": 0, "revised_text": "..."}
  ],
  "diagnostics_notes": "brief note"
}

Return exactly one replacement for every supplied TARGET block_index and no replacements for any other block.`;
}

async function callResidualModel(payload) {
  const first = await llmProvider.callAnthropic({
    system: buildResidualSystemPrompt(),
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
    maxTokens: 4096,
  });

  let parsed = parseStructuredResponseText(first.text);
  let repairUsed = false;
  if (!parsed.ok) {
    const repair = await llmProvider.callAnthropic({
      system: buildJsonRepairSystemPrompt(),
      messages: [{ role: "user", content: first.text }],
      maxTokens: 4096,
    });
    parsed = parseStructuredResponseText(repair.text);
    repairUsed = true;
  }
  if (!parsed.ok) {
    const err = new Error(`Residual rework response was not valid JSON: ${parsed.error?.message || "unknown parse error"}`);
    err.code = "INVALID_RESIDUAL_RESPONSE";
    throw err;
  }

  const result = parsed.parsed;
  if (!Array.isArray(result.replacements)) {
    const err = new Error("Residual rework response is missing replacements array.");
    err.code = "INVALID_RESIDUAL_SCHEMA";
    throw err;
  }
  return { result, repairUsed };
}

export async function selectiveResidualRework({
  sourceText,
  candidateText,
  maxBlocks = 8,
  styleFilters = {},
  rewriteIntensity = "auto",
  naturalisation = "faithful",
  planSummary = {},
  lengthPreference = "auto",
}) {
  const sourceBaseline = analyseResidualWriting(sourceText);
  const before = analyseResidualWriting(candidateText);
  const sourceScore = Number(sourceBaseline.metrics.total_risk_score || 0);
  const beforeScore = Number(before.metrics.total_risk_score || 0);
  const candidateWorseThanSource = beforeScore > sourceScore + 2;
  const beforeAcceptance = auditOutputAcceptance({
    sourceText,
    candidateText,
    styleFilters,
    rewriteIntensity,
    naturalisation,
    planSummary,
    lengthPreference,
  });

  const candidateStructure = parseTextStructure(candidateText);
  const sourceStructure = parseTextStructure(sourceText);
  const forensicBlockIndices = acceptanceTargetBlockIndices(candidateText, candidateStructure, beforeAcceptance);
  const legacyBlockIndices = before.target_blocks.map((target) => target.blockIndex);
  // Completed-output failures take priority over legacy stylistic targets. A
  // near-copy paragraph or source-plus-reconstruction duplicate must not be
  // displaced from the finite recovery budget by lower-value cadence signals.
  const targetBlockIndices = prioritiseResidualBlockIndices(forensicBlockIndices, legacyBlockIndices, maxBlocks);
  const acceptanceNeedsRecovery = beforeAcceptance.status !== "pass" && forensicBlockIndices.length > 0;
  const shouldAttempt = targetBlockIndices.length > 0 && (before.should_rework || candidateWorseThanSource || acceptanceNeedsRecovery);

  if (!shouldAttempt) {
    return {
      attempted: false,
      accepted: false,
      reason: beforeAcceptance.status !== "pass"
        ? "Completed-output acceptance still requires review, but no paragraph met the safe local-target threshold. The candidate is retained and must not be reported as internally cleared."
        : candidateWorseThanSource
          ? "The candidate scored worse than the source baseline, but no paragraph met the minimum block-target threshold for safe local rework."
          : "No residual block met the selective-rework threshold.",
      revised_text: candidateText,
      source_baseline: sourceBaseline,
      source_risk_score: sourceScore,
      candidate_risk_score: beforeScore,
      candidate_worse_than_source: candidateWorseThanSource,
      before,
      after: before,
      output_acceptance_before: beforeAcceptance,
      output_acceptance_after: beforeAcceptance,
      target_blocks: [],
      response_repair_used: false,
    };
  }

  const legacyTargetsByBlock = new Map(before.target_blocks.map((target) => [target.blockIndex, target]));
  const targets = targetBlockIndices.map((blockIndex) => {
    const candidateBlock = candidateStructure.blocks[blockIndex];
    const legacyTarget = legacyTargetsByBlock.get(blockIndex) || {
      blockIndex,
      paragraphOrdinal: candidateBlock?.paragraphOrdinal,
      sentenceIndices: [],
      text: candidateBlock?.text || "",
    };
    const sourceBlock = sourceReferenceForTarget(sourceStructure, legacyTarget);
    const protectedSpans = extractProtectedSpans(sourceBlock?.text || candidateBlock?.text || "");
    const residualSignals = [
      ...targetSignalLabels(before, legacyTarget),
      ...machineForensicLabels(beforeAcceptance, blockIndex, candidateStructure),
    ];
    return {
      block_index: blockIndex,
      candidate_text: candidateBlock?.text || legacyTarget.text,
      source_reference: sourceBlock?.text || null,
      residual_signals: residualSignals,
      ordinary_content_sentences_to_preserve_when_possible: ordinarySentencesForTarget(candidateText, before, legacyTarget),
      hard_protected_spans: protectedSpans,
    };
  });

  const { result, repairUsed } = await callResidualModel({
    instruction: "Revise only the target paragraphs. Preserve meaning and hard protected spans. Reduce local residual risks, modern machine-language density and completed-output discourse regularity without over-formalising the prose. Judge success by argument-governed authorial texture, not by synonym distance, detector gaming or cosmetic polish.",
    source_risk_score: sourceScore,
    candidate_risk_score: beforeScore,
    candidate_worse_than_source: candidateWorseThanSource,
    output_acceptance: {
      status: beforeAcceptance.status,
      score: beforeAcceptance.score,
      reasons: beforeAcceptance.reasons,
      dimensions: beforeAcceptance.dimensions,
      choreography: beforeAcceptance.candidate_machine_pattern?.choreography,
      discourse_regularity: beforeAcceptance.candidate_machine_pattern?.discourse_regularity,
      machine_language: beforeAcceptance.candidate_machine_pattern?.machine_language,
    },
    targets,
  });

  const expected = new Set(targets.map((target) => target.block_index));
  const replacements = result.replacements
    .filter((row) => Number.isInteger(row?.block_index) && expected.has(row.block_index) && typeof row.revised_text === "string" && row.revised_text.trim())
    .map((row) => ({ block_index: row.block_index, revised_text: row.revised_text }));

  if (replacements.length !== expected.size || new Set(replacements.map((row) => row.block_index)).size !== expected.size) {
    return {
      attempted: true,
      accepted: false,
      reason: "Completed-output recovery did not return exactly one valid replacement for each target block.",
      revised_text: candidateText,
      source_baseline: sourceBaseline,
      source_risk_score: sourceScore,
      candidate_risk_score: beforeScore,
      candidate_worse_than_source: candidateWorseThanSource,
      before,
      after: before,
      output_acceptance_before: beforeAcceptance,
      output_acceptance_after: beforeAcceptance,
      target_blocks: targets.map((target) => target.block_index),
      response_repair_used: repairUsed,
    };
  }

  const reworkedText = replaceBlocksSequentially(candidateText, replacements, candidateStructure);
  let recoveredText = reworkedText;
  let preservation = auditPreservation(sourceText, recoveredText, extractProtectedSpans(sourceText), { lengthPreference });
  let residualPreservationRepair = { attempted: false, passed: false };

  // An otherwise valuable residual reconstruction must not be discarded merely
  // because the local pass displaced a citation, qualification or rhetorical
  // function. Repair the completed residual candidate once, then subject it to
  // the same preservation and independent acceptance gates. The original first
  // candidate remains the fallback if repair is unsafe or unhelpful.
  if (!preservationPassed(preservation)) {
    try {
      const repaired = await repairPreservationCandidate({
        sourceText,
        candidateResult: { revised_text: recoveredText, preservation },
        lengthPreference,
      });
      residualPreservationRepair = repaired.preservation_repair || { attempted: true, passed: false };
      if (residualPreservationRepair.passed) {
        recoveredText = repaired.revised_text;
        preservation = repaired.preservation;
      }
    } catch (error) {
      residualPreservationRepair = {
        attempted: true,
        passed: false,
        error: { code: error.code || error.healthState || "RESIDUAL_PRESERVATION_REPAIR_FAILED", message: error.message || "Residual preservation repair failed." },
      };
    }
  }

  const after = analyseResidualWriting(recoveredText);
  const afterScore = Number(after.metrics.total_risk_score || 0);
  const noResidualRegression = afterScore <= Math.max(beforeScore + 1, sourceScore + 2);
  const preservationOk = preservationPassed(preservation);
  const afterAcceptance = auditOutputAcceptance({
    sourceText,
    candidateText: recoveredText,
    styleFilters,
    rewriteIntensity,
    naturalisation,
    planSummary,
    lengthPreference,
  });
  const accepted = shouldAcceptResidualCandidate({
    preservationOk,
    noResidualRegression,
    beforeScore,
    afterScore,
    beforeAcceptance,
    afterAcceptance,
  });

  return {
    attempted: true,
    accepted,
    reason: accepted
      ? `Selective completed-output recovery improved the candidate while preserving protected content. Residual risk ${beforeScore} → ${afterScore}; acceptance ${beforeAcceptance.score} → ${afterAcceptance.score} (${afterAcceptance.status}).`
      : !preservationOk
        ? "Completed-output recovery was rejected because factual/preservation safeguards failed."
        : !noResidualRegression
          ? "Completed-output recovery was rejected because local residual risk materially regressed."
          : `Completed-output recovery did not materially improve the independent acceptance audit (${beforeAcceptance.score} → ${afterAcceptance.score}); the prior candidate was retained.`,
    revised_text: accepted ? recoveredText : candidateText,
    source_baseline: sourceBaseline,
    source_risk_score: sourceScore,
    candidate_risk_score: beforeScore,
    after_risk_score: afterScore,
    candidate_worse_than_source: candidateWorseThanSource,
    before,
    after: accepted ? after : before,
    attempted_after: after,
    preservation: accepted ? preservation : null,
    attempted_preservation: preservation,
    residual_preservation_repair: residualPreservationRepair,
    output_acceptance_before: beforeAcceptance,
    output_acceptance_after: accepted ? afterAcceptance : beforeAcceptance,
    attempted_output_acceptance_after: afterAcceptance,
    target_blocks: targets.map((target) => target.block_index),
    response_repair_used: repairUsed,
    diagnostics_notes: result.diagnostics_notes || "",
  };
}

