// Closed-loop acceptance audit for generated academic prose.
//
// This module evaluates the COMPLETED candidate, not the planner. It deliberately
// separates academic surface quality from authorial texture and machine-pattern
// residuals. A fluent, grammatical, coherent candidate can therefore fail when
// it remains rhetorically over-regular, source-skeleton dependent, or more
// machine-shaped than the source. It does not infer authorship and it does not
// optimise any third-party detector score.

import { diagnose } from "./diagnostics.js";
import { assessAuthorialTexture } from "./authorialTexture.js";
import { assessCadenceDeviation } from "./cadenceDeviation.js";
import { measureLanguageFingerprint } from "./languageFingerprint.js";
import { assessLanguageDeviation } from "./languageFamilyEngine.js";
import { resolveProfile } from "./styleProfileStore.js";
import { auditPreservation } from "./preservation.js";
import { extractProtectedSpans } from "./protect.js";
import { splitSentences } from "./sentences.js";

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

// Formal artefacts are legitimate academic regularity and must not be penalised
// as machine choreography. When headings are present, suppress formal sections
// until the next recognised narrative heading. If no headings are present, only
// exact formal-heading paragraphs are removed.
export function narrativeView(text) {
  const paragraphs = rawParagraphs(text);
  const kept = [];
  let formal = false;
  for (const row of paragraphs) {
    const oneLine = row.text.replace(/\s+/g, " ").trim();
    if (FORMAL_SECTION_RE.test(oneLine)) {
      formal = true;
      continue;
    }
    if (NARRATIVE_SECTION_RE.test(oneLine)) {
      formal = false;
      continue;
    }
    if (!formal) kept.push(row);
  }
  // Never make the evaluator blind because a document used unusual headings.
  return kept.length ? kept : paragraphs;
}

function sentenceLengths(text) {
  return splitSentences(text).map((sentence) => words(sentence).length).filter(Boolean);
}

function firstWords(sentence, count = 3) {
  return words(sentence).slice(0, count).join(" ");
}

function sentenceOpeningRisk(sentences) {
  if (sentences.length < 4) return { risk: 0.2, diversity: 1, repeated_ratio: 0 };
  const openings = sentences.map((s) => firstWords(s)).filter(Boolean);
  const counts = new Map();
  openings.forEach((opening) => counts.set(opening, (counts.get(opening) || 0) + 1));
  const unique = counts.size / Math.max(1, openings.length);
  const repeatedOccurrences = [...counts.values()].filter((n) => n > 1).reduce((sum, n) => sum + n, 0);
  const repeatedRatio = repeatedOccurrences / Math.max(1, openings.length);
  return {
    risk: Number(clamp01((1 - unique) * 0.7 + repeatedRatio * 0.55).toFixed(3)),
    diversity: Number(unique.toFixed(3)),
    repeated_ratio: Number(repeatedRatio.toFixed(3)),
  };
}

function lengthRegularityRisk(sentences) {
  const lengths = sentences.map((s) => words(s).length).filter(Boolean);
  if (lengths.length < 4) return { risk: 0.25, cv: 0 };
  const m = mean(lengths);
  const cv = m ? stddev(lengths) / m : 0;
  const risk = cv < 0.10 ? 0.95 : cv < 0.16 ? 0.80 : cv < 0.23 ? 0.62 : cv < 0.32 ? 0.42 : 0.24;
  return { risk, cv: Number(cv.toFixed(3)), mean: Number(m.toFixed(2)) };
}

function sentenceRole(sentence) {
  const s = String(sentence || "").trim();
  const roles = [];
  if (CITATION_RE.test(s) || REPORTING_RE.test(s)) roles.push("E");
  if (QUALIFIER_RE.test(s)) roles.push("Q");
  if (IMPLICATION_RE.test(s) || CLOSURE_RE.test(s)) roles.push("I");
  if (SIGNPOST_RE.test(s)) roles.push("S");
  if (!roles.length) roles.push("C");
  return roles.join("");
}

function paragraphSignature(text) {
  const sentences = splitSentences(text);
  return sentences.map(sentenceRole).join(">");
}

function paragraphForensics(paragraphRows) {
  if (!paragraphRows.length) {
    return {
      score: 0,
      dominant_signature_ratio: 0,
      closure_ratio: 0,
      signpost_ratio: 0,
      evidence_position_consistency: 0,
      target_paragraph_indices: [],
      rows: [],
    };
  }

  const signatures = paragraphRows.map((row) => paragraphSignature(row.text));
  const signatureCounts = new Map();
  signatures.forEach((signature) => signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1));
  const dominantCount = Math.max(0, ...signatureCounts.values());
  const dominantSignatureRatio = dominantCount / paragraphRows.length;

  const localRows = paragraphRows.map((row, position) => {
    const sentences = splitSentences(row.text);
    const last = sentences.at(-1) || "";
    const first = sentences[0] || "";
    const closure = CLOSURE_RE.test(String(last).trim());
    const signpost = SIGNPOST_RE.test(String(first).trim());
    const evidencePositions = sentences
      .map((sentence, index) => (CITATION_RE.test(sentence) || REPORTING_RE.test(sentence)) ? index / Math.max(1, sentences.length - 1) : null)
      .filter((value) => value !== null);
    const localOpening = sentenceOpeningRisk(sentences).risk;
    const localLength = lengthRegularityRisk(sentences).risk;
    return {
      paragraph_index: row.index,
      narrative_position: position,
      signature: signatures[position],
      closure,
      signpost,
      evidence_positions: evidencePositions,
      opening_risk: localOpening,
      length_regularity_risk: localLength,
    };
  });

  const closureRatio = localRows.filter((row) => row.closure).length / paragraphRows.length;
  const signpostRatio = localRows.filter((row) => row.signpost).length / paragraphRows.length;
  const allEvidencePositions = localRows.flatMap((row) => row.evidence_positions);
  let evidencePositionConsistency = 0;
  if (allEvidencePositions.length >= 4) {
    const sd = stddev(allEvidencePositions);
    evidencePositionConsistency = clamp01(1 - Math.min(1, sd / 0.34));
  }

  const dominantSignature = [...signatureCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const rowsScored = localRows.map((row) => {
    const risk = clamp01(
      (row.signature === dominantSignature && dominantCount >= 2 ? 0.30 : 0) +
      (row.closure ? 0.24 : 0) +
      (row.signpost ? 0.18 : 0) +
      row.opening_risk * 0.15 +
      row.length_regularity_risk * 0.13
    );
    return { ...row, local_risk: Number(risk.toFixed(3)) };
  });

  const score = clamp01(
    dominantSignatureRatio * 0.31 +
    closureRatio * 0.24 +
    signpostRatio * 0.14 +
    evidencePositionConsistency * 0.15 +
    mean(rowsScored.map((row) => row.opening_risk)) * 0.09 +
    mean(rowsScored.map((row) => row.length_regularity_risk)) * 0.07
  );

  return {
    score: Number(score.toFixed(3)),
    dominant_signature: dominantSignature,
    dominant_signature_ratio: Number(dominantSignatureRatio.toFixed(3)),
    closure_ratio: Number(closureRatio.toFixed(3)),
    signpost_ratio: Number(signpostRatio.toFixed(3)),
    evidence_position_consistency: Number(evidencePositionConsistency.toFixed(3)),
    target_paragraph_indices: rowsScored
      .filter((row) => row.local_risk >= 0.48)
      .sort((a, b) => b.local_risk - a.local_risk)
      .slice(0, 6)
      .map((row) => row.paragraph_index),
    rows: rowsScored,
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
  const fiveGramOverlap = candidate.size ? overlap / candidate.size : 0;

  const sourceSentences = new Set(splitSentences(sourceText).map(normalise));
  const candidateSentences = splitSentences(candidateText).map(normalise).filter(Boolean);
  const unchanged = candidateSentences.filter((sentence) => sourceSentences.has(sentence)).length;
  const exactSentenceRatio = candidateSentences.length ? unchanged / candidateSentences.length : 0;
  return {
    five_gram_overlap: Number(fiveGramOverlap.toFixed(3)),
    exact_sentence_retention_ratio: Number(exactSentenceRatio.toFixed(3)),
    score: Number(clamp01(fiveGramOverlap * 0.72 + exactSentenceRatio * 0.28).toFixed(3)),
  };
}

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

function textureAssessment(text, styleFilters = {}) {
  const diagnostics = diagnose(text);
  const cadenceDeviation = assessCadenceDeviation(text, styleFilters);
  const profile = resolveProfile(styleFilters);
  const fp = measureLanguageFingerprint(text);
  const languageDeviation = assessLanguageDeviation(fp, profile.measured_language_family || null);
  return assessAuthorialTexture({ text, diagnostics, cadenceDeviation, languageDeviation });
}

function machineComposite(text, styleFilters = {}) {
  const paragraphs = narrativeView(text);
  const narrativeText = paragraphs.map((row) => row.text).join("\n\n");
  const texture = textureAssessment(narrativeText || text, styleFilters);
  const choreography = paragraphForensics(paragraphs);
  const sentences = splitSentences(narrativeText || text);
  const openings = sentenceOpeningRisk(sentences);
  const lengths = lengthRegularityRisk(sentences);
  const textureRegularity = Number(texture?.machine_pattern_regularity?.score || 0);
  const score = clamp01(
    textureRegularity * 0.42 +
    choreography.score * 0.40 +
    openings.risk * 0.10 +
    lengths.risk * 0.08
  );
  return {
    score: Number(score.toFixed(3)),
    label: score >= 0.66 ? "high" : score >= 0.43 ? "moderate" : "low",
    texture,
    choreography,
    sentence_opening_risk: openings,
    sentence_length_regularity: lengths,
    narrative_paragraph_count: paragraphs.length,
  };
}

function substantiveRatio(summary = {}) {
  const substantive = new Set(["SENTENCE_RESTRUCTURE", "SPLIT_OR_MERGE", "PARAGRAPH_REORDER", "DISCOURSE_REPACKAGE", "REBUILD_DISCOURSE", "CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT"]);
  const entries = Object.entries(summary || {});
  const total = entries.reduce((sum, [, count]) => sum + (Number(count) || 0), 0) || 1;
  const count = entries.reduce((sum, [key, value]) => sum + (substantive.has(key) ? Number(value) || 0 : 0), 0);
  return count / total;
}

export function auditOutputAcceptance({
  sourceText,
  candidateText,
  styleFilters = {},
  rewriteIntensity = "auto",
  naturalisation = "faithful",
  planSummary = {},
} = {}) {
  const source = String(sourceText || "");
  const candidate = String(candidateText || "");
  const protectedSpans = extractProtectedSpans(source);
  const preservation = auditPreservation(source, candidate, protectedSpans);
  const preservationOk = preservationPassed(preservation);

  const sourceMachine = machineComposite(source, styleFilters);
  const candidateMachine = machineComposite(candidate, styleFilters);
  const dependence = sourceDependence(source, candidate);
  const sourceTexture = Number(sourceMachine.texture?.authorial_texture?.score || 0);
  const candidateTexture = Number(candidateMachine.texture?.authorial_texture?.score || 0);
  const surfaceQuality = Number(candidateMachine.texture?.surface_quality?.score || 0);
  const machineDelta = Number((candidateMachine.score - sourceMachine.score).toFixed(3));
  const textureDelta = Number((candidateTexture - sourceTexture).toFixed(3));
  const substantive = substantiveRatio(planSummary);
  const intensity = String(rewriteIntensity || "auto").toLowerCase();
  const natural = String(naturalisation || "faithful").toLowerCase();
  const assertiveMode = natural === "aggressive" || natural === "authorial";
  const deepMode = intensity === "deep";

  const reasons = [];
  const hardFailures = [];
  if (!preservationOk) hardFailures.push("semantic_preservation_failed");

  // A candidate must not become more machine-regular merely because it became
  // clearer or more polished. Assertive modes require a meaningful reduction when
  // the source itself carries moderate/high regularity.
  const sourceNeedsPatternWork = sourceMachine.score >= 0.43;
  const requiredImprovement = deepMode && assertiveMode ? 0.07 : assertiveMode ? 0.04 : 0;
  if (sourceNeedsPatternWork && assertiveMode && candidateMachine.score > sourceMachine.score - requiredImprovement) {
    reasons.push("machine_pattern_reduction_insufficient");
  }
  if (!sourceNeedsPatternWork && candidateMachine.score > sourceMachine.score + 0.06) {
    reasons.push("machine_pattern_regression");
  }
  if (candidateMachine.score >= 0.68 && assertiveMode) reasons.push("high_machine_pattern_residual");

  // A strong academic candidate can still be merely a sophisticated paraphrase.
  // Only enforce this where the planner actually authorised substantive work.
  if (assertiveMode && substantive >= 0.25 && dependence.score >= 0.72) {
    reasons.push("source_skeleton_dependence_high");
  }
  if (deepMode && assertiveMode && substantive >= 0.35 && dependence.exact_sentence_retention_ratio >= 0.58) {
    reasons.push("deep_mode_under_transformed");
  }

  // Do not improve detector-like regularity by flattening the author's usable
  // texture. A moderate drop is tolerated when the source texture itself is weak.
  if (sourceTexture >= 0.50 && textureDelta < -0.12) reasons.push("authorial_texture_eroded");
  if (surfaceQuality < 0.58) reasons.push("academic_surface_quality_low");

  const machineImprovement = clamp01((sourceMachine.score - candidateMachine.score + 0.20) / 0.40);
  const textureRetention = clamp01(0.65 + textureDelta);
  const dependenceFitness = assertiveMode && substantive >= 0.25 ? clamp01(1 - dependence.score) : clamp01(1 - dependence.score * 0.35);
  const score = Math.round(100 * (
    (preservationOk ? 1 : 0) * 0.30 +
    surfaceQuality * 0.15 +
    machineImprovement * 0.30 +
    textureRetention * 0.15 +
    dependenceFitness * 0.10
  ));

  let status = "pass";
  if (hardFailures.length) status = "fail";
  else if (reasons.length) status = "review_required";

  const targetParagraphIndices = [...new Set([
    ...candidateMachine.choreography.target_paragraph_indices,
  ])].slice(0, 6);

  return {
    version: "output-acceptance-v1.0",
    status,
    passed: status === "pass",
    score,
    dimensions: {
      academic_surface_quality: Number(surfaceQuality.toFixed(3)),
      semantic_preservation: preservationOk ? 1 : 0,
      source_machine_pattern: sourceMachine.score,
      candidate_machine_pattern: candidateMachine.score,
      machine_pattern_delta: machineDelta,
      source_authorial_texture: Number(sourceTexture.toFixed(3)),
      candidate_authorial_texture: Number(candidateTexture.toFixed(3)),
      authorial_texture_delta: textureDelta,
      source_dependence: dependence.score,
      substantive_plan_ratio: Number(substantive.toFixed(3)),
    },
    source_machine_pattern: sourceMachine,
    candidate_machine_pattern: candidateMachine,
    source_dependence: dependence,
    preservation,
    hard_failures: hardFailures,
    reasons,
    target_paragraph_indices: targetParagraphIndices,
    release_gate: {
      release_allowed: status === "pass",
      external_detector_check_recommended: status === "pass",
      instruction: status === "pass"
        ? "Internal output acceptance passed. External detector checks, if used, are now evaluation evidence rather than the first line of QA."
        : "Do not spend an external detector check on this candidate yet. Repair the listed residuals and re-audit internally first.",
    },
    note: "This is a closed-loop manuscript-quality audit, not an AI-authorship classifier. High clarity, grammar or coherence cannot by themselves produce a pass when machine-pattern residuals or source-skeleton dependence remain high.",
  };
}

export function acceptanceImproved(before, after) {
  if (!before || !after) return false;
  if (after.status === "pass" && before.status !== "pass") return true;
  if (after.status === "fail" && before.status !== "fail") return false;
  const beforeMachine = Number(before.dimensions?.candidate_machine_pattern || 0);
  const afterMachine = Number(after.dimensions?.candidate_machine_pattern || 0);
  const beforeScore = Number(before.score || 0);
  const afterScore = Number(after.score || 0);
  return afterScore >= beforeScore + 3 && afterMachine <= beforeMachine - 0.02;
}
