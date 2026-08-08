// Qualitative human-discourse analysis.
//
// This module deliberately measures relations BETWEEN sentences and paragraphs
// rather than treating "human writing" as a bag of detector-sensitive surface
// features. It is not an authorship classifier and it does not try to force a
// passage toward one supposedly human numeric profile. The output is used as
// source-specific guidance: preserve reasoning that already develops naturally;
// repair repeated discourse templates, isolated mini-topic sentences, evidence
// stacking and over-signposted cohesion only when those patterns are actually
// present.

import { splitSentences, wordCount } from "./sentences.js";

const STOPWORDS = new Set(
  "the a an and or but if while of to in on for from with by as at is are was were be been being this that these those it its they their them he she his her we our i my you your not no do does did have has had which who whom whose where when how what why than then also such into over under between among through during can could may might would should will shall must".split(/\s+/)
);

const EXPLICIT_LINK_RE = /^(?:however|therefore|thus|consequently|nevertheless|nonetheless|similarly|conversely|meanwhile|instead|indeed|in contrast|by contrast|as a result|for example|for instance|at the same time|in turn|accordingly)\b/i;
const REFERENTIAL_OPEN_RE = /^(?:this|these|that|those|such|the same|the latter|the former)\s+[a-z][a-z'’-]*/i;
const GENERIC_INTERPRETIVE_BRIDGE_RE = /^(?:this|these)\s+(?:finding|findings|result|results|evidence|pattern|patterns|relationship|relationships|observation|observations|difference|differences|trend|trends)\s+(?:shows?|suggests?|indicates?|demonstrates?|implies?|means?|supports?|reveals?)\b/i;
const QUALIFICATION_RE = /\b(?:however|although|though|while|whereas|unless|except|subject to|conditional|depends? on|may|might|could|appears?|suggests?|not necessarily|cannot|does not|do not)\b/i;
const CAUSAL_RE = /\b(?:because|therefore|thus|consequently|as a result|leads? to|results? in|drives?|shapes?|affects?|influences?|due to|owing to)\b/i;
const IMPLICATION_RE = /\b(?:therefore|thus|consequently|implies?|suggests?|indicates?|means?|supports?|underscores?|highlights?|demonstrates?)\b/i;
const DEFINITION_RE = /\b(?:refers? to|is defined as|means|denotes?|captures?|represents?|is conceptualised as|is conceptualized as)\b/i;
const METHOD_RE = /\b(?:will|was|were|is|are)\s+(?:use|used|employ|employed|estimate|estimated|analyse|analyze|analysed|analyzed|collect|collected|measure|measured|sample|sampled|interview|interviewed|test|tested|examine|examined)\b/i;
const CONTRAST_RE = /\b(?:however|although|though|whereas|in contrast|by contrast|conversely|yet|but|nevertheless|nonetheless)\b/i;
const CITATION_RE = /(?:\([^)\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^)\n]*\)|\b[A-Z][A-Za-z'’-]+(?:\s+(?:&|and)\s+[A-Z][A-Za-z'’-]+|\s+et al\.)?\s*\((?:18|19|20)\d{2}[a-z]?\))/g;

function alphaTokens(text) {
  return String(text || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || [];
}

function contentTokens(text) {
  return alphaTokens(text).filter((token) => !STOPWORDS.has(token) && token.length > 2);
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length);
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function hasCitation(sentence) {
  const flags = CITATION_RE.flags.replace("g", "");
  return new RegExp(CITATION_RE.source, flags).test(sentence);
}

function classifyMove(sentence) {
  const s = sentence.trim();
  if (!s) return "other";
  if (DEFINITION_RE.test(s)) return "definition";
  if (METHOD_RE.test(s) && !hasCitation(s)) return "method_action";
  if (CONTRAST_RE.test(s)) return "contrast_qualification";
  if (hasCitation(s)) return "evidence";
  if (IMPLICATION_RE.test(s)) return "interpretation_implication";
  if (CAUSAL_RE.test(s)) return "causal_explanation";
  if (QUALIFICATION_RE.test(s)) return "qualification";
  return "claim_development";
}

function openingMode(sentence) {
  const s = sentence.trim();
  if (hasCitation(s) && /^[A-Z][A-Za-z'’-]+(?:\s+et al\.)?\s*\(/.test(s)) return "citation_led";
  if (EXPLICIT_LINK_RE.test(s)) return "explicit_connective";
  if (REFERENTIAL_OPEN_RE.test(s)) return "referential_bridge";
  if (/^(?:in|within|across|during|between|among|over|after|before)\b/i.test(s)) return "context_frame";
  if (/^(?:although|while|whereas|because|if|when|given that|despite)\b/i.test(s)) return "subordinate_frame";
  if (/^(?:this|the present|the proposed|the current)\s+(?:[A-Za-z-]+\s+){0,6}(?:study|research|analysis)\b/i.test(s)) return "study_centered";
  return "content_subject";
}

function paragraphRecords(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => wordCount(paragraph) >= 20)
    .map((paragraph, paragraphIndex) => {
      const sentences = splitSentences(paragraph).filter((sentence) => wordCount(sentence) >= 4);
      return {
        paragraph,
        paragraphIndex,
        sentences,
        moves: sentences.map(classifyMove),
        openingMode: sentences.length ? openingMode(sentences[0]) : "none",
      };
    });
}

function adjacentPairs(paragraphs) {
  const pairs = [];
  for (const paragraph of paragraphs) {
    for (let i = 1; i < paragraph.sentences.length; i++) {
      const previous = paragraph.sentences[i - 1];
      const current = paragraph.sentences[i];
      const lexicalCarryover = jaccard(contentTokens(previous), contentTokens(current));
      const explicit = EXPLICIT_LINK_RE.test(current.trim());
      const referential = REFERENTIAL_OPEN_RE.test(current.trim());
      const sharedContentCount = (() => {
        const a = new Set(contentTokens(previous));
        const b = new Set(contentTokens(current));
        let count = 0;
        for (const token of a) if (b.has(token)) count += 1;
        return count;
      })();
      const linked = explicit || referential || sharedContentCount >= 2 || lexicalCarryover >= 0.12;
      pairs.push({
        paragraphIndex: paragraph.paragraphIndex,
        previous,
        current,
        lexicalCarryover,
        explicit,
        referential,
        sharedContentCount,
        linked,
      });
    }
  }
  return pairs;
}

function maxRun(items, predicate) {
  let max = 0;
  let run = 0;
  for (const item of items) {
    if (predicate(item)) {
      run += 1;
      max = Math.max(max, run);
    } else run = 0;
  }
  return max;
}

function moveSignature(paragraph) {
  return paragraph.moves.slice(0, 4).join(">");
}

function repeatedSignatureStats(paragraphs) {
  const counts = new Map();
  for (const paragraph of paragraphs) {
    if (paragraph.moves.length < 2) continue;
    const signature = moveSignature(paragraph);
    counts.set(signature, (counts.get(signature) || 0) + 1);
  }
  const repeated = [...counts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]);
  return {
    distinct: counts.size,
    repeated,
    topCount: repeated.length ? repeated[0][1] : 0,
  };
}

function evidenceInterpretationPairs(paragraphs) {
  let evidenceSentences = 0;
  let followedByInterpretation = 0;
  let genericBridgeCount = 0;
  for (const paragraph of paragraphs) {
    for (let i = 0; i < paragraph.sentences.length; i++) {
      if (paragraph.moves[i] !== "evidence") continue;
      evidenceSentences += 1;
      const next = paragraph.sentences[i + 1];
      if (!next) continue;
      const nextMove = paragraph.moves[i + 1];
      if (["interpretation_implication", "causal_explanation", "contrast_qualification", "qualification"].includes(nextMove)) {
        followedByInterpretation += 1;
      }
      if (GENERIC_INTERPRETIVE_BRIDGE_RE.test(next.trim())) genericBridgeCount += 1;
    }
  }
  return { evidenceSentences, followedByInterpretation, genericBridgeCount };
}

export function analyseHumanDiscourse(text) {
  const paragraphs = paragraphRecords(text);
  const sentences = paragraphs.flatMap((paragraph) => paragraph.sentences);
  const pairs = adjacentPairs(paragraphs);
  const carryovers = pairs.map((pair) => pair.lexicalCarryover);
  const linkedPairs = pairs.filter((pair) => pair.linked).length;
  const explicitPairs = pairs.filter((pair) => pair.explicit || pair.referential).length;
  const openingModes = paragraphs.map((paragraph) => paragraph.openingMode);
  const openingCounts = new Map();
  for (const mode of openingModes) openingCounts.set(mode, (openingCounts.get(mode) || 0) + 1);
  const topOpeningCount = openingCounts.size ? Math.max(...openingCounts.values()) : 0;
  const signatures = repeatedSignatureStats(paragraphs);
  const evidence = evidenceInterpretationPairs(paragraphs);
  const moveCounts = new Map();
  for (const paragraph of paragraphs) for (const move of paragraph.moves) moveCounts.set(move, (moveCounts.get(move) || 0) + 1);
  const evidenceRunMax = Math.max(0, ...paragraphs.map((paragraph) => maxRun(paragraph.moves, (move) => move === "evidence")));
  const isolatedPairRunMax = Math.max(0, ...paragraphs.map((paragraph) => {
    const paragraphPairs = pairs.filter((pair) => pair.paragraphIndex === paragraph.paragraphIndex);
    return maxRun(paragraphPairs, (pair) => !pair.linked);
  }));

  const metrics = {
    measurement_version: "human-discourse-v1",
    paragraph_count: paragraphs.length,
    sentence_count: sentences.length,
    adjacent_pair_count: pairs.length,
    local_dependency_ratio: pairs.length ? Number((linkedPairs / pairs.length).toFixed(4)) : null,
    explicit_link_ratio: pairs.length ? Number((explicitPairs / pairs.length).toFixed(4)) : null,
    lexical_carryover_mean: carryovers.length ? Number(mean(carryovers).toFixed(4)) : null,
    lexical_carryover_sd: carryovers.length ? Number(stddev(carryovers).toFixed(4)) : null,
    max_unlinked_pair_run: isolatedPairRunMax,
    paragraph_opening_mode_diversity: openingModes.length ? Number((new Set(openingModes).size / openingModes.length).toFixed(4)) : null,
    top_paragraph_opening_mode_share: openingModes.length ? Number((topOpeningCount / openingModes.length).toFixed(4)) : null,
    paragraph_move_signature_diversity: paragraphs.length ? Number((signatures.distinct / paragraphs.length).toFixed(4)) : null,
    repeated_paragraph_signature_max: signatures.topCount,
    evidence_sentence_count: evidence.evidenceSentences,
    evidence_followed_by_interpretation_ratio: evidence.evidenceSentences ? Number((evidence.followedByInterpretation / evidence.evidenceSentences).toFixed(4)) : null,
    generic_evidence_bridge_count: evidence.genericBridgeCount,
    max_consecutive_evidence_sentences: evidenceRunMax,
    move_distribution: Object.fromEntries(moveCounts),
    opening_mode_distribution: Object.fromEntries(openingCounts),
  };

  const signals = [];
  if (pairs.length >= 6 && metrics.local_dependency_ratio !== null && metrics.local_dependency_ratio < 0.35 && metrics.max_unlinked_pair_run >= 3) {
    signals.push({
      issue: "isolated_proposition_texture",
      severity: "high",
      interpretation: "Several neighbouring sentences behave like independent mini-topic statements rather than one developing argument.",
      action: "Create local dependency where the reasoning supports it: carry a technical term or referent forward, let evidence lead into interpretation, or combine propositions that belong to one analytical unit. Do not add artificial connectives merely to manufacture linkage.",
    });
  }

  if (paragraphs.length >= 4 && metrics.repeated_paragraph_signature_max >= 3) {
    signals.push({
      issue: "repeated_paragraph_logic",
      severity: "high",
      interpretation: "Three or more paragraphs begin with the same sequence of rhetorical moves, making section development feel templated even when individual sentences are fluent.",
      action: "Preserve each paragraph's substantive purpose, but vary development according to its actual reasoning: some paragraphs may accumulate evidence, others contrast studies, explain a mechanism, narrow the context, define a construct, or qualify a claim.",
    });
  }

  if (paragraphs.length >= 4 && metrics.top_paragraph_opening_mode_share !== null && metrics.top_paragraph_opening_mode_share > 0.7) {
    signals.push({
      issue: "uniform_paragraph_entry",
      severity: "medium",
      interpretation: "Most paragraphs enter the discussion through the same opening mode.",
      action: "Let paragraph openings follow function rather than a fixed template. A paragraph can begin from evidence, context, contrast, a construct, a condition, or a carried-forward implication where appropriate.",
    });
  }

  if (metrics.max_consecutive_evidence_sentences >= 4) {
    signals.push({
      issue: "evidence_stacking",
      severity: "medium",
      interpretation: "A long run of evidence/citation sentences occurs without an intervening interpretive move.",
      action: "Where the source already supports the inference, synthesise or interpret the evidence instead of presenting studies as a serial catalogue. Do not invent an interpretation that is not warranted by the cited findings.",
    });
  }

  if (metrics.generic_evidence_bridge_count >= 3) {
    signals.push({
      issue: "generic_evidence_interpretation_bridge",
      severity: "medium",
      interpretation: "Evidence is repeatedly followed by generic bridges such as 'These findings show/suggest...', creating a predictable evidence-to-interpretation template.",
      action: "Keep evidence and interpretation connected, but vary the relation according to meaning: comparison, limitation, mechanism, consequence, contradiction or narrowing may carry the interpretation more naturally than a repeated generic bridge.",
    });
  }

  if (pairs.length >= 8 && metrics.explicit_link_ratio !== null && metrics.explicit_link_ratio > 0.55) {
    signals.push({
      issue: "over_signposted_cohesion",
      severity: "low",
      interpretation: "More than half of adjacent sentence relationships are carried by explicit connectives or demonstrative bridges.",
      action: "Retain links that genuinely clarify the reasoning, but allow shared terminology, grammatical continuity and evidence sequence to carry some cohesion implicitly.",
    });
  }

  return {
    metrics,
    signals,
    recommendations: signals.map((signal) => signal.action),
    principles: [
      "Human academic prose is not defined by randomness. Variation should arise from what the argument is doing.",
      "Local repetition of technical terms can be a strength when it maintains referential continuity; do not synonym-swap constructs to create artificial variety.",
      "Not every evidence sentence requires an explicit interpretation sentence, but a literature section should not become a catalogue of disconnected study summaries.",
      "Paragraphs need not share one template. Their internal shape should follow definition, comparison, mechanism, evidence synthesis, qualification, narrowing, methodological justification or another genuine rhetorical function.",
      "Epistemic caution must follow evidence strength. Do not add hedging or certainty merely to imitate a style profile.",
    ],
    note: "Qualitative discourse analysis describes reasoning and cohesion patterns in the source. It is not an AI-authorship score and is not calibrated to any detector.",
  };
}

export function humanDiscoursePenalty(analysis) {
  if (!analysis?.signals?.length) return 0;
  const weights = { high: 0.12, medium: 0.07, low: 0.03 };
  return analysis.signals.reduce((sum, signal) => sum + (weights[signal.severity] || 0.03), 0);
}
