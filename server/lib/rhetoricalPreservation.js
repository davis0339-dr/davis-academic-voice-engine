import { splitSentences, wordCount } from "./sentences.js";
import { parseTextStructure } from "./textStructure.js";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for", "from", "had", "has", "have",
  "in", "into", "is", "it", "its", "of", "on", "or", "that", "the", "their", "these", "this", "those", "to",
  "was", "were", "which", "with", "within", "without", "also", "than", "then", "there", "such", "both",
]);

const ROLE_PATTERNS = {
  definition: /\b(?:is defined as|refers to|means|denotes|can be understood as|is conceptualised as)\b/i,
  narrowing_transition: /\b(?:point of departure|focus(?:es|ed)? (?:here|on)|turn(?:s|ed)? to|narrow(?:s|ed)?|more appropriate|for this study|the present study)\b/i,
  evidence: /(?:\([^)]*\b(?:19|20)\d{2}[a-z]?[^)]*\)|\b\d+(?:\.\d+)?%|\bfound\b|\breported\b|\bdocumented\b|\bshowed\b|\bestimated\b|\baccording to\b)/i,
  evidence_qualification: /\b(?:should not be interpreted|does not establish|cannot be taken|not a universal|in this sample|subject to|conditional on|only when|except where|the percentage|the estimate)\b/i,
  authorial_interpretation: /\b(?:its relevance|this matters|the implication|illustrat(?:es|ed) why|helps explain|is significant because|analytically distinct|should remain|means that|suggests why|important because|the point is)\b/i,
  contrast: /\b(?:but|yet|whereas|while|by contrast|in contrast|conversely|on the other hand|rather than)\b/i,
  concession: /\b(?:although|though|even though|despite|notwithstanding|nevertheless|nonetheless|admittedly)\b/i,
  causal_explanation: /\b(?:because|therefore|thereby|hence|as a result|consequently|owing to|depends? on|leads? to|contributes? to)\b/i,
  synthesis: /\b(?:taken together|collectively|overall|in sum|thus|therefore|the foregoing|these patterns|this evidence)\b/i,
  temporal_transition: /\b(?:over time|historically|subsequently|previously|more recently|during|before|after|since|between \d{4})\b/i,
  methodological_qualification: /\b(?:methodolog|measurement|proxy|estimation|model specification|research design|cross-sectional|longitudinal|in this sample)\b/i,
  limitation_caveat: /\b(?:limitation|caveat|however|nevertheless|does not|cannot|may not|should not|remains uncertain|with caution)\b/i,
  implication: /\b(?:implication|therefore|consequently|matters for|suggests that|requires|calls for)\b/i,
  link_forward: /\b(?:the next|the following|subsequent|in the section that follows|provides the basis|sets up|leads to)\b/i,
};

const TRANSITION_OPENING = /^(?:across|within|elsewhere|in|from|turning to|by contrast|conversely|more recently|historically)\b/i;
const COMPLEMENTARY_PLACE = /^[A-Z][A-Za-z.-]+(?:\s+[A-Z][A-Za-z.-]+){0,3}\s+(?:provides|offers|presents|illustrates)\s+(?:a\s+)?(?:complementary|contrasting|parallel|different)\b/;
const MODAL_RE = /\b(may|might|could|can|appears?|seems?|suggests?|indicates?|likely|possibly|potentially)\b/gi;
const ASSERTIVE_RE = /\b(demonstrates?|proves?|establishes?|determines?|always|necessarily|clearly shows?|confirms?)\b/gi;
const CAUSAL_RE = /\b(causes?|determines?|drives?|produces?|results? in|leads? to)\b/gi;
const ASSOCIATION_RE = /\b(associated with|related to|linked to|correlat(?:es|ed|ion)|relationship with)\b/gi;
const EQUALITY_RE = /\b(equally|equivalent|the same as|to the same extent|identical)\b/gi;
const UNIVERSAL_RE = /\b(always|all|every|universally|invariably|necessarily|without exception)\b/gi;
const SCOPE_RE = /\b(in this sample|among|within|for the firms?|in the period|during|under these conditions|in this context)\b/gi;
const DIRECTION_RE = /\b(increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|higher|lower|positive|negative|rise|fall|improv(?:e|es|ed|ement)|worsen(?:s|ed|ing))\b/gi;
const TEMPORAL_RE = /\b(previously|currently|subsequently|before|after|during|between|over time|more recently|historically)\b/gi;
const RELATION_MARKER_RE = /\b(but|yet|whereas|while|although|though|despite|because|therefore|however|nevertheless|rather than|by contrast|conversely|as a result|consequently)\b/gi;
const EPISTEMIC_MARKER_RE = /\b(may|might|could|can|appears?|seems?|suggests?|indicates?|likely|possibly|potentially|should|must|cannot|does not|in this sample|under these conditions)\b/gi;
const CITATION_ANCHOR_RE = /\([^)]*\b(?:19|20)\d{2}[a-z]?[^)]*\)/g;

function stem(token) {
  return token
    .replace(/(?:isation|ization|ational|iveness|fulness|ously)$/i, "")
    .replace(/(?:ments?|ingly|edly|ation|ities|ity|ing|ed|es|s)$/i, "")
    .slice(0, 18);
}

function contentTokens(text) {
  return new Set(
    (String(text || "").toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
      .filter((token) => !STOPWORDS.has(token))
      .map(stem)
      .filter((token) => token.length >= 3)
  );
}

function propositionAnchors(text, limit = 7) {
  const anchors = [];
  for (const token of String(text || "").toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []) {
    if (STOPWORDS.has(token) || token.length < 4 || anchors.includes(token)) continue;
    anchors.push(token);
    if (anchors.length >= limit) break;
  }
  return anchors;
}

function compactMatches(regex, text, limit = 4) {
  regex.lastIndex = 0;
  return [...String(text || "").matchAll(regex)]
    .map((match) => match[0].trim().toLowerCase())
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .slice(0, limit);
}

function citationAnchors(text) {
  CITATION_ANCHOR_RE.lastIndex = 0;
  return [...String(text || "").matchAll(CITATION_ANCHOR_RE)]
    .map((match) => match[0].replace(/\s+/g, " ").slice(0, 100))
    .slice(0, 3);
}

function coverage(sourceTokens, candidateTokens) {
  if (!sourceTokens.size) return 1;
  let shared = 0;
  for (const token of sourceTokens) if (candidateTokens.has(token)) shared += 1;
  return shared / sourceTokens.size;
}

function paragraphs(text) {
  return parseTextStructure(text).blocks.filter((block) => block.type === "paragraph" || block.type === "list_item");
}

function sentenceRoles(sentence, { firstInParagraph = false } = {}) {
  const roles = [];
  if (firstInParagraph) roles.push("paragraph_thesis_or_topic");
  for (const [role, pattern] of Object.entries(ROLE_PATTERNS)) {
    if (pattern.test(sentence)) roles.push(role);
  }
  if (TRANSITION_OPENING.test(sentence) || COMPLEMENTARY_PLACE.test(sentence)) roles.push("geographic_or_conceptual_transition");
  if (firstInParagraph && wordCount(sentence) <= 32 && !ROLE_PATTERNS.evidence.test(sentence)) roles.push("conceptual_framing");
  return [...new Set(roles)];
}

function sentenceRecords(text) {
  const records = [];
  for (const paragraph of paragraphs(text)) {
    const sentences = splitSentences(paragraph.text);
    sentences.forEach((sentence, localIndex) => {
      records.push({
        sentence,
        paragraphIndex: paragraph.paragraphOrdinal,
        localIndex,
        roles: sentenceRoles(sentence, { firstInParagraph: localIndex === 0 }),
        tokens: contentTokens(sentence),
      });
    });
  }
  return records;
}

function bestSentenceMatch(source, candidates) {
  let best = { score: 0, candidate: null };
  for (let i = 0; i < candidates.length; i += 1) {
    const one = coverage(source.tokens, candidates[i].tokens);
    if (one > best.score) best = { score: one, candidate: candidates[i] };
    if (i < candidates.length - 1) {
      const pairTokens = new Set([...candidates[i].tokens, ...candidates[i + 1].tokens]);
      const pair = coverage(source.tokens, pairTokens);
      if (pair > best.score) {
        best = { score: pair, candidate: { ...candidates[i], sentence: `${candidates[i].sentence} ${candidates[i + 1].sentence}`, roles: [...new Set([...candidates[i].roles, ...candidates[i + 1].roles])] } };
      }
    }
  }
  return best;
}

function relationClauses(sentence) {
  return String(sentence || "").split(/\s+(?:but|yet|whereas|while|although|though|because|therefore|however|nevertheless|rather than)\s+/i)
    .map((part) => part.trim()).filter((part) => wordCount(part) >= 4);
}

function collectMatches(regex, text) {
  regex.lastIndex = 0;
  return [...String(text || "").matchAll(regex)].map((match) => match[0].toLowerCase());
}

function hasMatch(regex, text) {
  regex.lastIndex = 0;
  return regex.test(String(text || ""));
}

function semanticChanges(sourceText, revisedText) {
  const changes = [];
  const sourceRecords = sentenceRecords(sourceText);
  const revisedRecords = sentenceRecords(revisedText);
  const localModalityStrengthening = revisedRecords.some((record) => {
    if (!hasMatch(ASSERTIVE_RE, record.sentence) || hasMatch(MODAL_RE, record.sentence)) return false;
    const match = bestSentenceMatch(record, sourceRecords);
    return match.score >= 0.28 && hasMatch(MODAL_RE, match.candidate?.sentence || "") && !hasMatch(ASSERTIVE_RE, match.candidate?.sentence || "");
  });
  if (localModalityStrengthening) {
    changes.push({ type: "modality_or_certainty", detail: "A locally matched qualified proposition appears to have been restated with stronger certainty." });
  }
  const localCausalityStrengthening = revisedRecords.some((record) => {
    if (!hasMatch(CAUSAL_RE, record.sentence)) return false;
    const match = bestSentenceMatch(record, sourceRecords);
    const sourceSentence = match.candidate?.sentence || "";
    return match.score >= 0.28 && hasMatch(ASSOCIATION_RE, sourceSentence) && !hasMatch(CAUSAL_RE, sourceSentence);
  });
  if (localCausalityStrengthening) {
    changes.push({ type: "causality", detail: "A locally matched associational proposition appears to have been strengthened into causality." });
  }
  const equalityIntroducedLocally = revisedRecords
    .filter((record) => /\b(?:equally|equivalent|the same as|to the same extent|identical)\b/i.test(record.sentence))
    .some((record) => {
      const match = bestSentenceMatch(record, sourceRecords);
      return match.score >= 0.2 && !/\b(?:equally|equivalent|the same as|to the same extent|identical)\b/i.test(match.candidate?.sentence || "");
    });
  if (equalityIntroducedLocally) {
    changes.push({ type: "comparison_or_magnitude", detail: "The revision introduced equality/equivalence that the source did not assert." });
  }
  const localScopeGeneralisation = revisedRecords.some((record) => {
    if (!hasMatch(UNIVERSAL_RE, record.sentence)) return false;
    const match = bestSentenceMatch(record, sourceRecords);
    const sourceSentence = match.candidate?.sentence || "";
    return match.score >= 0.28 && hasMatch(SCOPE_RE, sourceSentence) && !hasMatch(UNIVERSAL_RE, sourceSentence);
  });
  if (localScopeGeneralisation) {
    changes.push({ type: "scope_or_generalisation", detail: "A bounded source proposition may have been generalised." });
  }
  const directionPolarity = (text) => ({
    up: /\b(?:increase|increases|increased|increasing|higher|rise|grew|growth|improve|improves|improved|improvement)\b/i.test(text),
    down: /\b(?:decrease|decreases|decreased|decreasing|lower|fall|fell|decline|declined|worsen|worsened)\b/i.test(text),
    positive: /\bpositive\b/i.test(text),
    negative: /\bnegative\b/i.test(text),
  });
  const sourceDirection = directionPolarity(sourceText);
  const revisedDirection = directionPolarity(revisedText);
  if ((sourceDirection.up && revisedDirection.down && !sourceDirection.down) ||
      (sourceDirection.down && revisedDirection.up && !sourceDirection.up) ||
      (sourceDirection.positive && revisedDirection.negative && !sourceDirection.negative) ||
      (sourceDirection.negative && revisedDirection.positive && !sourceDirection.positive)) {
    changes.push({ type: "direction_or_magnitude", detail: "The revision appears to reverse the source's directional relationship." });
  }
  if (collectMatches(TEMPORAL_RE, sourceText).length && !collectMatches(TEMPORAL_RE, revisedText).length) {
    changes.push({ type: "temporality", detail: "Source temporal qualification or sequencing was removed." });
  }
  return changes;
}

function normaliseLengthPreference(value) {
  const requested = String(value || "auto").toLowerCase();
  if (["normal", "maintain", "preserve", "same", "same_length", "similar"].includes(requested)) return "maintain";
  if (["short", "shorter", "concise"].includes(requested)) return "concise";
  if (["long", "longer", "expand"].includes(requested)) return "expand";
  return "auto";
}

export function buildRhetoricalLedger(text) {
  const records = sentenceRecords(text);
  const grouped = new Map();
  records.forEach((record, sentenceIndex) => {
    if (!grouped.has(record.paragraphIndex)) grouped.set(record.paragraphIndex, []);
    grouped.get(record.paragraphIndex).push({
      sentenceIndex,
      roles: record.roles,
      propositionAnchors: propositionAnchors(record.sentence),
      logicalRelations: compactMatches(RELATION_MARKER_RE, record.sentence),
      epistemicQualifiers: compactMatches(EPISTEMIC_MARKER_RE, record.sentence),
      citationAnchors: citationAnchors(record.sentence),
      relationClauses: relationClauses(record.sentence).length,
    });
  });
  return [...grouped.entries()].map(([paragraphIndex, sentences]) => ({
    paragraphIndex,
    rhetoricalSequence: sentences.map((sentence) => sentence.roles[0] || "proposition"),
    sentences,
  }));
}

export function analyseRhetoricalSemanticPreservation(sourceText, revisedText, { lengthPreference = "auto" } = {}) {
  const sourceRecords = sentenceRecords(sourceText);
  const revisedRecords = sentenceRecords(revisedText);
  const sourceParagraphs = paragraphs(sourceText);
  const revisedParagraphs = paragraphs(revisedText);
  const preference = normaliseLengthPreference(lengthPreference);
  const sourceWords = wordCount(sourceText);
  const revisedWords = wordCount(revisedText);
  const lengthRatio = sourceWords ? revisedWords / sourceWords : 1;
  const softRange = preference === "maintain" ? [0.95, 1.10] : preference === "concise" ? [0.65, 1.0] : preference === "expand" ? [1.0, 1.35] : [0.90, 1.15];

  const possibleLosses = [];
  const roleLosses = [];
  for (let index = 0; index < sourceRecords.length; index += 1) {
    const source = sourceRecords[index];
    const match = bestSentenceMatch(source, revisedRecords);
    const distinctive = source.tokens.size >= 4;
    if (distinctive && match.score < 0.24) {
      possibleLosses.push({ sentence_index: index, paragraph_index: source.paragraphIndex, roles: source.roles, excerpt: source.sentence.slice(0, 240), match_score: Number(match.score.toFixed(3)) });
      continue;
    }
    const functionalRoles = source.roles.filter((role) => !["paragraph_thesis_or_topic", "conceptual_framing", "evidence"].includes(role));
    const missingRoles = functionalRoles.filter((role) => !match.candidate?.roles?.includes(role));
    if (missingRoles.length && match.score >= 0.24) {
      roleLosses.push({ sentence_index: index, paragraph_index: source.paragraphIndex, roles: missingRoles, excerpt: source.sentence.slice(0, 240), match_score: Number(match.score.toFixed(3)) });
    }
  }

  const paragraphCompression = sourceParagraphs.map((paragraph, index) => {
    const sourceTokens = contentTokens(paragraph.text);
    let best = { score: 0, ratio: 0, candidate_index: null };
    revisedParagraphs.forEach((candidate, candidateIndex) => {
      const score = coverage(sourceTokens, contentTokens(candidate.text));
      if (score > best.score) best = { score, ratio: wordCount(candidate.text) / Math.max(1, wordCount(paragraph.text)), candidate_index: candidateIndex };
    });
    return { paragraph_index: index, candidate_paragraph_index: best.candidate_index, ratio: Number(best.ratio.toFixed(3)), match_score: Number(best.score.toFixed(3)) };
  }).filter((item) => item.match_score >= 0.25 && item.ratio < (preference === "maintain" ? 0.78 : 0.60));

  const semantic = semanticChanges(sourceText, revisedText);
  const countRole = (role) => roleLosses.filter((item) => item.roles.includes(role)).length + possibleLosses.filter((item) => item.roles.includes(role)).length;
  // The selected 95-110% band is a soft diagnostic range, not a lexical
  // preservation proxy. A candidate outside it needs review, but length alone
  // becomes a hard failure only at an extreme departure. Otherwise a genuine
  // reconstruction can be rejected simply because it does not reuse enough of
  // the source sentence shells.
  const maintainedLengthHardFailure = preference === "maintain" && (lengthRatio < 0.75 || lengthRatio > 1.50);
  const sourcePropositionsPreserved = Math.max(0, sourceRecords.length - possibleLosses.length);
  const unsupportedAdditions = semantic.filter((item) => ["comparison_or_magnitude", "causality", "direction_or_magnitude", "scope_or_generalisation"].includes(item.type));
  // Lexical matching is deliberately only supporting evidence: a deep but
  // faithful paraphrase can have modest token overlap. Escalate proposition or
  // role loss only when it is repeated/material, or when compression supplies
  // corroborating evidence. Explicit semantic-force changes remain hard fails.
  const materialLossFloor = Math.max(3, Math.ceil(sourceRecords.length * 0.12));
  const widespreadParagraphCompression = paragraphCompression.length >= Math.max(2, Math.ceil(sourceParagraphs.length * 0.30));
  const compressionCorroboratesLoss = lengthRatio < 0.88 || (lengthRatio < 0.92 && widespreadParagraphCompression);
  const materialPropositionLoss = possibleLosses.length > 0 && compressionCorroboratesLoss &&
    (possibleLosses.length >= materialLossFloor || lengthRatio < 0.93);
  const materialRoleLoss = roleLosses.length > 0 && (
    materialPropositionLoss ||
    lengthRatio < 0.85 ||
    widespreadParagraphCompression
  );
  const passed = !maintainedLengthHardFailure && !materialPropositionLoss && !materialRoleLoss && semantic.length === 0;
  const reviewRequired = !passed || possibleLosses.length > 0 || roleLosses.length > 0 ||
    lengthRatio < softRange[0] || lengthRatio > softRange[1] || paragraphCompression.length > 0;
  const roleChangeCounts = {
    topic_or_framing: countRole("paragraph_thesis_or_topic") + countRole("conceptual_framing"),
    transitions: countRole("geographic_or_conceptual_transition") + countRole("narrowing_transition") + countRole("temporal_transition") + countRole("link_forward"),
    interpretation: countRole("authorial_interpretation") + countRole("implication") + countRole("synthesis"),
    qualification_or_caveat: countRole("evidence_qualification") + countRole("limitation_caveat") + countRole("methodological_qualification"),
    contrast_or_concession: countRole("contrast") + countRole("concession"),
  };

  return {
    audit_version: "rhetorical-semantic-v2",
    passed,
    review_required: reviewRequired,
    length_preference: preference,
    source_word_count: sourceWords,
    revision_word_count: revisedWords,
    overall_length_ratio: Number(lengthRatio.toFixed(3)),
    length_soft_range: softRange,
    length_within_soft_range: lengthRatio >= softRange[0] && lengthRatio <= softRange[1],
    length_requires_substantive_reason: !((lengthRatio >= softRange[0]) && (lengthRatio <= softRange[1])),
    source_propositions_total: sourceRecords.length,
    source_propositions_preserved: sourcePropositionsPreserved,
    possible_proposition_losses: possibleLosses,
    material_proposition_loss: materialPropositionLoss,
    material_rhetorical_role_loss: materialRoleLoss,
    lexical_overlap_is_supporting_evidence_only: true,
    // Marker-based role changes are corroborative evidence, not proof of loss:
    // a deep reconstruction can preserve a transition or interpretation using
    // different lexical cues. Only publish a role as "lost" when the audit's
    // independent compression/proposition evidence makes that loss material.
    possible_topic_or_framing_role_changes: roleChangeCounts.topic_or_framing,
    possible_transition_role_changes: roleChangeCounts.transitions,
    possible_interpretive_role_changes: roleChangeCounts.interpretation,
    possible_qualification_or_caveat_role_changes: roleChangeCounts.qualification_or_caveat,
    possible_contrast_or_concession_role_changes: roleChangeCounts.contrast_or_concession,
    topic_or_framing_sentences_lost: materialRoleLoss ? roleChangeCounts.topic_or_framing : 0,
    transitions_lost: materialRoleLoss ? roleChangeCounts.transitions : 0,
    interpretive_statements_lost: materialRoleLoss ? roleChangeCounts.interpretation : 0,
    qualifications_or_caveats_lost: materialRoleLoss ? roleChangeCounts.qualification_or_caveat : 0,
    contrast_or_concession_lost: materialRoleLoss ? roleChangeCounts.contrast_or_concession : 0,
    modality_changes: semantic.filter((item) => item.type === "modality_or_certainty"),
    causality_changes: semantic.filter((item) => item.type === "causality"),
    scope_or_generalisation_changes: semantic.filter((item) => item.type === "scope_or_generalisation"),
    comparison_magnitude_or_direction_changes: semantic.filter((item) => ["comparison_or_magnitude", "direction_or_magnitude"].includes(item.type)),
    temporality_changes: semantic.filter((item) => item.type === "temporality"),
    unsupported_additions: unsupportedAdditions,
    paragraphs_compressed_beyond_threshold: paragraphCompression,
    role_losses: roleLosses,
    semantic_changes: semantic,
  };
}

export function hasProtectedLogicalRelationship(sentence) {
  const text = String(sentence || "");
  return /\b(?:while|whereas|although|though|because|unless|if|but|yet|rather than|on the one hand|on the other hand|not only|both)\b/i.test(text)
    || /;/.test(text)
    || /\b(?:more|less|higher|lower)\b[\s\S]{0,80}\bthan\b/i.test(text);
}

