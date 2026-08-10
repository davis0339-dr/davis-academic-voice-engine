// Calibration layer for cross-paragraph discourse regularity.
//
// The base forensic engine is deliberately conservative. Real manuscript trials
// showed that polished LLM-shaped academic prose could therefore score "low"
// when paragraph roles varied superficially even though the document repeatedly
// announced paragraph jobs, serially reported evidence, resolved paragraphs into
// similarly bounded units, and used neat micro-signposts. This module adds a
// second, format-tolerant lens without turning clarity, grammar or citation
// density into evidence of authorship.

import { analyseDiscourseRegularity } from "./discourseRegularityForensics.js";
import { splitSentences, wordCount } from "./sentences.js";

const FORMAL_HEADING_RE = /^(?:purpose statement|research questions?(?: and hypotheses)?|hypotheses?|research question\s*\d+|operational definitions?|definition of terms|methodology|methods?|data analysis|population and sample|assumptions|limitations|delimitations|references|appendix)\s*:?[\s]*$/i;
const NARRATIVE_HEADING_RE = /^(?:introduction|background(?: of the problem| to the study)?|statement of the problem|problem statement|literature review|conceptual review|theoretical review|empirical review|discussion|conclusion|research gap)\s*:?[\s]*$/i;
const GENERAL_HEADING_RE = /^\s*(?:\d+(?:\.\d+)*\s+)?[A-Z][A-Za-z0-9&/,'’() -]{0,90}\s*$/;
const TERMINAL_RE = /[.!?][”"']?\s*$/;
const CITATION_RE = /(?:\([^()\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^()\n]*\)|\b[A-Z][A-Za-z'’-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'’-]+|\s+et\s+al\.)?\s*\((?:18|19|20)\d{2}[a-z]?\))/;
const REPORTING_RE = /\b(?:finds?|found|reports?|reported|shows?|showed|demonstrates?|demonstrated|indicates?|indicated|observes?|observed|documents?|documented|associates?|associated|links?|linked|estimates?|estimated|reveals?|revealed)\b/i;
const EMPIRICAL_DATA_RE = /\b(?:data|debt|interest|issuance|loans?|securities|sample|firms?|percent|percentage|trillion|billion|million|market capitali[sz]ation)\b/i;
const NUMERIC_RE = /(?:\$\s*\d|\b\d+(?:\.\d+)?%|\b(?:18|19|20)\d{2}\b)/;
const SYNTHESIS_RE = /\b(?:therefore|thus|consequently|taken together|overall|these (?:results|findings|patterns|figures|data)|this (?:evidence|pattern|finding|result|uncertainty)|the (?:evidence|period)|can therefore|may therefore|the implication|the practical question|the existing evidence|cannot safely infer|useful to decision-makers|provides substantial)\b/i;
const QUALIFICATION_RE = /\b(?:however|although|though|whereas|while|despite|yet|in contrast|by contrast|remains limited|mixed signals?|contingent|not uniformly|depends? on|conditional|uncertain|inconsistent)\b/i;
const IMPLICATION_RE = /\b(?:may|can|could|supports? the use|implies?|means that|cannot safely infer|warrants|matters because|can impair|provides a coherent setting)\b/i;
const MICRO_SIGNPOST_RE = /\b(?:the practical question|the creditor response|board leadership and composition|gender-diversity studies|post-\d{4} period|mixed signals?|similarly contingent|not uniformly favou?rable|remains limited|warrants focused analysis|presents a practical difficulty|the existing evidence)\b/i;
const UNRESOLVED_END_RE = /\b(?:however|yet|remains limited|remains unclear|uncertain|mixed|contingent|depends? on)\b[^.!?]*[.!?]?\s*$/i;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalise(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, " ").replace(/\s+/g, " ").trim();
}

function isGeneralHeading(text) {
  const line = String(text || "").trim();
  if (!line || TERMINAL_RE.test(line) || wordCount(line) > 14) return false;
  return FORMAL_HEADING_RE.test(line) || NARRATIVE_HEADING_RE.test(line) || GENERAL_HEADING_RE.test(line);
}

function blankSeparatedBlocks(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function lineRecoveredBlocks(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split(/\n/).map((line) => line.trim()).filter(Boolean);
  const blocks = [];
  let buffer = [];

  const flush = () => {
    const joined = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (joined) blocks.push(joined);
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isGeneralHeading(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    buffer.push(line);
    const joined = buffer.join(" ");
    const next = lines[i + 1] || "";
    const enoughMaterial = wordCount(joined) >= 28;
    const likelyParagraphEnd = TERMINAL_RE.test(line) && enoughMaterial && (
      !next || isGeneralHeading(next) || TERMINAL_RE.test(next) || wordCount(line) >= 45
    );
    if (likelyParagraphEnd) flush();
  }
  flush();
  return blocks;
}

function narrativeParagraphs(text) {
  let blocks = blankSeparatedBlocks(text);
  const blankNarrativeCount = blocks.filter((block) => wordCount(block) >= 20 && !isGeneralHeading(block)).length;
  let formattingRecovered = false;
  if (blankNarrativeCount < 3) {
    blocks = lineRecoveredBlocks(text);
    formattingRecovered = true;
  }

  const paragraphs = [];
  let formal = false;
  let paragraphIndex = 0;
  for (const block of blocks) {
    const oneLine = block.replace(/\s+/g, " ").trim();
    if (FORMAL_HEADING_RE.test(oneLine)) {
      formal = true;
      continue;
    }
    if (NARRATIVE_HEADING_RE.test(oneLine)) {
      formal = false;
      continue;
    }
    if (isGeneralHeading(oneLine)) continue;
    if (formal || wordCount(oneLine) < 20) continue;
    paragraphs.push({ paragraphIndex, text: oneLine });
    paragraphIndex += 1;
  }
  return { paragraphs, formattingRecovered };
}

function isEvidence(sentence) {
  const source = String(sentence || "");
  if (CITATION_RE.test(source)) return true;
  if (REPORTING_RE.test(source) && /\b(?:evidence|stud(?:y|ies)|research|data|firms?|authors?)\b/i.test(source)) return true;
  return NUMERIC_RE.test(source) && EMPIRICAL_DATA_RE.test(source);
}

function mapSentenceIndices(paragraphs, text) {
  const all = splitSentences(text);
  const mapped = [];
  let cursor = 0;
  for (const paragraph of paragraphs) {
    const indices = [];
    for (const sentence of splitSentences(paragraph.text)) {
      const needle = normalise(sentence);
      let found = -1;
      for (let i = cursor; i < all.length; i += 1) {
        const hay = normalise(all[i]);
        if (hay === needle || hay.endsWith(needle) || needle.endsWith(hay)) {
          found = i;
          break;
        }
      }
      if (found < 0) {
        for (let i = 0; i < all.length; i += 1) {
          const hay = normalise(all[i]);
          if (hay === needle || hay.endsWith(needle) || needle.endsWith(hay)) {
            found = i;
            break;
          }
        }
      }
      if (found >= 0) {
        indices.push(found);
        cursor = Math.max(cursor, found + 1);
      }
    }
    mapped.push({ ...paragraph, sentenceIndices: [...new Set(indices)] });
  }
  return mapped;
}

function paragraphProfile(row) {
  const sentences = splitSentences(row.text);
  const evidenceLocal = sentences.map((sentence, index) => isEvidence(sentence) ? index : null).filter((index) => index !== null);
  const evidenceCount = evidenceLocal.length;
  const first = sentences[0] || "";
  const last = sentences.at(-1) || "";
  const openingAnnouncement = sentences.length >= 2 && !isEvidence(first);
  const tidyClosure = sentences.length >= 2 && (SYNTHESIS_RE.test(last) || IMPLICATION_RE.test(last)) && !UNRESOLVED_END_RE.test(last);
  const evidenceTerminated = evidenceCount >= 2 && isEvidence(last);
  const boundedCompletion = Boolean(tidyClosure || (openingAnnouncement && evidenceTerminated));
  const delayedInterpretation = evidenceCount > 0 && sentences.some((sentence, index) =>
    index >= evidenceLocal[0] + 2 && (SYNTHESIS_RE.test(sentence) || IMPLICATION_RE.test(sentence) || QUALIFICATION_RE.test(sentence))
  );
  const microSignpost = wordCount(first) <= 15 && MICRO_SIGNPOST_RE.test(first);
  const evidenceCluster = evidenceCount >= 2;
  const announcedEvidenceCluster = openingAnnouncement && evidenceCluster;

  let localRisk = 0;
  if (openingAnnouncement) localRisk += 0.18;
  if (boundedCompletion) localRisk += 0.24;
  if (evidenceCluster) localRisk += 0.20;
  if (announcedEvidenceCluster) localRisk += 0.10;
  if (microSignpost) localRisk += 0.18;
  if (evidenceCount > 0 && !delayedInterpretation) localRisk += 0.10;

  return {
    ...row,
    sentenceCount: sentences.length,
    evidenceCount,
    evidenceCluster,
    announcedEvidenceCluster,
    openingAnnouncement,
    tidyClosure,
    boundedCompletion,
    delayedInterpretation,
    microSignpost,
    localRisk: Number(clamp01(localRisk).toFixed(3)),
  };
}

function ratio(count, total) {
  return total ? count / total : 0;
}

function component(value, floor, span) {
  return clamp01((value - floor) / span);
}

function calibrationSignal({ id, legacyId = "rhetorical_symmetry", severity, profiles, interpretation, action }) {
  const sentenceIndices = [...new Set(profiles.flatMap((profile) => {
    const indices = profile.sentenceIndices || [];
    if (!indices.length) return [];
    const selected = [indices[0]];
    if (profile.evidenceCluster && indices.length > 2) selected.push(indices[Math.min(1, indices.length - 1)]);
    if (profile.boundedCompletion && indices.length > 1) selected.push(indices.at(-1));
    return selected;
  }))].filter(Number.isInteger);
  return {
    id: legacyId,
    forensic_id: id,
    source: "discourse_regularity_calibration",
    issue: id,
    severity,
    scope: "paragraph",
    blockIndices: profiles.map((profile) => profile.paragraphIndex),
    sentenceIndices,
    interpretation,
    action,
  };
}

export function analyseCalibratedDiscourseRegularity(text, textStructure) {
  const base = analyseDiscourseRegularity(text, textStructure);
  const recovered = narrativeParagraphs(text);
  const profiles = mapSentenceIndices(recovered.paragraphs, text).map(paragraphProfile);

  if (profiles.length < 3) return base;

  const openingRatio = ratio(profiles.filter((p) => p.openingAnnouncement).length, profiles.length);
  const completionRatio = ratio(profiles.filter((p) => p.boundedCompletion).length, profiles.length);
  const evidenceClusterRatio = ratio(profiles.filter((p) => p.evidenceCluster).length, profiles.length);
  const signpostRatio = ratio(profiles.filter((p) => p.microSignpost).length, profiles.length);
  const evidenceProfiles = profiles.filter((p) => p.evidenceCount > 0);
  const delayedRatio = ratio(evidenceProfiles.filter((p) => p.delayedInterpretation).length, evidenceProfiles.length);
  const announcedClusterRatio = ratio(profiles.filter((p) => p.announcedEvidenceCluster).length, profiles.length);

  const calibrationComponents = {
    paragraph_job_announcement: component(openingRatio, 0.50, 0.40),
    bounded_paragraph_completion: component(completionRatio, 0.45, 0.45),
    serial_evidence_reporting: component(evidenceClusterRatio, 0.20, 0.45),
    micro_signpost_choreography: component(signpostRatio, 0.12, 0.45),
    immediate_interpretation_timing: evidenceProfiles.length >= 4 ? component(1 - delayedRatio, 0.45, 0.45) : 0,
    announced_evidence_cluster: component(announcedClusterRatio, 0.15, 0.40),
  };

  const calibratedScore = clamp01(
    calibrationComponents.paragraph_job_announcement * 0.20 +
    calibrationComponents.bounded_paragraph_completion * 0.26 +
    calibrationComponents.serial_evidence_reporting * 0.18 +
    calibrationComponents.micro_signpost_choreography * 0.13 +
    calibrationComponents.immediate_interpretation_timing * 0.13 +
    calibrationComponents.announced_evidence_cluster * 0.10
  );

  const signals = [...(base.signals || [])];
  if (openingRatio >= 0.65) {
    const affected = profiles.filter((p) => p.openingAnnouncement).sort((a, b) => b.localRisk - a.localRisk).slice(0, 8);
    signals.push(calibrationSignal({
      id: "paragraph_job_announcement_recurrence",
      legacyId: "argument_packaging",
      severity: openingRatio >= 0.80 ? "high" : "medium",
      profiles: affected,
      interpretation: `${Math.round(openingRatio * 100)}% of narrative paragraphs begin by announcing their rhetorical job before the discussion develops. The prose may be clear and coherent, but this level of repeated front-loaded organisation makes document progression unusually linear.`,
      action: "At selected leverage points, let evidence, a condition, a contrast, a measurement issue or contextual fact enter before the paragraph-level takeaway. Preserve macro-order and factual relationships.",
    }));
  }

  if (completionRatio >= 0.62) {
    const affected = profiles.filter((p) => p.boundedCompletion).sort((a, b) => b.localRisk - a.localRisk).slice(0, 8);
    signals.push(calibrationSignal({
      id: "bounded_paragraph_completion_recurrence",
      legacyId: "closure_regularisation",
      severity: completionRatio >= 0.78 ? "high" : "medium",
      profiles: affected,
      interpretation: `${Math.round(completionRatio * 100)}% of narrative paragraphs are packaged as self-contained rhetorical units: they announce/develop a point and then close through synthesis, implication, or a completed evidence run. Repetition of this completion pattern can make otherwise strong prose feel engineered.`,
      action: "Do not force every paragraph to resolve itself. Where the scholarship supports it, allow a paragraph to end on evidence, qualification, measurement distinction, or a tension carried into the next paragraph.",
    }));
  }

  if (evidenceClusterRatio >= 0.35 && profiles.filter((p) => p.evidenceCluster).length >= 3) {
    const affected = profiles.filter((p) => p.evidenceCluster).sort((a, b) => b.localRisk - a.localRisk).slice(0, 8);
    signals.push(calibrationSignal({
      id: "serial_evidence_reporting_recurrence",
      legacyId: "rhetorical_symmetry",
      severity: evidenceClusterRatio >= 0.55 ? "high" : "medium",
      profiles: affected,
      interpretation: `${Math.round(evidenceClusterRatio * 100)}% of narrative paragraphs contain serial evidence/reporting sequences. Literature synthesis is legitimate, but repeated study-after-study packaging across the document can preserve an LLM-like reporting rhythm even when vocabulary and grammar are excellent.`,
      action: "At diagnosed paragraphs, vary how evidence is assembled: juxtapose studies, foreground a condition, delay interpretation, or give unequal rhetorical space according to evidential importance. Do not invent relationships the source does not support.",
    }));
  }

  if (signpostRatio >= 0.25 && profiles.filter((p) => p.microSignpost).length >= 2) {
    const affected = profiles.filter((p) => p.microSignpost).sort((a, b) => b.localRisk - a.localRisk).slice(0, 8);
    signals.push(calibrationSignal({
      id: "micro_signpost_choreography",
      legacyId: "transition_saturation",
      severity: signpostRatio >= 0.45 ? "high" : "medium",
      profiles: affected,
      interpretation: "Several short sentences neatly announce a contrast, limitation, contingent result, period justification, or practical difficulty. Repeated use of this editorial device contributes to machine-like document choreography even though each sentence is individually acceptable.",
      action: "Keep short interpretive statements when they add real judgement, but absorb repeated signposts into the evidence or carried-forward subject matter when the transition is already clear.",
    }));
  }

  if (evidenceProfiles.length >= 5 && delayedRatio <= 0.35) {
    const affected = evidenceProfiles.filter((p) => !p.delayedInterpretation).sort((a, b) => b.localRisk - a.localRisk).slice(0, 8);
    signals.push(calibrationSignal({
      id: "immediate_interpretation_recurrence",
      legacyId: "rhetorical_symmetry",
      severity: delayedRatio <= 0.20 ? "high" : "medium",
      profiles: affected,
      interpretation: "Interpretation is rarely delayed after evidence. The document repeatedly resolves evidential relationships immediately rather than allowing accumulation, qualification, or carry-over across sentence and paragraph boundaries.",
      action: "Where warranted by the argument, let evidence accumulate before interpretation or carry an unresolved condition into the next sentence/paragraph. Do not create artificial suspense.",
    }));
  }

  const prioritySentenceIndices = [...new Set(signals
    .filter((signal) => signal.scope !== "document")
    .flatMap((signal) => signal.sentenceIndices || []))]
    .filter(Number.isInteger)
    .sort((a, b) => a - b);

  const finalScore = Math.max(Number(base.score || 0), calibratedScore);
  const metrics = {
    ...(base.metrics || {}),
    calibrated_paragraph_count: profiles.length,
    calibrated_opening_announcement_ratio: Number(openingRatio.toFixed(3)),
    calibrated_bounded_completion_ratio: Number(completionRatio.toFixed(3)),
    calibrated_evidence_cluster_ratio: Number(evidenceClusterRatio.toFixed(3)),
    calibrated_micro_signpost_ratio: Number(signpostRatio.toFixed(3)),
    calibrated_delayed_interpretation_ratio: Number(delayedRatio.toFixed(3)),
    calibrated_announced_evidence_cluster_ratio: Number(announcedClusterRatio.toFixed(3)),
  };

  return {
    ...base,
    version: "discourse-regularity-forensics-v2",
    available: true,
    score: Number(finalScore.toFixed(3)),
    label: finalScore >= 0.66 ? "high" : finalScore >= 0.42 ? "moderate" : "low",
    rhetorical_asymmetry_score: Number((1 - finalScore).toFixed(3)),
    metrics,
    calibration_components: Object.fromEntries(Object.entries(calibrationComponents).map(([key, value]) => [key, Number(value.toFixed(3))])),
    signals,
    architecture_signals: signals.map((signal) => ({ ...signal })),
    priority_sentence_indices: prioritySentenceIndices,
    narrative_paragraph_count: Math.max(Number(base.narrative_paragraph_count || 0), profiles.length),
    paragraph_profiles: profiles,
    formatting_recovery_used: recovered.formattingRecovered,
    note: `${base.note || ""} Calibration v2 additionally tests paragraph-job announcement, bounded rhetorical completion, serial evidence reporting, micro-signpost choreography and interpretation timing. These are discourse-pattern measures, not authorship claims.${recovered.formattingRecovered ? " Paragraph structure was recovered from single-line pasted formatting before scoring." : ""}`.trim(),
  };
}
