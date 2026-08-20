// Independent completed-output acceptance audit.
//
// This module audits the prose AFTER generation. It is intentionally separate
// from planner compliance: a fluent, grammatical, coherent candidate can still
// fail when it remains rhetorically over-regular, source-skeleton dependent,
// machine-language dense, or more machine-shaped than its source. It does not
// infer authorship and does not optimise any third-party detector score.

import { diagnose } from "./diagnostics.js";
import { assessAuthorialTexture } from "./authorialTexture.js";
import { assessCadenceDeviation } from "./cadenceDeviation.js";
import { measureLanguageFingerprint } from "./languageFingerprint.js";
import { assessLanguageDeviation } from "./languageFamilyEngine.js";
import { resolveProfile } from "./styleProfileStore.js";
import { auditPreservation } from "./preservation.js";
import { extractProtectedSpans } from "./protect.js";
import { splitSentences } from "./sentences.js";
import { analyseMachineLanguageForensics } from "./machineLanguageForensics.js";
import { analysePropositionEcho } from "./propositionEcho.js";

const FORMAL_SECTION_RE = /^(?:purpose statement|research questions?(?: and hypotheses)?|hypotheses|hypothesis development|research question\s*\d*|operational definitions?|definitions of terms|assumptions|limitations|delimitations|references|appendix|table\s+\d+|figure\s+\d+)\s*:?[\s]*$/i;
const NARRATIVE_SECTION_RE = /^(?:introduction|background(?: of the problem| to the study)?|statement of the problem|problem statement|literature review|conceptual review|theoretical review|empirical review|discussion|conclusion|research gap)\s*:?[\s]*$/i;
const CITATION_RE = /\([^()\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^()\n]*\)/i;
const REPORTING_RE = /\b(?:found|reported|showed|shows|suggested|suggests|indicated|indicates|demonstrated|demonstrates|associated|linked)\b/i;
const CLOSURE_RE = /^(?:taken together|overall|therefore|thus|consequently|accordingly|these (?:results|findings|studies)|this (?:evidence|pattern|result|finding|suggests|indicates)|the evidence therefore|the period therefore)\b/i;
const SIGNPOST_RE = /^(?:the practical question|the creditor response|board leadership and composition|gender-diversity studies|the post-\d{4} period|the existing evidence|the general business problem|the specific business problem|another important|a similar|in contrast|by contrast)\b/i;
const QUALIFIER_RE = /\b(?:however|although|though|whereas|while|despite|yet|unless|conditional|contingent|limited|uncertain|mixed|depends? on)\b/i;
const IMPLICATION_RE = /\b(?:therefore|thus|consequently|accordingly|implies?|means that|suggests? that|indicates? that|matters because)\b/i;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length);
}

function words(text) {
  return String(text || "").toLowerCase().match(/[\p{L}\p{N}'-]+/gu) || [];
}

function normalise(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, " ").replace(/\s+/g, " ").trim();
}

function rawParagraphs(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((text, index) => ({ index, text: text.trim() }))
    .filter((row) => row.text);
}

// Formal academic artefacts (purpose statements, RQs, hypotheses, references,
// etc.) are legitimate sources of structural repetition. They are preserved and
// audited semantically, but excluded from narrative choreography scoring.
export function narrativeView(text) {
  const paragraphs = rawParagraphs(text);
  const kept = [];
  let formal = false;
  let sawRecognisedHeading = false;
  for (const row of paragraphs) {
    const oneLine = row.text.replace(/\s+/g, " ").trim();
    if (FORMAL_SECTION_RE.test(oneLine)) {
      formal = true;
      sawRecognisedHeading = true;
      continue;
    }
    if (NARRATIVE_SECTION_RE.test(oneLine)) {
      formal = false;
      sawRecognisedHeading = true;
      continue;
    }
    if (!formal) kept.push(row);
  }
  // If a recognised formal section consumed the remainder of the document, an
  // empty narrative view is correct. Fall back only when no recognised section
  // heading was found at all.
  return kept.length || sawRecognisedHeading ? kept : paragraphs;
}

function firstWords(sentence, count = 3) {
  return words(sentence).slice(0, count).join(" ");
}

function sentenceOpeningRisk(sentences) {
  if (sentences.length < 4) return { risk: 0.2, diversity: 1, repeated_ratio: 0 };
  const openings = sentences.map((sentence) => firstWords(sentence)).filter(Boolean);
  const counts = new Map();
  openings.forEach((opening) => counts.set(opening, (counts.get(opening) || 0) + 1));
  const diversity = counts.size / Math.max(1, openings.length);
  const repeated = [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  const repeatedRatio = repeated / Math.max(1, openings.length);
  return {
    risk: Number(clamp01((1 - diversity) * 0.70 + repeatedRatio * 0.55).toFixed(3)),
    diversity: Number(diversity.toFixed(3)),
    repeated_ratio: Number(repeatedRatio.toFixed(3)),
  };
}

function lengthRegularityRisk(sentences) {
  const lengths = sentences.map((sentence) => words(sentence).length).filter(Boolean);
  if (lengths.length < 4) return { risk: 0.25, cv: 0 };
  const m = mean(lengths);
  const cv = m ? stddev(lengths) / m : 0;
  const risk = cv < 0.10 ? 0.95 : cv < 0.16 ? 0.80 : cv < 0.23 ? 0.62 : cv < 0.32 ? 0.42 : 0.24;
  return { risk, cv: Number(cv.toFixed(3)), mean: Number(m.toFixed(2)) };
}

function sentenceRole(sentence) {
  const text = String(sentence || "").trim();
  const roles = [];
  if (CITATION_RE.test(text) || REPORTING_RE.test(text)) roles.push("E");
  if (QUALIFIER_RE.test(text)) roles.push("Q");
  if (IMPLICATION_RE.test(text) || CLOSURE_RE.test(text)) roles.push("I");
  if (SIGNPOST_RE.test(text)) roles.push("S");
  if (!roles.length) roles.push("C");
  return roles.join("");
}

function paragraphSignature(text) {
  return splitSentences(text).map(sentenceRole).join(">");
}

function paragraphForensics(paragraphs) {
  if (!paragraphs.length) {
    return {
      score: 0,
      dominant_signature: "",
      dominant_signature_ratio: 0,
      closure_ratio: 0,
      signpost_ratio: 0,
      evidence_position_consistency: 0,
      target_paragraph_indices: [],
      rows: [],
    };
  }

  const signatures = paragraphs.map((row) => paragraphSignature(row.text));
  const counts = new Map();
  signatures.forEach((signature) => counts.set(signature, (counts.get(signature) || 0) + 1));
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const dominantSignature = ranked[0]?.[0] || "";
  const dominantCount = ranked[0]?.[1] || 0;
  const dominantRatio = dominantCount / paragraphs.length;

  const rows = paragraphs.map((row, position) => {
    const sentences = splitSentences(row.text);
    const first = sentences[0] || "";
    const last = sentences.at(-1) || "";
    const evidencePositions = sentences
      .map((sentence, index) => (CITATION_RE.test(sentence) || REPORTING_RE.test(sentence)) ? index / Math.max(1, sentences.length - 1) : null)
      .filter((value) => value !== null);
    const openingRisk = sentenceOpeningRisk(sentences).risk;
    const lengthRisk = lengthRegularityRisk(sentences).risk;
    const closure = CLOSURE_RE.test(String(last).trim());
    const signpost = SIGNPOST_RE.test(String(first).trim());
    const localRisk = clamp01(
      (signatures[position] === dominantSignature && dominantCount >= 2 ? 0.30 : 0) +
      (closure ? 0.24 : 0) +
      (signpost ? 0.18 : 0) +
      openingRisk * 0.15 +
      lengthRisk * 0.13
    );
    return {
      paragraph_index: row.index,
      narrative_position: position,
      signature: signatures[position],
      closure,
      signpost,
      evidence_positions: evidencePositions,
      opening_risk: openingRisk,
      length_regularity_risk: lengthRisk,
      local_risk: Number(localRisk.toFixed(3)),
    };
  });

  const closureRatio = rows.filter((row) => row.closure).length / paragraphs.length;
  const signpostRatio = rows.filter((row) => row.signpost).length / paragraphs.length;
  const evidencePositions = rows.flatMap((row) => row.evidence_positions);
  const evidenceConsistency = evidencePositions.length >= 4
    ? clamp01(1 - Math.min(1, stddev(evidencePositions) / 0.34))
    : 0;
  const score = clamp01(
    dominantRatio * 0.31 +
    closureRatio * 0.24 +
    signpostRatio * 0.14 +
    evidenceConsistency * 0.15 +
    mean(rows.map((row) => row.opening_risk)) * 0.09 +
    mean(rows.map((row) => row.length_regularity_risk)) * 0.07
  );

  return {
    score: Number(score.toFixed(3)),
    dominant_signature: dominantSignature,
    dominant_signature_ratio: Number(dominantRatio.toFixed(3)),
    closure_ratio: Number(closureRatio.toFixed(3)),
    signpost_ratio: Number(signpostRatio.toFixed(3)),
    evidence_position_consistency: Number(evidenceConsistency.toFixed(3)),
    target_paragraph_indices: rows
      .filter((row) => row.local_risk >= 0.48)
      .sort((a, b) => b.local_risk - a.local_risk)
      .slice(0, 6)
      .map((row) => row.paragraph_index),
    rows,
  };
}

function ngramSet(text, n = 5) {
  const tokens = words(text);
  const set = new Set();
  for (let i = 0; i <= tokens.length - n; i += 1) set.add(tokens.slice(i, i + n).join(" "));
  return set;
}

function sourceDependence(sourceText, candidateText) {
  const source = ngramSet(sourceText, 5);
  const candidate = ngramSet(candidateText, 5);
  let overlap = 0;
  candidate.forEach((gram) => { if (source.has(gram)) overlap += 1; });
  const fiveGram = candidate.size ? overlap / candidate.size : 0;
  const sourceSentences = new Set(splitSentences(sourceText).map(normalise));
  const candidateSentences = splitSentences(candidateText).map(normalise).filter(Boolean);
  const unchanged = candidateSentences.filter((sentence) => sourceSentences.has(sentence)).length;
  const exact = candidateSentences.length ? unchanged / candidateSentences.length : 0;
  return {
    five_gram_overlap: Number(fiveGram.toFixed(3)),
    exact_sentence_retention_ratio: Number(exact.toFixed(3)),
    score: Number(clamp01(fiveGram * 0.72 + exact * 0.28).toFixed(3)),
  };
}

function preservationPassed(result) {
  return Boolean(
    result?.numbers_ok && result?.citations_ok && result?.technical_terms_ok && result?.quotes_ok &&
    result?.study_stage_ok !== false && result?.rhetorical_semantic_ok !== false && !result?.new_factual_claims_detected
  );
}

function textureAssessment(text, styleFilters = {}) {
  const diagnostics = diagnose(text);
  const cadenceDeviation = assessCadenceDeviation(text, styleFilters);
  const profile = resolveProfile(styleFilters);
  const fingerprint = measureLanguageFingerprint(text);
  const languageDeviation = assessLanguageDeviation(fingerprint, profile.measured_language_family || null);
  return {
    assessment: assessAuthorialTexture({ text, diagnostics, cadenceDeviation, languageDeviation }),
    diagnostics,
  };
}

function calibratedTargetParagraphs(regularity) {
  return (regularity?.paragraph_profiles || [])
    .filter((row) => Number(row?.localRisk || row?.local_risk || 0) >= 0.42)
    .sort((a, b) => Number(b?.localRisk || b?.local_risk || 0) - Number(a?.localRisk || a?.local_risk || 0))
    .slice(0, 8)
    .map((row) => Number.isInteger(row?.paragraphIndex) ? row.paragraphIndex : row?.paragraph_index)
    .filter(Number.isInteger);
}

function machineComposite(text, styleFilters = {}) {
  const paragraphs = narrativeView(text);
  const narrativeText = paragraphs.map((row) => row.text).join("\n\n");
  // A document containing only formal artefacts has no narrative choreography to
  // score. Do not fall back to the formal text here.
  if (!narrativeText.trim()) {
    return {
      score: 0,
      label: "not_applicable_formal_only",
      texture: null,
      choreography: paragraphForensics([]),
      discourse_regularity: { score: 0, label: "not_applicable_formal_only", paragraph_profiles: [] },
      machine_language: { score: 0, label: "not_applicable_formal_only", target_paragraph_indices: [] },
      sentence_opening_risk: { risk: 0, diversity: 1, repeated_ratio: 0 },
      sentence_length_regularity: { risk: 0, cv: 0 },
      narrative_paragraph_count: 0,
    };
  }
  const textureBundle = textureAssessment(narrativeText, styleFilters);
  const texture = textureBundle.assessment;
  const choreography = paragraphForensics(paragraphs);
  const discourseRegularity = textureBundle.diagnostics?.discourse_regularity_forensics || { score: 0, paragraph_profiles: [] };
  const machineLanguage = textureBundle.diagnostics?.machine_language_forensics || analyseMachineLanguageForensics(narrativeText);
  const sentences = splitSentences(narrativeText);
  const openings = sentenceOpeningRisk(sentences);
  const lengths = lengthRegularityRisk(sentences);
  const textureRegularity = Number(texture?.machine_pattern_regularity?.score || 0);
  const discourseScore = Math.max(Number(choreography.score || 0), Number(discourseRegularity?.score || 0));
  const machineLanguageScore = Number(machineLanguage?.score || 0);
  const score = clamp01(
    textureRegularity * 0.28 +
    discourseScore * 0.28 +
    machineLanguageScore * 0.28 +
    openings.risk * 0.08 +
    lengths.risk * 0.08
  );
  return {
    score: Number(score.toFixed(3)),
    label: score >= 0.66 ? "high" : score >= 0.43 ? "moderate" : "low",
    texture,
    choreography,
    discourse_regularity: discourseRegularity,
    machine_language: machineLanguage,
    sentence_opening_risk: openings,
    sentence_length_regularity: lengths,
    narrative_paragraph_count: paragraphs.length,
  };
}

function substantiveRatio(summary = {}) {
  const substantiveOps = new Set(["SENTENCE_RESTRUCTURE", "SPLIT_OR_MERGE", "PARAGRAPH_REORDER", "DISCOURSE_REPACKAGE", "REBUILD_DISCOURSE", "CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT"]);
  const entries = Object.entries(summary || {});
  const total = entries.reduce((sum, [, count]) => sum + (Number(count) || 0), 0) || 1;
  const substantive = entries.reduce((sum, [key, count]) => sum + (substantiveOps.has(key) ? Number(count) || 0 : 0), 0);
  return substantive / total;
}

export function auditOutputAcceptance({
  sourceText,
  candidateText,
  styleFilters = {},
  rewriteIntensity = "auto",
  naturalisation = "faithful",
  planSummary = {},
  lengthPreference = "auto",
} = {}) {
  const source = String(sourceText || "");
  const candidate = String(candidateText || "");
  const preservation = auditPreservation(source, candidate, extractProtectedSpans(source), { lengthPreference });
  const preservationOk = preservationPassed(preservation);
  const sourceMachine = machineComposite(source, styleFilters);
  const candidateMachine = machineComposite(candidate, styleFilters);
  const dependence = sourceDependence(source, candidate);
  const sourceEcho = analysePropositionEcho(source);
  const candidateEcho = analysePropositionEcho(candidate);
  const sourceTexture = Number(sourceMachine.texture?.authorial_texture?.score || 0);
  const candidateTexture = Number(candidateMachine.texture?.authorial_texture?.score || 0);
  const surfaceQuality = Number(candidateMachine.texture?.surface_quality?.score ?? 1);
  const sourceMachineLanguage = Number(sourceMachine.machine_language?.score || 0);
  const candidateMachineLanguage = Number(candidateMachine.machine_language?.score || 0);
  const sourceDiscourseRegularity = Number(sourceMachine.discourse_regularity?.score || 0);
  const candidateDiscourseRegularity = Number(candidateMachine.discourse_regularity?.score || 0);
  const machineDelta = Number((candidateMachine.score - sourceMachine.score).toFixed(3));
  const machineLanguageDelta = Number((candidateMachineLanguage - sourceMachineLanguage).toFixed(3));
  const discourseRegularityDelta = Number((candidateDiscourseRegularity - sourceDiscourseRegularity).toFixed(3));
  const textureDelta = Number((candidateTexture - sourceTexture).toFixed(3));
  const substantive = substantiveRatio(planSummary);
  const intensity = String(rewriteIntensity || "auto").toLowerCase();
  const natural = String(naturalisation || "faithful").toLowerCase();
  const assertiveMode = natural === "aggressive" || natural === "authorial";
  const deepMode = intensity === "deep";
  const moderateOrDeeper = intensity === "moderate" || deepMode;

  const reasons = [];
  const hardFailures = [];
  if (!preservationOk) hardFailures.push("semantic_preservation_failed");

  // Universal regression guard: no mode is permitted to make narrative prose
  // materially more machine-regular merely because the output looks polished.
  if (candidateMachine.score > sourceMachine.score + 0.04) reasons.push("machine_pattern_regression");
  if (candidateMachine.score >= 0.68 && sourceMachine.score >= 0.40) reasons.push("high_machine_pattern_residual");

  // Modern machine-language density is an independent acceptance dimension.
  // This catches polished LLM-favoured academic language that may be obvious to a
  // human reader even when sentence length, grammar and paragraph structure look strong.
  if (candidateMachineLanguage > sourceMachineLanguage + 0.05) reasons.push("machine_language_regression");
  if (candidateMachineLanguage >= 0.38) reasons.push("machine_language_residual");
  if (candidateMachineLanguage >= 0.58) reasons.push("high_machine_language_residual");

  // The calibrated cross-paragraph forensic engine is also authoritative at the
  // release gate; a simpler local choreography score may not dilute it.
  if (candidateDiscourseRegularity >= 0.62) reasons.push("high_discourse_regularity_residual");
  if (candidateDiscourseRegularity > sourceDiscourseRegularity + 0.05) reasons.push("discourse_regularity_regression");

  // Preservation must operate at proposition/function level. A model may
  // otherwise add a reconstruction and retain the source sentence immediately
  // afterwards, technically preserving meaning while making the prose more
  // repetitive and machine-shaped.
  if (candidateEcho.count > sourceEcho.count) reasons.push("proposition_echo_introduced");
  if (candidateEcho.count >= 3) reasons.push("proposition_echo_residual");

  // Assertive modes require positive movement when the source itself carries
  // moderate/high machine-pattern or machine-language regularity. This is a
  // quality requirement, not a rewrite-distance quota.
  const sourceNeedsPatternWork = sourceMachine.score >= 0.43;
  const requiredImprovement = deepMode && assertiveMode ? 0.07 : assertiveMode ? 0.04 : 0;
  if (sourceNeedsPatternWork && assertiveMode && candidateMachine.score > sourceMachine.score - requiredImprovement) {
    reasons.push("machine_pattern_reduction_insufficient");
  }
  const sourceNeedsLanguageWork = sourceMachineLanguage >= 0.34;
  const requiredLanguageImprovement = deepMode && assertiveMode ? 0.10 : assertiveMode ? 0.06 : 0;
  if (sourceNeedsLanguageWork && assertiveMode && candidateMachineLanguage > sourceMachineLanguage - requiredLanguageImprovement) {
    reasons.push("machine_language_reduction_insufficient");
  }
  const sourceNeedsDiscourseWork = sourceDiscourseRegularity >= 0.42;
  const requiredDiscourseImprovement = deepMode && assertiveMode ? 0.08 : assertiveMode ? 0.05 : 0;
  if (sourceNeedsDiscourseWork && assertiveMode && candidateDiscourseRegularity > sourceDiscourseRegularity - requiredDiscourseImprovement) {
    reasons.push("discourse_regularity_reduction_insufficient");
  }

  // A sophisticated near-source rewrite must not be cleared merely because the
  // planner itself under-scoped the source. Earlier trials showed exactly this
  // failure: Moderate + Aggressive labelled most units MICRO_EDIT, preserved the
  // source skeleton, looked academically polished and still remained strongly
  // machine-shaped externally. For Moderate/Deep assertive treatment, source
  // dependence is therefore an independent acceptance dimension once there was
  // any meaningful non-local authority in the plan.
  const dependenceThreshold = deepMode ? 0.62 : 0.76;
  if (assertiveMode && moderateOrDeeper && substantive >= 0.10 && dependence.score >= dependenceThreshold) {
    reasons.push("source_skeleton_dependence_high");
  }
  if (deepMode && assertiveMode && dependence.exact_sentence_retention_ratio >= 0.45) {
    reasons.push("deep_mode_under_transformed");
  }

  if (sourceTexture >= 0.50 && textureDelta < -0.12) reasons.push("authorial_texture_eroded");
  if (candidateMachine.narrative_paragraph_count > 0 && surfaceQuality < 0.58) reasons.push("academic_surface_quality_low");

  const uniqueReasons = [...new Set(reasons)];
  const machineImprovement = clamp01((sourceMachine.score - candidateMachine.score + 0.20) / 0.40);
  const languageImprovement = clamp01((sourceMachineLanguage - candidateMachineLanguage + 0.18) / 0.36);
  const discourseImprovement = clamp01((sourceDiscourseRegularity - candidateDiscourseRegularity + 0.18) / 0.36);
  const textureRetention = sourceMachine.narrative_paragraph_count === 0 ? 1 : clamp01(0.65 + textureDelta);
  const dependenceShouldCount = assertiveMode && moderateOrDeeper && substantive >= 0.10;
  const dependenceFitness = dependenceShouldCount ? clamp01(1 - dependence.score) : clamp01(1 - dependence.score * 0.35);
  const score = Math.round(100 * (
    (preservationOk ? 1 : 0) * 0.28 +
    surfaceQuality * 0.12 +
    machineImprovement * 0.18 +
    languageImprovement * 0.16 +
    discourseImprovement * 0.12 +
    textureRetention * 0.08 +
    dependenceFitness * 0.06
  ));

  let status = "pass";
  if (hardFailures.length) status = "fail";
  else if (uniqueReasons.length) status = "review_required";

  const targetParagraphIndices = [...new Set([
    ...(candidateMachine.choreography.target_paragraph_indices || []),
    ...(candidateMachine.machine_language?.target_paragraph_indices || []),
    ...calibratedTargetParagraphs(candidateMachine.discourse_regularity),
    ...(candidateEcho.target_paragraph_indices || []),
  ])].slice(0, 8);

  return {
    version: "output-acceptance-v1.3",
    status,
    passed: status === "pass",
    score,
    dimensions: {
      academic_surface_quality: Number(surfaceQuality.toFixed(3)),
      semantic_preservation: preservationOk ? 1 : 0,
      source_machine_pattern: sourceMachine.score,
      candidate_machine_pattern: candidateMachine.score,
      machine_pattern_delta: machineDelta,
      source_machine_language: Number(sourceMachineLanguage.toFixed(3)),
      candidate_machine_language: Number(candidateMachineLanguage.toFixed(3)),
      machine_language_delta: machineLanguageDelta,
      source_discourse_regularity: Number(sourceDiscourseRegularity.toFixed(3)),
      candidate_discourse_regularity: Number(candidateDiscourseRegularity.toFixed(3)),
      discourse_regularity_delta: discourseRegularityDelta,
      source_authorial_texture: Number(sourceTexture.toFixed(3)),
      candidate_authorial_texture: Number(candidateTexture.toFixed(3)),
      authorial_texture_delta: textureDelta,
      source_dependence: dependence.score,
      substantive_plan_ratio: Number(substantive.toFixed(3)),
      source_proposition_echo_count: sourceEcho.count,
      candidate_proposition_echo_count: candidateEcho.count,
    },
    source_machine_pattern: sourceMachine,
    candidate_machine_pattern: candidateMachine,
    source_dependence: dependence,
    proposition_echo: { source: sourceEcho, candidate: candidateEcho },
    preservation,
    hard_failures: hardFailures,
    reasons: uniqueReasons,
    target_paragraph_indices: targetParagraphIndices,
    release_gate: {
      release_allowed: status === "pass",
      external_detector_check_recommended: status === "pass",
      instruction: status === "pass"
        ? "Internal completed-output acceptance passed. External detector checks, if used, are now evaluation evidence rather than the first line of QA."
        : "Do not spend an external detector check on this candidate yet. Repair machine-language, discourse-regularity, preservation or source-dependence residuals and re-audit internally first.",
    },
    note: "This is a closed-loop manuscript-quality audit, not an AI-authorship classifier. High clarity, grammar, coherence or sophistication cannot by themselves produce a pass when modern machine-language density, cross-paragraph regularity, machine-pattern residuals or source-skeleton dependence remain high.",
  };
}

export function acceptanceImproved(before, after) {
  if (!before || !after) return false;
  if (after.status === "pass" && before.status !== "pass") return true;
  if (after.status === "fail" && before.status !== "fail") return false;
  const beforeMachine = Number(before.dimensions?.candidate_machine_pattern || 0);
  const afterMachine = Number(after.dimensions?.candidate_machine_pattern || 0);
  const beforeLanguage = Number(before.dimensions?.candidate_machine_language || 0);
  const afterLanguage = Number(after.dimensions?.candidate_machine_language || 0);
  const beforeDiscourse = Number(before.dimensions?.candidate_discourse_regularity || 0);
  const afterDiscourse = Number(after.dimensions?.candidate_discourse_regularity || 0);
  const beforeScore = Number(before.score || 0);
  const afterScore = Number(after.score || 0);
  const materialPatternGain = afterMachine <= beforeMachine - 0.02;
  const materialLanguageGain = afterLanguage <= beforeLanguage - 0.04;
  const materialDiscourseGain = afterDiscourse <= beforeDiscourse - 0.04;
  return afterScore >= beforeScore + 3 && (materialPatternGain || materialLanguageGain || materialDiscourseGain);
}

