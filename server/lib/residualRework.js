// Selective second-pass repair for residual discourse problems introduced or
// left unresolved by the first rewrite. Only diagnosed paragraph blocks are
// eligible for replacement; unaffected blocks are never regenerated.

import { llmProvider } from "./llmProvider.js";
import { parseStructuredResponseText, buildJsonRepairSystemPrompt } from "./modelResponse.js";
import { parseTextStructure } from "./textStructure.js";
import { extractProtectedSpans } from "./protect.js";
import { auditPreservation } from "./preservation.js";
import { analyseResidualWriting } from "./residualDiagnostics.js";
import { splitSentences } from "./sentences.js";

function preservationPassed(p) {
  return Boolean(
    p?.numbers_ok &&
    p?.citations_ok &&
    p?.technical_terms_ok &&
    p?.quotes_ok &&
    p?.study_stage_ok !== false &&
    !p?.new_factual_claims_detected
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

function buildResidualSystemPrompt() {
  return `You are performing a SELECTIVE RESIDUAL REWORK on an already revised academic passage.

This is not a fresh rewrite. Only the paragraph blocks supplied in TARGETS may change. Every other paragraph is locked and will be reinserted verbatim by the server.

Objective: reduce the specific residual writing-quality risks supplied for each target while preserving the argument, factual relationships, authorial stance, examples, context, citations, numbers, quotations, technical terms and macro-order.

Important lessons from prior testing:
- Different is not automatically better. Do not rewrite merely to maximise distance from the source.
- Do not convert direct verbs and ordinary academic sentences into abstract noun-led formulations merely to sound scholarly.
- Avoid nominalisation pressure such as repeated openings built around "recognition", "realisation", "development", "implementation", "conceptual evolution" or similar abstract noun phrases when a direct subject and verb are clearer.
- Reduce discourse-management sentences that mainly announce what was learned, why a distinction matters, or what comes next without adding a substantive proposition.
- Reduce rhetorical valuation that repeatedly labels points as major, crucial, consequential or promising when the surrounding evidence already demonstrates their importance.
- Do not narrate an intellectual journey as a perfectly tidy chain of breakthrough -> lesson -> next stage unless the supplied material genuinely requires that chronology.
- Preserve useful simple sentences. A short, ordinary, content-bearing sentence is not a defect and must not be "upgraded" merely because it is simple.
- Preserve first-person or authorial stance where it genuinely belongs to the supplied text. Do not replace a personal but academically defensible statement with an impersonal slogan.
- Keep source-defined taxonomies and product modes when the categories are substantive. Remove only rhetorical packaging that creates categories for neatness rather than meaning.
- Do not add facts, citations, studies, Nigerian context, examples or claims that are not already present.
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

export async function selectiveResidualRework({ sourceText, candidateText, maxBlocks = 6 }) {
  const sourceBaseline = analyseResidualWriting(sourceText);
  const before = analyseResidualWriting(candidateText);
  const sourceScore = Number(sourceBaseline.metrics.total_risk_score || 0);
  const beforeScore = Number(before.metrics.total_risk_score || 0);
  const candidateWorseThanSource = beforeScore > sourceScore + 2;
  const shouldAttempt = before.target_blocks.length > 0 && (before.should_rework || candidateWorseThanSource);

  if (!shouldAttempt) {
    return {
      attempted: false,
      accepted: false,
      reason: candidateWorseThanSource
        ? "The candidate scored worse than the source baseline, but no paragraph met the minimum block-target threshold for safe local rework."
        : "No residual block met the selective-rework threshold.",
      revised_text: candidateText,
      source_baseline: sourceBaseline,
      source_risk_score: sourceScore,
      candidate_risk_score: beforeScore,
      candidate_worse_than_source: candidateWorseThanSource,
      before,
      after: before,
      target_blocks: [],
      response_repair_used: false,
    };
  }

  const candidateStructure = parseTextStructure(candidateText);
  const sourceStructure = parseTextStructure(sourceText);
  const targets = before.target_blocks.slice(0, maxBlocks).map((target) => {
    const candidateBlock = candidateStructure.blocks[target.blockIndex];
    const sourceBlock = sourceReferenceForTarget(sourceStructure, target);
    const protectedSpans = extractProtectedSpans(sourceBlock?.text || candidateBlock?.text || "");
    return {
      block_index: target.blockIndex,
      candidate_text: candidateBlock?.text || target.text,
      source_reference: sourceBlock?.text || null,
      residual_signals: targetSignalLabels(before, target),
      ordinary_content_sentences_to_preserve_when_possible: ordinarySentencesForTarget(candidateText, before, target),
      hard_protected_spans: protectedSpans,
    };
  });

  const { result, repairUsed } = await callResidualModel({
    instruction: "Revise only the target paragraphs. Preserve meaning and hard protected spans; reduce the supplied residual risks without over-formalising the prose. The result should not merely be more different from the source; it should reduce the diagnosed synthetic discourse pressure.",
    source_risk_score: sourceScore,
    candidate_risk_score: beforeScore,
    candidate_worse_than_source: candidateWorseThanSource,
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
      reason: "Residual model did not return exactly one valid replacement for each target block.",
      revised_text: candidateText,
      source_baseline: sourceBaseline,
      source_risk_score: sourceScore,
      candidate_risk_score: beforeScore,
      candidate_worse_than_source: candidateWorseThanSource,
      before,
      after: before,
      target_blocks: targets.map((target) => target.block_index),
      response_repair_used: repairUsed,
    };
  }

  const reworkedText = replaceBlocksSequentially(candidateText, replacements, candidateStructure);
  const preservation = auditPreservation(sourceText, reworkedText, extractProtectedSpans(sourceText));
  const after = analyseResidualWriting(reworkedText);
  const afterScore = Number(after.metrics.total_risk_score || 0);
  const riskImproved = afterScore < beforeScore;
  const noWorseThanSource = afterScore <= sourceScore + 2;
  const preservationOk = preservationPassed(preservation);
  const accepted = preservationOk && riskImproved && noWorseThanSource;

  return {
    attempted: true,
    accepted,
    reason: accepted
      ? `Selective rework reduced residual risk from ${beforeScore} to ${afterScore}, returned it to the source-baseline band (${sourceScore}), and preserved protected content.`
      : !preservationOk
        ? "Selective rework was rejected because factual/preservation safeguards failed."
        : !riskImproved
          ? "Selective rework was rejected because it did not reduce the residual risk score."
          : `Selective rework improved the candidate but was still more synthetically patterned than the source baseline (${afterScore} versus ${sourceScore}); the prior candidate was retained for further review.`,
    revised_text: accepted ? reworkedText : candidateText,
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
    target_blocks: targets.map((target) => target.block_index),
    response_repair_used: repairUsed,
    diagnostics_notes: result.diagnostics_notes || "",
  };
}
