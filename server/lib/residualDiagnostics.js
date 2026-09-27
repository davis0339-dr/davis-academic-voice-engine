// Post-rewrite diagnostics for residual synthetic structure and over-formalisation.
// These are writing-quality signals, not authorship claims. They are intentionally
// used after a candidate rewrite so the editor can distinguish "different" from
// "better" and target only blocks that still need work.

import { splitSentences, wordCount } from "./sentences.js";
import { parseTextStructure } from "./textStructure.js";
import { analyseDiscourseArchitecture } from "./discourseArchitecture.js";
import { analysePropositionEcho } from "./propositionEcho.js";

const DISCOURSE_MANAGEMENT_RE = /(?:\bthat\s+(?:distinction|difference|result|finding|lesson|insight)\s+(?:matters|is|was)\b|\bthat\s+(?:taught|forced|led|pushed)\s+(?:us|me)\b|\bthis\s+(?:means|matters|shows|changes|demonstrates|suggests|reveals)\b|\banother\s+(?:major\s+)?(?:breakthrough|insight|lesson|advance)\b|\bwhere\s+we\s+are\s+now\b|\bthe\s+next\s+(?:step|stage|phase|development|coding\s+work)\b|\bto\s+answer\s+(?:the\s+question\s+)?directly\b)/i;
const ACADEMIC_BRIDGE_RE = /^(?:this\s+(?:problem|difficulty|distinction|uncertainty|issue|finding|evidence|result)\s+(?:extends|becomes|creates|leaves|is|suggests|shows)|a\s+(?:similar|related|further)\s+(?:problem|difficulty|issue)\s+(?:arises|appears)|in\s+both\s+cases|what\s+(?:emerges|remains)|the\s+present\s+study\s+(?:addresses|takes|examines)|the\s+implication\s+is|taken\s+together|collectively)\b/i;
const LOCAL_SYNTHESIS_RE = /^(?:this|these|such|taken together|collectively|overall|the implication|what emerges|the evidence therefore|the findings therefore)\b/i;
const RETROSPECTIVE_NEATNESS_RE = /(?:\b(?:this|that)\s+(?:led|taught|forced|pushed)\s+(?:us|me)\s+(?:toward|to|into)\b|\bthen\s+came\b|\bthe\s+(?:first|second|third|other|next)\s+(?:major\s+)?(?:breakthrough|lesson|insight|achievement|stage)\b)/i;
const RHETORICAL_VALUATION_RE = /(?:\b(?:major|crucial|critical|important|significant|substantial|consequential|fundamental|enormous|remarkable|promising|powerful|strongest)\s+(?:achievement|advance|breakthrough|insight|distinction|difference|lesson|finding|result|point|development|evolution|problem|signal|evidence|step)\b|\b(?:matters|carries\s+weight|is\s+enormous|is\s+crucial|is\s+critical)\b)/i;
const NOMINALISED_OPENING_RE = /^(?:conceptual\s+evolution|empirical\s+grounding|recognition\s+of|realisation\s+of|the\s+realisation|current\s+positioning|moving\s+beyond|development\s+of|implementation\s+of|identification\s+of|evaluation\s+of|consideration\s+of|interpretation\s+of|assessment\s+of)\b/i;
const ABSTRACT_NOUN_RE = /\b[A-Za-z]{5,}(?:tion|sion|ment|ance|ence|ity|isation|ization|ship|ness)\b/gi;
const TAXONOMY_RE = /\b(?:distinguish(?:es|ing)?\s+(?:between|among)|classified?\s+into|divided\s+into|comprises?|consists?\s+of|(?:two|three|four|five|six|seven)\s+(?:types|categories|levels|modes|treatments|dimensions|stages|layers|signals|classes|forms))\b/i;
const EVIDENCE_RE = /(?:\([^\)\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^\)\n]*\)|\b[A-Z][A-Za-z'’-]+(?:\s+et al\.)?\s*\((?:18|19|20)\d{2}[a-z]?\)|\b\d+(?:\.\d+)?%\b|\b(?:because|whereas|although|while|given|since|when|if)\b)/i;
const TECHNICAL_TOKEN_RE = /(?:`[^`]+`|\b[A-Z]{2,}\b|\b(?:regression|estimator|coefficient|hypothesis|construct|variable|panel|logit|logistic|OLS|GLS|ANOVA|SEM|IFRS|IAS|corpus|planner|discourse)\b)/i;
const CLAUSE_MARKER_RE = /\b(?:although|though|while|whereas|because|since|when|where|if|unless|which|that|who|whose|whether|even though|provided that|given that|despite the fact)\b/gi;

const ARCHITECTURE_WEIGHTS = Object.freeze({
  argument_packaging: 2,
  enumeration_saturation: 1,
  transition_saturation: 2,
  aphoristic_compression: 1,
  rhetorical_symmetry: 1,
  closure_regularisation: 2,
});

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function countAbstractNouns(sentence) {
  return (sentence.match(ABSTRACT_NOUN_RE) || []).length;
}

function countClauseMarkers(sentence) {
  return (sentence.match(CLAUSE_MARKER_RE) || []).length;
}

function sentenceContentYield(sentence) {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const management = DISCOURSE_MANAGEMENT_RE.test(sentence) || RHETORICAL_VALUATION_RE.test(sentence) || ACADEMIC_BRIDGE_RE.test(sentence.trim());
  const evidence = EVIDENCE_RE.test(sentence) || TECHNICAL_TOKEN_RE.test(sentence);
  if (management && !evidence && words.length <= 18) return 0.2;
  if (management && !evidence) return 0.45;
  if (evidence) return 0.9;
  return 0.7;
}

function blocksForSentenceIndices(structure, indices) {
  const set = new Set(indices);
  return structure.blocks
    .filter((block) => (block.type === "paragraph" || block.type === "list_item") && block.sentenceIndices.some((i) => set.has(i)))
    .map((block) => block.blockIndex);
}

function unique(values) {
  return [...new Set(values)];
}

function localClauseRegularity(sentences, clauseCounts) {
  const indices = [];
  if (sentences.length < 5) return indices;
  for (let start = 0; start <= sentences.length - 5; start += 1) {
    const window = sentences.slice(start, start + 5);
    const windowClauses = clauseCounts.slice(start, start + 5);
    const broad = window.map((sentence, i) => wordCount(sentence) >= 24 && windowClauses[i] >= 2);
    if (broad.filter(Boolean).length >= 4) {
      for (let i = 0; i < 5; i += 1) if (broad[i]) indices.push(start + i);
    }
  }
  return unique(indices);
}

export function analyseResidualWriting(text) {
  const sentences = splitSentences(text);
  const structure = parseTextStructure(text);
  const architecture = analyseDiscourseArchitecture(text, structure);
  const propositionEcho = analysePropositionEcho(text);

  const management = [];
  const academicBridges = [];
  const synthesisClosures = [];
  const retrospective = [];
  const valuation = [];
  const nominalisedOpening = [];
  const nominalisationDense = [];
  const taxonomy = [];
  const lowYield = [];
  const ordinaryContent = [];
  const clauseStacked = [];
  const clauseCounts = [];

  sentences.forEach((sentence, sentenceIndex) => {
    const words = wordCount(sentence);
    const abstractCount = countAbstractNouns(sentence);
    const clauseCount = countClauseMarkers(sentence);
    const yieldScore = sentenceContentYield(sentence);
    clauseCounts.push(clauseCount);

    if (DISCOURSE_MANAGEMENT_RE.test(sentence)) management.push(sentenceIndex);
    if (ACADEMIC_BRIDGE_RE.test(sentence.trim())) academicBridges.push(sentenceIndex);
    if (LOCAL_SYNTHESIS_RE.test(sentence.trim())) synthesisClosures.push(sentenceIndex);
    if (RETROSPECTIVE_NEATNESS_RE.test(sentence)) retrospective.push(sentenceIndex);
    if (RHETORICAL_VALUATION_RE.test(sentence)) valuation.push(sentenceIndex);
    if (NOMINALISED_OPENING_RE.test(sentence.trim())) nominalisedOpening.push(sentenceIndex);
    if (words >= 12 && abstractCount >= 4 && ratio(abstractCount, words) >= 0.14) nominalisationDense.push(sentenceIndex);
    if (TAXONOMY_RE.test(sentence)) taxonomy.push(sentenceIndex);
    if (words >= 30 && clauseCount >= 3) clauseStacked.push(sentenceIndex);
    if (yieldScore <= 0.45) lowYield.push(sentenceIndex);

    if (
      words >= 5 && words <= 18 &&
      yieldScore >= 0.7 &&
      !DISCOURSE_MANAGEMENT_RE.test(sentence) &&
      !ACADEMIC_BRIDGE_RE.test(sentence.trim()) &&
      !RHETORICAL_VALUATION_RE.test(sentence) &&
      !NOMINALISED_OPENING_RE.test(sentence.trim())
    ) ordinaryContent.push(sentenceIndex);
  });

  const locallyRegularBroadSentences = localClauseRegularity(sentences, clauseCounts);
  const signals = [];
  function addSignal(id, severity, indices, interpretation, action, weight) {
    if (!indices.length) return;
    signals.push({ id, severity, sentenceIndices: unique(indices), interpretation, action, weight });
  }

  if (management.length >= 3 || ratio(management.length, sentences.length) >= 0.07) {
    addSignal(
      "discourse_management_density",
      management.length >= 6 ? "high" : "medium",
      management,
      "The prose repeatedly explains what the argument has just done, what was learned, or what comes next instead of allowing the substantive discussion to carry more of that progression.",
      "Reduce meta-narration where it adds little new content. Keep genuine orientation where needed, but let evidence, examples, qualifications and carried-forward terminology do more of the connective work.",
      2
    );
  }

  if (academicBridges.length >= 3 || ratio(academicBridges.length, sentences.length) >= 0.06) {
    addSignal(
      "academic_bridge_choreography",
      academicBridges.length >= 6 ? "high" : "medium",
      academicBridges,
      "Paragraph/sentence movement is repeatedly announced through polished academic bridge phrases instead of emerging from the evidence or carried-forward subject matter.",
      "Keep necessary transitions, but remove bridge sentences that mainly narrate the structure. Let the next study, measure, setting or qualification begin directly where the relationship is already clear.",
      2
    );
  }

  if (synthesisClosures.length >= 4 || ratio(synthesisClosures.length, sentences.length) >= 0.09) {
    addSignal(
      "immediate_synthesis_density",
      synthesisClosures.length >= 7 ? "high" : "medium",
      synthesisClosures,
      "The candidate repeatedly converts small evidence clusters into immediate interpretation or synthesis, producing a highly resolved local rhythm.",
      "Delay synthesis where the argument can accumulate further evidence or qualification. Do not force a claim-evidence-implication closure after every small cluster.",
      2
    );
  }

  if (retrospective.length >= 2) {
    addSignal(
      "retrospective_neatness",
      retrospective.length >= 4 ? "high" : "medium",
      retrospective,
      "The intellectual journey is repeatedly narrated as a clean lesson-to-next-lesson progression, which can make discovery appear more orderly than the reasoning itself.",
      "Preserve chronology where it matters, but allow uncertainty, revision, contradiction and partial resolution to remain visible rather than converting every stage into a polished retrospective milestone.",
      2
    );
  }

  if (valuation.length >= 3) {
    addSignal(
      "rhetorical_valuation",
      valuation.length >= 6 ? "high" : "medium",
      valuation,
      "Several sentences principally tell the reader that a point is major, important, consequential or promising rather than advancing the proposition itself.",
      "Retain evaluative emphasis only where it is analytically necessary. Prefer demonstrating importance through evidence or explanation over repeatedly announcing it.",
      1
    );
  }

  const nominalisationIndices = unique([...nominalisedOpening, ...nominalisationDense]);
  if (nominalisationIndices.length >= 3 || ratio(nominalisationIndices.length, sentences.length) >= 0.08) {
    addSignal(
      "nominalisation_pressure",
      nominalisationIndices.length >= 6 ? "high" : "medium",
      nominalisationIndices,
      "The revision frequently converts actions or judgements into abstract noun-led academic formulations, creating a more formal but less direct register.",
      "Restore direct verbs, concrete subjects and ordinary academic sentences where they carry the same meaning more naturally. Do not treat nominalisation as an automatic marker of scholarly quality.",
      2
    );
  }

  if (clauseStacked.length >= 3 || locallyRegularBroadSentences.length >= 4) {
    addSignal(
      "clause_stacking_pressure",
      clauseStacked.length >= 6 || locallyRegularBroadSentences.length >= 8 ? "high" : "medium",
      unique([...clauseStacked, ...locallyRegularBroadSentences]),
      "Several neighbouring sentences are broad, heavily subordinated and similarly packaged. Sentence length may vary numerically while the deeper clause architecture remains regular.",
      "Do not solve this by making every sentence shorter. Redistribute propositions only where the reasoning supports it; allow some direct evidential sentences and reserve broader sentences for relationships that genuinely belong together.",
      2
    );
  }

  if (taxonomy.length >= 2) {
    addSignal(
      "taxonomy_pressure",
      taxonomy.length >= 4 ? "high" : "medium",
      taxonomy,
      "The prose repeatedly converts nuanced material into bounded categories, modes, levels or stages.",
      "Keep classifications that genuinely belong to the source or product design. Where the categories are merely rhetorical packaging, integrate the distinctions into ordinary discussion instead of creating another tidy taxonomy.",
      1
    );
  }

  if (lowYield.length >= 3 || (lowYield.length >= 2 && ratio(lowYield.length, sentences.length) >= 0.25)) {
    addSignal(
      "low_propositional_yield",
      lowYield.length >= 6 ? "high" : "medium",
      lowYield,
      "Several sentences spend more language managing, valuing or closing the discussion than adding evidence, interpretation, context, qualification or a new proposition.",
      "Condense or absorb low-yield meta sentences into nearby substantive reasoning. Do not remove genuine authorial stance merely because it is brief.",
      2
    );
  }

  if (propositionEcho.count > 0) {
    addSignal(
      "adjacent_proposition_echo",
      propositionEcho.count >= 3 ? "high" : "medium",
      propositionEcho.sentence_indices,
      "A reconstructed proposition is immediately repeated in a second sentence, often because source retention was treated as sentence retention rather than preservation of intellectual content.",
      "Integrate the proposition once. Preserve its intellectual job and semantic force, but remove the reconstruction-plus-retention echo rather than keeping both formulations.",
      3
    );
  }

  for (const signal of architecture.signals || []) {
    addSignal(
      signal.id,
      signal.severity,
      signal.sentenceIndices || [],
      signal.interpretation,
      signal.action,
      ARCHITECTURE_WEIGHTS[signal.id] || 1
    );
  }

  const blockScores = new Map();
  for (const signal of signals) {
    const blockIndices = blocksForSentenceIndices(structure, signal.sentenceIndices || []);
    for (const blockIndex of blockIndices) {
      blockScores.set(blockIndex, (blockScores.get(blockIndex) || 0) + (signal.weight || 1));
    }
  }

  const targetBlocks = [...blockScores.entries()]
    .map(([blockIndex, score]) => ({ blockIndex, score, block: structure.blocks[blockIndex] }))
    .filter((row) => row.block && row.block.type === "paragraph" && row.score >= 2)
    .sort((a, b) => b.score - a.score || a.blockIndex - b.blockIndex)
    .slice(0, 6)
    .map(({ blockIndex, score, block }) => ({
      blockIndex,
      paragraphOrdinal: block.paragraphOrdinal,
      score,
      sentenceIndices: block.sentenceIndices,
      text: block.text,
    }));

  const totalRiskScore = signals.reduce((sum, signal) => sum + (signal.weight || 1) * Math.max(1, signal.sentenceIndices?.length || 1), 0);

  return {
    measurement_version: "residual-writing-v3",
    sentence_count: sentences.length,
    block_count: structure.block_count,
    signals,
    discourse_architecture: architecture,
    metrics: {
      discourse_management_count: management.length,
      academic_bridge_count: academicBridges.length,
      immediate_synthesis_count: synthesisClosures.length,
      retrospective_neatness_count: retrospective.length,
      rhetorical_valuation_count: valuation.length,
      nominalised_opening_count: nominalisedOpening.length,
      nominalisation_dense_count: nominalisationDense.length,
      clause_stacking_count: clauseStacked.length,
      local_broad_clause_regularity_count: locallyRegularBroadSentences.length,
      taxonomy_pressure_count: taxonomy.length,
      low_propositional_yield_count: lowYield.length,
      discourse_architecture_signal_count: architecture.signals?.length || 0,
      ordinary_content_sentence_count: ordinaryContent.length,
      adjacent_proposition_echo_count: propositionEcho.count,
      total_risk_score: totalRiskScore,
    },
    proposition_echo: propositionEcho,
    ordinary_content_sentence_indices: ordinaryContent,
    target_blocks: targetBlocks,
    should_rework: targetBlocks.length > 0 && totalRiskScore >= 6,
    note: "Residual diagnostics evaluate the candidate revision itself, including discourse architecture, transition choreography, immediate synthesis and clause-stacking regularity. They decide whether selective local rework is warranted; they are not authorship probabilities or detector-score targets.",
  };
}
