// Cross-sentence and cross-paragraph discourse regularity forensics.
// This module does not infer authorship. It measures observable rhetorical
// recurrence so polished academic prose is not mistaken for strong authorial
// texture merely because it is clear, grammatical and coherent.

import { splitSentences, wordCount } from "./sentences.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length);
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

const FORMAL_SECTION_RE = /\b(?:purpose statement|research questions?|hypotheses?|research question\s*\d+|operational definitions?|definition of terms|methodology|methods?|data analysis|population and sample)\b/i;
const FORMAL_LINE_RE = /^\s*(?:H0?\d+[a-z]?:|H1\d+[a-z]?:|RQ\s*\d+[:.]?|to what extent\b|how do\b|what is the relationship\b)/i;
const CITATION_RE = /\([^()\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^()\n]*\)/;
const AUTHOR_YEAR_RE = /\b[A-Z][A-Za-z'’-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'’-]+|\s+et\s+al\.)?\s*\((?:18|19|20)\d{2}[a-z]?\)/;
const EVIDENCE_VERB_RE = /\b(?:found|reported|showed|demonstrated|indicated|observed|documented|associated|linked|estimated|revealed)\b/i;
const SYNTHESIS_RE = /\b(?:therefore|thus|consequently|taken together|overall|these (?:results|findings|patterns)|this (?:evidence|pattern|finding|result)|can therefore|may therefore|the implication|the practical question|the existing evidence therefore)\b/i;
const QUALIFICATION_RE = /\b(?:however|although|though|whereas|while|despite|yet|in contrast|by contrast|remains limited|mixed signals?|contingent|not uniformly|depends on|conditional|uncertain|inconsistent)\b/i;
const CONTEXT_RE = /\b(?:during|period|setting|context|institutional|market conditions?|regulatory|COVID-19|policy tightening|low-rate|manufacturing firms?|S&P\s*(?:500|1500)|United States|U\.S\.)\b/i;
const MECHANISM_RE = /\b(?:because|through|by improving|by reducing|constrain|monitoring|information asymmetr|risk shifting|credibility|protect(?:ion)?|incentive|channel|mechanism)\b/i;
const IMPLICATION_RE = /\b(?:may|can|could|supports? the use|implies?|means that|cannot safely infer|warrants|matters because|can impair|provides a coherent setting)\b/i;
const MICRO_SIGNPOST_RE = /\b(?:mixed signals?|similarly contingent|not uniformly favou?rable|remains limited|warrants focused analysis|presents a practical difficulty|the practical question|also provide mixed signals)\b/i;
const TIDY_CLOSURE_RE = /\b(?:therefore|thus|consequently|can therefore|may therefore|this uncertainty can|the period (?:therefore )?provides|provides substantial|cannot safely infer|useful to decision-makers|reflect contemporary|produce conditional|stakeholder-specific consequences)\b/i;
const UNRESOLVED_CLOSURE_RE = /\b(?:however|yet|remains limited|remains unclear|uncertain|mixed|contingent|depends on|although|but)\b/i;

function sectionAwareBlocks(textStructure) {
  const blocks = textStructure?.blocks || [];
  let currentHeading = "";
  return blocks.map((block) => {
    if (block.type === "heading") {
      currentHeading = block.text || "";
      return { ...block, sectionHeading: currentHeading, formalArtifact: FORMAL_SECTION_RE.test(currentHeading) };
    }
    const formalArtifact = FORMAL_SECTION_RE.test(currentHeading) || FORMAL_LINE_RE.test(block.text || "");
    return { ...block, sectionHeading: currentHeading, formalArtifact };
  });
}

function sentenceRole(sentence, position, sentenceCount) {
  const source = String(sentence || "").trim();
  const hasCitation = CITATION_RE.test(source) || AUTHOR_YEAR_RE.test(source);
  if (hasCitation && EVIDENCE_VERB_RE.test(source)) return "evidence";
  if (hasCitation && /\b(?:data|debt|interest|issuance|sample|firms?|percent|trillion|billion)\b/i.test(source)) return "evidence";
  if (SYNTHESIS_RE.test(source)) return "synthesis";
  if (QUALIFICATION_RE.test(source)) return "qualification";
  if (MECHANISM_RE.test(source)) return "mechanism";
  if (CONTEXT_RE.test(source)) return "context";
  if (IMPLICATION_RE.test(source)) return "implication";
  if (hasCitation) return "evidence";
  if (position === 0 && sentenceCount > 1) return "claim";
  return "development";
}

function evidenceBand(position) {
  if (position === null || position === undefined) return "none";
  if (position <= 0.25) return "early";
  if (position <= 0.65) return "middle";
  return "late";
}

function paragraphProfile(block, allSentences) {
  const sentences = (block.sentenceIndices || []).map((index) => allSentences[index]).filter(Boolean);
  const roles = sentences.map((sentence, index) => sentenceRole(sentence, index, sentences.length));
  const evidencePositions = roles.map((role, index) => role === "evidence" ? index : null).filter((value) => value !== null);
  const firstEvidenceLocal = evidencePositions.length ? evidencePositions[0] : null;
  const firstEvidencePosition = firstEvidenceLocal === null ? null : firstEvidenceLocal / Math.max(1, sentences.length - 1);
  const firstSentence = sentences[0] || "";
  const lastSentence = sentences[sentences.length - 1] || "";
  const openingAnnouncement = Boolean(
    sentences.length >= 2 &&
    !CITATION_RE.test(firstSentence) &&
    ["claim", "context", "qualification"].includes(roles[0])
  );
  const tidyClosure = Boolean(
    sentences.length >= 2 &&
    (roles[roles.length - 1] === "synthesis" || TIDY_CLOSURE_RE.test(lastSentence)) &&
    !UNRESOLVED_CLOSURE_RE.test(lastSentence)
  );
  const unresolvedClosure = Boolean(UNRESOLVED_CLOSURE_RE.test(lastSentence) && !TIDY_CLOSURE_RE.test(lastSentence));
  const evidenceFirst = roles[0] === "evidence";
  const delayedInterpretation = Boolean(
    evidencePositions.length && roles.some((role, index) => ["synthesis", "implication", "qualification"].includes(role) && index >= firstEvidenceLocal + 2)
  );
  const microSignpost = sentences.findIndex((sentence) => wordCount(sentence) <= 13 && MICRO_SIGNPOST_RE.test(sentence));
  const signature = [
    roles[0] || "none",
    evidenceBand(firstEvidencePosition),
    tidyClosure ? "tidy" : unresolvedClosure ? "open" : roles[roles.length - 1] || "none",
    sentences.length <= 3 ? "short" : sentences.length <= 5 ? "medium" : "long",
  ].join("|");

  return {
    blockIndex: block.blockIndex,
    sentenceIndices: block.sentenceIndices || [],
    sentenceCount: sentences.length,
    wordCount: block.wordCount || 0,
    sectionHeading: block.sectionHeading || "",
    formalArtifact: Boolean(block.formalArtifact),
    roles,
    signature,
    openingAnnouncement,
    tidyClosure,
    unresolvedClosure,
    evidenceFirst,
    delayedInterpretation,
    firstEvidencePosition,
    firstEvidenceSentenceIndex: firstEvidenceLocal === null ? null : block.sentenceIndices[firstEvidenceLocal],
    openingSentenceIndex: block.sentenceIndices?.[0] ?? null,
    closingSentenceIndex: block.sentenceIndices?.[block.sentenceIndices.length - 1] ?? null,
    microSignpostSentenceIndex: microSignpost >= 0 ? block.sentenceIndices[microSignpost] : null,
  };
}

function signal({ id, legacyId, severity, profiles, sentenceIndices, interpretation, action, scope = "paragraph" }) {
  return {
    id: legacyId || id,
    forensic_id: id,
    source: "discourse_regularity_forensics",
    issue: id,
    severity,
    scope,
    blockIndices: unique((profiles || []).map((profile) => profile.blockIndex)),
    sentenceIndices: unique(sentenceIndices || (profiles || []).flatMap((profile) => profile.sentenceIndices)),
    interpretation,
    action,
  };
}

export function analyseDiscourseRegularity(text, textStructure) {
  const source = String(text || "");
  const allSentences = splitSentences(source);
  const blocks = sectionAwareBlocks(textStructure);
  const narrativeBlocks = blocks.filter((block) => block.type === "paragraph" && !block.formalArtifact && (block.sentenceIndices || []).length >= 2 && (block.wordCount || 0) >= 20);
  const formalBlocks = blocks.filter((block) => block.formalArtifact);
  const profiles = narrativeBlocks.map((block) => paragraphProfile(block, allSentences));

  if (profiles.length < 3) {
    return {
      version: "discourse-regularity-forensics-v1",
      available: false,
      score: 0,
      label: "insufficient_narrative_paragraphs",
      signals: [],
      architecture_signals: [],
      priority_sentence_indices: [],
      narrative_paragraph_count: profiles.length,
      formal_artifact_block_count: formalBlocks.length,
      paragraph_profiles: profiles,
      note: "Too few narrative paragraphs for reliable cross-paragraph regularity assessment. Formal academic artefacts are excluded from the regularity score.",
    };
  }

  const evidenceProfiles = profiles.filter((profile) => profile.firstEvidencePosition !== null);
  const openingRatio = profiles.filter((profile) => profile.openingAnnouncement).length / profiles.length;
  const tidyClosureRatio = profiles.filter((profile) => profile.tidyClosure).length / profiles.length;
  const evidenceFirstRatio = evidenceProfiles.length ? evidenceProfiles.filter((profile) => profile.evidenceFirst).length / evidenceProfiles.length : 0;
  const delayedInterpretationRatio = evidenceProfiles.length ? evidenceProfiles.filter((profile) => profile.delayedInterpretation).length / evidenceProfiles.length : 0;
  const firstEvidencePositions = evidenceProfiles.map((profile) => profile.firstEvidencePosition);
  const firstEvidencePositionSd = stddev(firstEvidencePositions);

  const signatureCounts = new Map();
  for (const profile of profiles) signatureCounts.set(profile.signature, (signatureCounts.get(profile.signature) || 0) + 1);
  const dominantEntry = [...signatureCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const dominantSignatureRatio = dominantEntry[1] / profiles.length;
  const dominantProfiles = profiles.filter((profile) => profile.signature === dominantEntry[0]);

  const packagedProfiles = profiles.filter((profile) => profile.openingAnnouncement && profile.firstEvidencePosition !== null && profile.tidyClosure);
  const packagedRatio = packagedProfiles.length / profiles.length;
  const microSignpostProfiles = profiles.filter((profile) => profile.microSignpostSentenceIndex !== null);
  const microSignpostRatio = microSignpostProfiles.length / profiles.length;

  const metrics = {
    paragraph_count: profiles.length,
    opening_announcement_ratio: Number(openingRatio.toFixed(3)),
    tidy_closure_ratio: Number(tidyClosureRatio.toFixed(3)),
    evidence_first_ratio: Number(evidenceFirstRatio.toFixed(3)),
    delayed_interpretation_ratio: Number(delayedInterpretationRatio.toFixed(3)),
    first_evidence_position_sd: Number(firstEvidencePositionSd.toFixed(3)),
    dominant_signature_ratio: Number(dominantSignatureRatio.toFixed(3)),
    packaged_claim_evidence_closure_ratio: Number(packagedRatio.toFixed(3)),
    micro_signpost_ratio: Number(microSignpostRatio.toFixed(3)),
  };

  const signals = [];

  if (packagedRatio >= 0.50 && packagedProfiles.length >= 3) {
    signals.push(signal({
      id: "repeated_claim_evidence_closure",
      legacyId: "rhetorical_symmetry",
      severity: packagedRatio >= 0.70 ? "high" : "medium",
      profiles: packagedProfiles,
      sentenceIndices: packagedProfiles.flatMap((profile) => unique([profile.openingSentenceIndex, profile.firstEvidenceSentenceIndex, profile.closingSentenceIndex])),
      interpretation: `${Math.round(packagedRatio * 100)}% of narrative paragraphs repeat an announced claim -> evidence -> tidy closure trajectory. The prose is coherent, but the recurrence makes paragraph choreography unusually predictable.`,
      action: "Rebuild selected narrative paragraphs from their propositions/evidence so rhetorical order follows the local argument. Do not force every paragraph to announce its point, present evidence, and close with a polished takeaway.",
    }));
  }

  if (tidyClosureRatio >= 0.62) {
    const affected = profiles.filter((profile) => profile.tidyClosure);
    signals.push(signal({
      id: "uniform_tidy_closure",
      legacyId: "closure_regularisation",
      severity: tidyClosureRatio >= 0.78 ? "high" : "medium",
      profiles: affected,
      sentenceIndices: affected.map((profile) => profile.closingSentenceIndex),
      interpretation: `${Math.round(tidyClosureRatio * 100)}% of narrative paragraphs end with a synthesising or implication-style closure. Repeated rhetorical completion can make otherwise strong prose read as over-engineered.`,
      action: "First test whether the closure adds a unique interpretation, qualification, implication or cross-paragraph link. Preserve that intellectual function when it does. Only remove or absorb a closure that is semantically and rhetorically duplicate; selected paragraphs may instead end on evidence, a condition, limitation, measurement distinction, or carried-forward tension.",
    }));
  }

  if (openingRatio >= 0.70) {
    const affected = profiles.filter((profile) => profile.openingAnnouncement);
    signals.push(signal({
      id: "topic_announcement_recurrence",
      legacyId: "argument_packaging",
      severity: openingRatio >= 0.84 ? "high" : "medium",
      profiles: affected,
      sentenceIndices: affected.map((profile) => profile.openingSentenceIndex),
      interpretation: `${Math.round(openingRatio * 100)}% of narrative paragraphs begin by announcing the paragraph's function or conclusion before the evidence develops. This creates highly linear information sequencing.`,
      action: "Vary entry points where warranted: some paragraphs may begin with evidence, a condition, a contrast, a measurement issue, or contextual fact before stating the broader implication.",
    }));
  }

  if (evidenceProfiles.length >= 4 && firstEvidencePositionSd <= 0.16) {
    signals.push(signal({
      id: "predictable_evidence_positioning",
      legacyId: "rhetorical_symmetry",
      severity: firstEvidencePositionSd <= 0.10 ? "high" : "medium",
      profiles: evidenceProfiles,
      sentenceIndices: evidenceProfiles.map((profile) => profile.firstEvidenceSentenceIndex),
      interpretation: `Evidence enters narrative paragraphs at unusually similar relative positions (first-evidence position SD ${firstEvidencePositionSd.toFixed(2)}). The pattern suggests repeated information packaging rather than argument-specific development.`,
      action: "Redistribute evidence placement only where the source supports it. Some paragraphs may lead with a study/result, others may establish a mechanism or condition first, and some may delay synthesis across paragraph boundaries.",
    }));
  }

  if (evidenceProfiles.length >= 5 && evidenceFirstRatio <= 0.12 && delayedInterpretationRatio <= 0.35) {
    signals.push(signal({
      id: "low_delayed_interpretation",
      legacyId: "rhetorical_symmetry",
      severity: "medium",
      profiles: evidenceProfiles,
      sentenceIndices: evidenceProfiles.flatMap((profile) => unique([profile.openingSentenceIndex, profile.firstEvidenceSentenceIndex])),
      interpretation: "Narrative paragraphs rarely begin from evidence and rarely delay interpretation after evidence. The document therefore resolves argumentative relationships in a consistently immediate sequence.",
      action: "Where intellectually warranted, allow evidence to accumulate before interpretation or let a contrast/qualification carry into the next sentence or paragraph. Do not manufacture suspense; vary timing only when it follows the scholarship.",
    }));
  }

  if (dominantSignatureRatio >= 0.42 && dominantProfiles.length >= 3) {
    signals.push(signal({
      id: "dominant_paragraph_signature",
      legacyId: "rhetorical_symmetry",
      severity: dominantSignatureRatio >= 0.60 ? "high" : "medium",
      profiles: dominantProfiles,
      sentenceIndices: dominantProfiles.flatMap((profile) => unique([profile.openingSentenceIndex, profile.closingSentenceIndex])),
      interpretation: `${Math.round(dominantSignatureRatio * 100)}% of narrative paragraphs share the same coarse rhetorical signature (${dominantEntry[0]}). Sentence-level variation is present, but paragraph functions are packaged too similarly.`,
      action: "Break repeated paragraph templates selectively. Preserve the macro-argument order, but vary local development according to whether a paragraph is accumulating evidence, comparing studies, explaining a mechanism, qualifying a finding, narrowing context, or building the gap.",
    }));
  }

  if (microSignpostRatio >= 0.28 && microSignpostProfiles.length >= 2) {
    signals.push(signal({
      id: "micro_signpost_recurrence",
      legacyId: "transition_saturation",
      severity: microSignpostRatio >= 0.45 ? "high" : "medium",
      profiles: microSignpostProfiles,
      sentenceIndices: microSignpostProfiles.map((profile) => profile.microSignpostSentenceIndex),
      interpretation: "Several short sentences act as neat paragraph-internal or paragraph-opening signposts (for example, announcing mixed, contingent, limited, or contrasting evidence). Repetition of this device contributes to controlled editorial choreography.",
      action: "Keep short interpretive sentences when they genuinely sharpen the argument, but remove or absorb repeated signposts when neighbouring evidence can carry the transition naturally.",
    }));
  }

  const regularityComponents = {
    packaged_trajectory: clamp01((packagedRatio - 0.25) / 0.60),
    tidy_closure: clamp01((tidyClosureRatio - 0.35) / 0.55),
    topic_announcement: clamp01((openingRatio - 0.45) / 0.50),
    evidence_positioning: evidenceProfiles.length >= 4 ? clamp01((0.28 - firstEvidencePositionSd) / 0.24) : 0,
    dominant_signature: clamp01((dominantSignatureRatio - 0.25) / 0.55),
    low_delayed_interpretation: evidenceProfiles.length >= 5 ? clamp01((0.45 - delayedInterpretationRatio) / 0.45) * clamp01((0.25 - evidenceFirstRatio) / 0.25) : 0,
    micro_signposting: clamp01((microSignpostRatio - 0.12) / 0.55),
  };

  const score = clamp01(
    regularityComponents.packaged_trajectory * 0.24 +
    regularityComponents.tidy_closure * 0.18 +
    regularityComponents.topic_announcement * 0.16 +
    regularityComponents.evidence_positioning * 0.14 +
    regularityComponents.dominant_signature * 0.14 +
    regularityComponents.low_delayed_interpretation * 0.09 +
    regularityComponents.micro_signposting * 0.05
  );
  const asymmetryScore = clamp01(1 - score);

  if (score >= 0.62) {
    signals.push(signal({
      id: "low_rhetorical_asymmetry",
      legacyId: "rhetorical_symmetry",
      severity: score >= 0.76 ? "high" : "medium",
      profiles,
      sentenceIndices: [],
      scope: "document",
      interpretation: `Cross-paragraph regularity is ${score >= 0.76 ? "high" : "material"} (score ${score.toFixed(2)}). The narrative is academically coherent but repeatedly optimised into similarly complete rhetorical units.`,
      action: "Treat the document-level pattern as a scope signal, not a rewrite quota. Select the paragraphs contributing most to repeated choreography and alter their local reasoning path while preserving propositions, evidence, citations, qualifications, and macro-argument order.",
    }));
  }

  const prioritySentenceIndices = unique(signals
    .filter((item) => item.scope !== "document")
    .flatMap((item) => item.sentenceIndices || []))
    .sort((a, b) => a - b);

  const architectureSignals = signals.map((item) => ({
    ...item,
    interpretation: item.interpretation,
    action: item.action,
  }));

  return {
    version: "discourse-regularity-forensics-v1",
    available: true,
    score: Number(score.toFixed(3)),
    label: score >= 0.66 ? "high" : score >= 0.42 ? "moderate" : "low",
    rhetorical_asymmetry_score: Number(asymmetryScore.toFixed(3)),
    metrics,
    components: Object.fromEntries(Object.entries(regularityComponents).map(([key, value]) => [key, Number(value.toFixed(3))])),
    signals,
    architecture_signals: architectureSignals,
    priority_sentence_indices: prioritySentenceIndices,
    narrative_paragraph_count: profiles.length,
    formal_artifact_block_count: formalBlocks.length,
    formal_artifact_block_indices: formalBlocks.map((block) => block.blockIndex),
    paragraph_profiles: profiles,
    note: "This is a discourse-pattern diagnostic, not an authorship classifier. Formal academic artefacts such as purpose statements, research questions and hypotheses are excluded from cross-paragraph regularity scoring so legitimate institutional form is not penalised.",
  };
}

