// Diagnose whether academically competent prose is carrying too much intellectual
// work in too little explanatory space. This is a revision-planning signal, not an
// authorship detector and not a word-count target.

import { splitSentences, wordCount } from "./sentences.js";
import { parseTextStructure } from "./textStructure.js";

const CITATION_RE = /\((?:[^()\n]{0,180})(?:18|19|20)\d{2}[a-z]?(?:[^()\n]{0,180})\)|\b[A-Z][A-Za-z'’-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'’-]+|\s+et\s+al\.)?\s*\((?:18|19|20)\d{2}[a-z]?\)/g;
const ATTRIBUTION_RE = /\b(?:found|reported|showed|demonstrated|observed|associated|linked|examined|argued|suggested|identified|documented|estimated)\b/gi;
const EXPLANATION_RE = /\b(?:because|therefore|thus|which means|in other words|reflects?|indicates?|suggests?|implies?|arises? from|can be explained|may be due to|is important because|matters because)\b/gi;
const CONDITION_RE = /\b(?:when|where|under|depending on|conditional|condition|conditions|varied with|varies with|changed with|changes with|higher leverage|lower leverage|credit conditions|leadership structure)\b/gi;
const DISTINCTION_RE = /\b(?:different|differ|distinguish|distinct|not the same|captures?|reflects?|measures?|represents?|rather than|by contrast|whereas)\b/gi;
const MEASUREMENT_RE = /\b(?:measure|measures|measurement|outcome|outcomes|proxy|proxies|indicator|indicators|rating|ratings|yield|yields|spread|spreads|cost of debt|interest cost|interest expense)\b/gi;
const CONTEXT_RE = /\b(?:country|countries|institutional|institution|legal system|regulation|regulatory|ownership|credit market|financial market|jurisdiction|United States|U\.S\.|international|cross-country)\b/gi;
const TEMPORAL_RE = /\b(?:period|years?|recent|earlier|older|contemporary|before|after|during|COVID|monetary|interest rates?|tightening|credit conditions)\b/gi;
const SYNTHESIS_OPEN_RE = /^(?:this|these|such|taken together|overall|collectively|the implication|the evidence therefore|what emerges)\b/i;

function countMatches(text, re) {
  return (String(text || "").match(re) || []).length;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function citationCount(text) {
  return countMatches(text, CITATION_RE);
}

function sentenceIndexMap(structure) {
  const map = new Map();
  for (const block of structure.blocks || []) {
    for (const index of block.sentenceIndices || []) map.set(index, block.blockIndex);
  }
  return map;
}

function buildParagraphRow(block) {
  const text = String(block.text || "").trim();
  const sentences = splitSentences(text);
  const words = wordCount(text);
  const citations = citationCount(text);
  const attributions = countMatches(text, ATTRIBUTION_RE);
  const explanations = countMatches(text, EXPLANATION_RE);
  const conditions = countMatches(text, CONDITION_RE);
  const distinctions = countMatches(text, DISTINCTION_RE);
  const measurements = countMatches(text, MEASUREMENT_RE);
  const contexts = countMatches(text, CONTEXT_RE);
  const temporal = countMatches(text, TEMPORAL_RE);
  const lastSentence = sentences[sentences.length - 1] || "";
  return {
    blockIndex: block.blockIndex,
    paragraphOrdinal: block.paragraphOrdinal ?? null,
    sentenceIndices: block.sentenceIndices || [],
    text,
    words,
    sentences: sentences.length,
    citations,
    attributions,
    explanations,
    conditions,
    distinctions,
    measurements,
    contexts,
    temporal,
    wordsPerCitation: citations ? words / citations : null,
    immediateSynthesisClosure: SYNTHESIS_OPEN_RE.test(lastSentence.trim()),
  };
}

function signal(id, severity, row, interpretation, action, score = 1) {
  return {
    id,
    severity,
    blockIndex: row.blockIndex,
    paragraphOrdinal: row.paragraphOrdinal,
    sentenceIndices: row.sentenceIndices,
    interpretation,
    action,
    score,
  };
}

function paragraphSignals(row) {
  const out = [];
  if (!row.text || row.words < 35) return out;

  // Several studies compressed into very little explanatory space. This does not
  // assume that long is better; it asks whether evidence is being reported faster
  // than it is being interpreted.
  if (row.citations >= 3 && row.wordsPerCitation !== null && row.wordsPerCitation < 52 && row.sentences <= 5) {
    const severity = row.wordsPerCitation < 38 ? "high" : "medium";
    out.push(signal(
      "evidence_compression",
      severity,
      row,
      `This paragraph carries ${row.citations} citation-bearing study references in ${row.words} words, leaving relatively little space between evidence units.`,
      "Do not pad the paragraph. Where the source permits it, develop the evidential relationship: what differs across studies, what condition changes the result, what mechanism is relevant, or why the evidence matters to the present inquiry.",
      severity === "high" ? 2.2 : 1.5
    ));
  }

  if (row.citations >= 2 && row.conditions >= 2 && row.explanations <= 1 && row.words < 150) {
    out.push(signal(
      "conditional_finding_compression",
      "medium",
      row,
      "The paragraph reports conditional or changing findings but gives limited explanatory space to the conditions themselves.",
      "Develop the condition only from material already present: make clear what changed, under which circumstance, and why that conditionality matters for the research problem. Do not invent a mechanism that the evidence does not support.",
      1.4
    ));
  }

  if (row.measurements >= 4 && row.distinctions <= 1 && row.words < 145) {
    out.push(signal(
      "measurement_bundle_compression",
      "medium",
      row,
      "Several measurement/outcome terms are packed together with little explicit distinction between what they capture.",
      "Where the source already supplies the basis, distinguish the measures rather than merely listing them. Explain why related measures are not interchangeable and how that affects the present study's choice of outcome.",
      1.3
    ));
  }

  if (row.contexts >= 3 && row.citations >= 1 && row.words < 135 && row.distinctions <= 1) {
    out.push(signal(
      "institutional_context_compression",
      "medium",
      row,
      "Institutional or cross-setting evidence is present, but the paragraph moves through the context faster than it explains why the setting affects interpretation.",
      "Contextualise only from supplied evidence. Clarify which institutional difference matters to transferability or interpretation; do not add country facts that are not in the source/evidence bank.",
      1.2
    ));
  }

  if (row.temporal >= 3 && row.citations >= 1 && row.words < 135 && row.explanations <= 1) {
    out.push(signal(
      "temporal_context_compression",
      "medium",
      row,
      "The paragraph invokes time, period or changing financing conditions but gives limited development to why the timing changes interpretation.",
      "Where supported, develop the temporal reasoning: identify what changed across periods and why older evidence may not fully settle the contemporary question. Do not add events or dates not already supplied.",
      1.2
    ));
  }

  if (row.citations >= 2 && row.immediateSynthesisClosure && row.words < 155) {
    out.push(signal(
      "premature_local_synthesis",
      "low",
      row,
      "The paragraph closes a small evidence cluster with an immediate synthesis sentence. Repetition of this pattern across the document can make the argument feel pre-packaged.",
      "Keep the synthesis only if it contributes a necessary proposition. Otherwise allow evidence, qualification or an unresolved tension to carry into the next paragraph.",
      0.65
    ));
  }

  return out;
}

export function assessArgumentativeSufficiency(text, providedStructure = null) {
  const source = String(text || "").trim();
  const structure = providedStructure || parseTextStructure(source);
  const proseBlocks = (structure.blocks || []).filter((block) => block.type === "paragraph" && wordCount(block.text || "") >= 35);
  const rows = proseBlocks.map(buildParagraphRow);
  const signals = rows.flatMap(paragraphSignals);

  const score = signals.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const high = signals.filter((item) => item.severity === "high").length;
  const medium = signals.filter((item) => item.severity === "medium").length;
  const affectedBlocks = uniq(signals.map((item) => item.blockIndex));
  const coverage = rows.length ? affectedBlocks.length / rows.length : 0;

  let developmentNeed = "low";
  if (high >= 1 || score >= 4.2 || (medium >= 3 && coverage >= 0.3)) developmentNeed = "high";
  else if (medium >= 1 || score >= 1.6) developmentNeed = "moderate";

  return {
    version: "argumentative-sufficiency-v1",
    available: rows.length > 0,
    development_need: developmentNeed,
    development_score: Number(score.toFixed(2)),
    affected_paragraph_ratio: Number(coverage.toFixed(3)),
    signals,
    paragraph_rows: rows.map((row) => ({
      blockIndex: row.blockIndex,
      paragraphOrdinal: row.paragraphOrdinal,
      words: row.words,
      sentenceCount: row.sentences,
      citationCount: row.citations,
      explanationMarkerCount: row.explanations,
      conditionMarkerCount: row.conditions,
      measurementMarkerCount: row.measurements,
      contextMarkerCount: row.contexts,
      temporalMarkerCount: row.temporal,
      wordsPerCitation: row.wordsPerCitation === null ? null : Number(row.wordsPerCitation.toFixed(1)),
    })),
    sentence_block_map_size: sentenceIndexMap(structure).size,
    interpretation: developmentNeed === "high"
      ? "The source is academically usable but several paragraphs appear argumentatively compressed. Strong surface texture should not automatically block evidence-led development."
      : developmentNeed === "moderate"
        ? "Some paragraphs may benefit from selective development of evidence, conditions, measures or context without full document reconstruction."
        : "No strong argument-compression signal was detected. Do not expand simply to increase word count.",
    guardrail: "Development is authorised only from the source, supplied manuscript context or researcher-provided evidence. Word-count growth is a possible consequence of completing rhetorical work, never a target.",
  };
}
