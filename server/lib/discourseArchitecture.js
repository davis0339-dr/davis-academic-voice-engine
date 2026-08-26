// Document-level discourse architecture diagnostics.
// These signals describe patterned rhetorical organisation; they are not
// authorship claims. The planner uses them to catch cases where individually
// fluent sentences collectively form over-regular, over-packaged prose.

import { splitSentences, wordCount } from "./sentences.js";
import { parseTextStructure } from "./textStructure.js";

const ENUMERATION_OPEN_RE = /^(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth(?:ly)?|fifth(?:ly)?|finally)\b/i;
const EXPLICIT_TRANSITION_RE = /^(?:however|moreover|furthermore|additionally|therefore|thus|consequently|nevertheless|nonetheless|similarly|conversely|indeed|importantly|notably|overall|together|in contrast|by contrast|as a result|for example|for instance|accordingly)\b/i;
const PACKAGING_RE = /\b(?:two|three|four|five|several)\s+(?:(?:principal|main|major|mutually\s+reinforcing|theoretical|policy|practical|empirical|methodological|conceptual|regulatory|managerial)\s+)?(?:findings|contributions|pillars|implications|reasons|points|steps|arguments|attributes|dimensions|themes|patterns|lessons)\b/i;
const CLOSURE_RE = /(?:^(?:thus|therefore|consequently|accordingly|overall|together|in sum|taken together)\b|\b(?:this|these|the evidence|the pattern|the result|the finding|the implication)\s+(?:therefore\s+)?(?:shows?|suggests?|indicates?|implies?|demonstrates?|means?|supports?|reveals?)\b)/i;
const APHORISTIC_RE = /(?:\b(?:is|are)\s+not\s+[^,.!?;:]{1,70}\bbut\b|^(?:the\s+)?(?:point|answer|problem|goal|distinction|lesson|result|signal)\s+(?:is|lies|remains)\b|\bmasquerad(?:e|es|ing)\s+as\b|\bwearing\s+an?\b)/i;
// Keep this deliberately bounded. Broad greedy patterns over whole academic
// sentences can produce false rhetorical-symmetry flags and unnecessary edits.
const PARALLEL_CONTRAST_RE = /(?:\bon the one hand\b|\bon the other hand\b|\brather than\b|\bnot\b[^.!?;]{1,100}\bbut\b|\bthe\s+[A-Za-z-]+(?:\s+[A-Za-z-]+){0,3}\s+view\s+holds\b)/i;
const CITATION_RE = /(?:\([^)\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^)\n]*\)|\b[A-Z][A-Za-z'’-]+(?:\s+(?:&|and)\s+[A-Z][A-Za-z'’-]+|\s+et al\.)?\s*\((?:18|19|20)\d{2}[a-z]?\))/;

const PARENTHETICAL_CITATION_RE = /\([^\)]{0,400}(?:(?:18|19|20)\d{2}[a-z]?|n\.d\.)[^\)]*\)/gi;

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function indicesMatching(sentences, predicate) {
  const hits = [];
  sentences.forEach((sentence, index) => {
    if (predicate(sentence, index)) hits.push(index);
  });
  return hits;
}

function reasoningParagraphs(structure) {
  return structure.blocks.filter((block) => block.type === "paragraph" && block.sentenceIndices.length > 0);
}

function lastSentenceIndices(structure) {
  return reasoningParagraphs(structure)
    .map((block) => block.sentenceIndices[block.sentenceIndices.length - 1])
    .filter(Number.isInteger);
}

function hasThreePartEnumeration(sentence) {
  const withoutCitations = String(sentence || "").replace(PARENTHETICAL_CITATION_RE, "");
  const clauses = withoutCitations.split(/\s+(?:yet|but|although|though|whereas|while)\s+|;/i);
  return clauses.some((clause) => {
    const selected = clause.includes(":") ? clause.slice(clause.lastIndexOf(":") + 1) : clause;
    const segment = selected.trim().replace(/^[,:]\s*|\s*[,:]$/g, "");
    const originalCommaCount = (segment.match(/,/g) || []).length;
    const normalised = segment.replace(/,\s+(and|or)\s+/gi, " $1 ").trim();
    if (!/,/.test(normalised) || !/\s+(?:and|or)\s+/i.test(normalised)) return false;
    const commaCount = (normalised.match(/,/g) || []).length;
    const conjunctionCount = (normalised.match(/\s+(?:and|or)\s+/gi) || []).length;
    if (commaCount === 1 && conjunctionCount === 1) return true;
    // A three-clause "whether" construction can contain an internal and/or in
    // the final clause. The two original commas still mark the three parallel
    // propositions, so do not miscount that internal relationship as item four.
    return /\bwhether\b/i.test(segment) && originalCommaCount === 2 && commaCount === 1 && conjunctionCount === 2;
  });
}

export function analyseDiscourseArchitecture(text, suppliedStructure = null) {
  const sentences = splitSentences(text);
  const structure = suppliedStructure || parseTextStructure(text);
  const packagingIndices = indicesMatching(sentences, (sentence) => PACKAGING_RE.test(sentence));
  const enumerationIndices = indicesMatching(sentences, (sentence) => ENUMERATION_OPEN_RE.test(sentence.trim()));
  const transitionIndices = indicesMatching(sentences, (sentence) => EXPLICIT_TRANSITION_RE.test(sentence.trim()));
  const aphoristicIndices = indicesMatching(sentences, (sentence) => {
    const words = wordCount(sentence);
    return words >= 4 && words <= 24 && !CITATION_RE.test(sentence) && APHORISTIC_RE.test(sentence);
  });
  const parallelContrastIndices = indicesMatching(sentences, (sentence) => PARALLEL_CONTRAST_RE.test(sentence));
  const triadicEnumerationIndices = indicesMatching(sentences, hasThreePartEnumeration);

  const paragraphLastIndices = lastSentenceIndices(structure);
  const closureIndices = paragraphLastIndices.filter((index) => CLOSURE_RE.test(sentences[index] || ""));
  const paragraphCount = reasoningParagraphs(structure).length;

  const metrics = {
    measurement_version: "discourse-architecture-v1",
    sentence_count: sentences.length,
    reasoning_paragraph_count: paragraphCount,
    packaging_phrase_count: packagingIndices.length,
    enumeration_opening_count: enumerationIndices.length,
    explicit_transition_opening_count: transitionIndices.length,
    explicit_transition_opening_ratio: ratio(transitionIndices.length, sentences.length),
    aphoristic_compression_count: aphoristicIndices.length,
    parallel_contrast_count: parallelContrastIndices.length,
    triadic_enumeration_count: triadicEnumerationIndices.length,
    triadic_enumeration_ratio: ratio(triadicEnumerationIndices.length, sentences.length),
    paragraph_closure_signal_count: closureIndices.length,
    paragraph_closure_signal_ratio: ratio(closureIndices.length, paragraphCount),
  };

  const signals = [];

  if (packagingIndices.length >= 2) {
    signals.push({
      id: "argument_packaging",
      severity: packagingIndices.length >= 3 ? "high" : "medium",
      sentenceIndices: packagingIndices,
      interpretation: "The document repeatedly announces arguments as pre-counted packages such as findings, contributions, pillars or implications.",
      action: "Keep any genuinely useful classification, but do not repeatedly announce and close arguments in numbered conceptual bundles. Let some distinctions emerge from the evidence and discussion instead of pre-packaging each section.",
    });
  }

  if (enumerationIndices.length >= 4 || ratio(enumerationIndices.length, sentences.length) >= 0.08) {
    signals.push({
      id: "enumeration_saturation",
      severity: "medium",
      sentenceIndices: enumerationIndices,
      interpretation: "First/Second/Third-style sequencing is carrying an unusually large share of the document's progression.",
      action: "Retain enumeration where the author is genuinely listing items, but remove repeated rhetorical counting when ordinary scholarly progression, comparison, evidence or carried-forward context can organise the discussion more naturally.",
    });
  }

  if (sentences.length >= 8 && metrics.explicit_transition_opening_ratio >= 0.3) {
    signals.push({
      id: "transition_saturation",
      severity: metrics.explicit_transition_opening_ratio >= 0.45 ? "high" : "medium",
      sentenceIndices: transitionIndices,
      interpretation: "A large proportion of sentences announce their logical relation through explicit transition words.",
      action: "Reduce reader-guidance saturation. Preserve necessary logical relations, but allow technical-term carryover, evidence sequence, grammatical continuity and paragraph development to carry some cohesion without an overt signpost at every turn.",
    });
  }

  if (aphoristicIndices.length >= 3) {
    signals.push({
      id: "aphoristic_compression",
      severity: "medium",
      sentenceIndices: aphoristicIndices,
      interpretation: "Several short sentences are functioning as polished conceptual punchlines or compressed slogans.",
      action: "Keep occasional emphasis where it genuinely serves the argument, but dissolve excess punchline sentences into explanation, evidence or qualification so the prose does not repeatedly optimise for quotability.",
    });
  }

  if (parallelContrastIndices.length >= 3) {
    signals.push({
      id: "rhetorical_symmetry",
      severity: "medium",
      sentenceIndices: parallelContrastIndices,
      interpretation: "Balanced contrasts and parallel oppositions recur often enough to make the reasoning feel architecturally symmetrical.",
      action: "Preserve real contrasts, but do not force every competing idea into a matched pair. Allow asymmetry where the evidence or conceptual weight is asymmetric.",
    });
  }

  if (triadicEnumerationIndices.length >= 4 || (sentences.length >= 12 && triadicEnumerationIndices.length >= 3 && metrics.triadic_enumeration_ratio >= 0.08)) {
    signals.push({
      id: "triadic_enumeration_saturation",
      severity: triadicEnumerationIndices.length >= 7 || (sentences.length >= 12 && triadicEnumerationIndices.length >= 5 && metrics.triadic_enumeration_ratio >= 0.14) ? "high" : "medium",
      sentenceIndices: triadicEnumerationIndices,
      interpretation: `${triadicEnumerationIndices.length} sentences package distinct material into three-part lists or parallel triads. Individual triads may be accurate and useful, but their recurrence gives unrelated propositions the same pre-balanced architecture.`,
      action: "Preserve every substantive item. Keep fixed taxonomies, formal construct lists and evidentially necessary groupings intact; elsewhere, vary the relationship through explanation, clause hierarchy, sequencing or selective sentence redistribution rather than repeatedly presenting a completed set of three.",
    });
  }

  if (paragraphCount >= 4 && metrics.paragraph_closure_signal_ratio >= 0.6) {
    signals.push({
      id: "closure_regularisation",
      severity: metrics.paragraph_closure_signal_ratio >= 0.75 ? "high" : "medium",
      sentenceIndices: closureIndices,
      interpretation: "Most paragraphs end by explicitly resolving, interpreting or summarising their own argument, producing unusually regular rhetorical closure.",
      action: "Do not force every paragraph to end with a neat implication. Some paragraphs may end on evidence, a qualification, an unresolved tension or a carried-forward point when that better reflects the source reasoning.",
    });
  }

  return { metrics, signals };
}
