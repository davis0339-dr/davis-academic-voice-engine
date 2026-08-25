import { candidateById, candidateIdentityFor } from "./candidateHistory.js";

const AI_LABELS = new Set(["ai", "ai_generated", "ai_paraphrased", "likely_ai"]);

function boundedScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function splitSentences(text) {
  return String(text || "").match(/[^.!?]+(?:[.!?]+|$)/g)?.map((row) => row.trim()).filter(Boolean) || [];
}

function normaliseWords(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || [];
}

function tokenSimilarity(left, right) {
  const a = new Set(normaliseWords(left));
  const b = new Set(normaliseWords(right));
  if (!a.size || !b.size) return { containment: 0, jaccard: 0 };
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return {
    containment: shared / Math.min(a.size, b.size),
    jaccard: shared / (a.size + b.size - shared),
  };
}

function paragraphRows(text) {
  let sentenceOffset = 0;
  return String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n+/).map((paragraph, blockIndex) => {
    const sentences = splitSentences(paragraph);
    const row = { blockIndex, text: paragraph.trim(), firstSentence: sentenceOffset, lastSentence: sentenceOffset + Math.max(0, sentences.length - 1) };
    sentenceOffset += sentences.length;
    return row;
  }).filter((row) => row.text);
}

function normaliseObservation(row = {}) {
  return {
    detector: String(row.detector || "External detector").slice(0, 80),
    version: row.version ? String(row.version).slice(0, 80) : null,
    classification: String(row.classification || "uncertain").toLowerCase().slice(0, 80),
    aiScore: boundedScore(row.aiScore),
    humanScore: boundedScore(row.humanScore),
    paraphrasedScore: boundedScore(row.paraphrasedScore),
    flaggedSentenceIndices: [...new Set((row.flaggedSentenceIndices || []).filter(Number.isInteger).filter((n) => n >= 0).slice(0, 250))],
    flaggedExcerpts: (row.flaggedExcerpts || []).filter((value) => typeof value === "string").map((value) => value.trim().slice(0, 280)).filter(Boolean).slice(0, 30),
    highlightedPassages: (row.highlightedPassages || []).filter((value) => value && typeof value === "object" && !Array.isArray(value)).map((value) => ({
      text: String(value.text || "").trim().slice(0, 500),
      classification: String(value.classification || "uncertain").toLowerCase().slice(0, 40),
      colour: value.colour ? String(value.colour).slice(0, 40) : null,
      page: Number.isInteger(Number(value.page)) && Number(value.page) > 0 ? Number(value.page) : null,
    })).filter((value) => value.text).slice(0, 120),
    notes: row.notes ? String(row.notes).slice(0, 1000) : null,
  };
}

function mapExcerptTargets(candidateText, excerpts = []) {
  const paragraphs = paragraphRows(candidateText);
  const sentenceRows = [];
  for (const paragraph of paragraphs) {
    splitSentences(paragraph.text).forEach((sentence, offset) => sentenceRows.push({
      sentence,
      sentenceIndex: paragraph.firstSentence + offset,
      paragraphIndex: paragraph.blockIndex,
    }));
  }
  const mappings = [];
  for (const excerpt of excerpts) {
    const exact = normaliseWords(excerpt).join(" ");
    let best = null;
    for (const row of sentenceRows) {
      const sentenceNormal = normaliseWords(row.sentence).join(" ");
      const score = tokenSimilarity(excerpt, row.sentence);
      const exactContainment = exact.length >= 20 && sentenceNormal.includes(exact);
      const matchScore = exactContainment ? 1 : (score.containment * 0.65 + score.jaccard * 0.35);
      if (!best || matchScore > best.score) best = { ...row, score: matchScore, exact: exactContainment };
    }
    if (best && (best.exact || best.score >= 0.62)) mappings.push({
      excerpt,
      sentence_index: best.sentenceIndex,
      paragraph_index: best.paragraphIndex,
      confidence: Number(best.score.toFixed(3)),
    });
  }
  return mappings;
}

function substantiveParagraphs(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n+/)
    .map((value) => value.trim()).filter(Boolean)
    .filter((value) => normaliseWords(value).length >= 12 || /[.!?][”"']?$/.test(value));
}

export function auditFeedbackRefinementChange(priorCandidateText, nextCandidateText) {
  const prior = substantiveParagraphs(priorCandidateText).slice(0, 2);
  const next = substantiveParagraphs(nextCandidateText).slice(0, 2);
  const paragraphs = prior.map((paragraph, paragraphIndex) => {
    const priorSentences = splitSentences(paragraph);
    const nextSentences = splitSentences(next[paragraphIndex] || "");
    const retained = priorSentences.filter((sourceSentence) => nextSentences.some((candidateSentence) => {
      const score = tokenSimilarity(sourceSentence, candidateSentence);
      return score.containment >= 0.86 && score.jaccard >= 0.7;
    }));
    const openingScore = tokenSimilarity(priorSentences[0] || "", nextSentences[0] || "");
    return {
      paragraph_index: paragraphIndex,
      prior_sentence_count: priorSentences.length,
      next_sentence_count: nextSentences.length,
      near_verbatim_source_sentences: retained.length,
      near_verbatim_source_share: priorSentences.length ? Number((retained.length / priorSentences.length).toFixed(3)) : 0,
      opening_sentence_near_verbatim: openingScore.containment >= 0.86 && openingScore.jaccard >= 0.7,
    };
  });
  const nearVerbatimCount = paragraphs.reduce((sum, row) => sum + row.near_verbatim_source_sentences, 0);
  const priorSentenceCount = paragraphs.reduce((sum, row) => sum + row.prior_sentence_count, 0);
  const nearVerbatimShare = priorSentenceCount ? nearVerbatimCount / priorSentenceCount : 0;
  const unchangedOpenings = paragraphs.filter((row) => row.opening_sentence_near_verbatim).length;
  return {
    version: "feedback-opening-change-v1",
    available: prior.length === 2 && next.length === 2,
    opening_paragraph_count: Math.min(prior.length, next.length),
    near_verbatim_source_sentence_share: Number(nearVerbatimShare.toFixed(3)),
    unchanged_opening_sentence_count: unchangedOpenings,
    materially_reconstructed: prior.length === 2 && next.length === 2 && nearVerbatimShare <= 0.55 && unchangedOpenings <= 1,
    paragraphs,
  };
}

export function resolveDetectorFeedback(feedback, history = {}, exactCandidateText = "") {
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) return null;
  const candidateId = String(feedback.candidateId || "");
  const rememberedCandidate = candidateById(history, candidateId);
  const reconstructedId = candidateIdentityFor(exactCandidateText, history);
  const priorCandidate = rememberedCandidate || (reconstructedId === candidateId ? { candidate_id: candidateId, candidate_text: String(exactCandidateText) } : null);
  if (!priorCandidate) return null;
  const observations = (feedback.observations || []).slice(-8).map(normaliseObservation);
  if (!observations.length) return null;

  const aiScores = observations.map((row) => row.aiScore).filter(Number.isFinite);
  const meanAiScore = aiScores.length ? aiScores.reduce((sum, value) => sum + value, 0) / aiScores.length : null;
  const aiVotes = observations.filter((row) => AI_LABELS.has(row.classification) || Number(row.aiScore) >= 70).length;
  const highSignal = (meanAiScore !== null && meanAiScore >= 70) || aiVotes >= Math.ceil(observations.length / 2);
  const paragraphs = paragraphRows(priorCandidate.candidate_text);
  const flaggedIndices = [...new Set(observations.flatMap((row) => row.flaggedSentenceIndices))];
  const machinePassages = observations.flatMap((row) => row.highlightedPassages || [])
    .filter((row) => row.classification === "ai" || row.classification === "ai_paraphrased");
  const highlightedExcerpts = machinePassages.map((row) => row.text);
  const excerptMappings = mapExcerptTargets(priorCandidate.candidate_text, [
    ...observations.flatMap((row) => row.flaggedExcerpts),
    ...highlightedExcerpts,
  ]);
  excerptMappings.forEach((mapping) => flaggedIndices.push(mapping.sentence_index));
  const targetParagraphIndices = [...new Set(paragraphs
    .filter((paragraph) => flaggedIndices.some((index) => index >= paragraph.firstSentence && index <= paragraph.lastSentence))
    .map((paragraph) => paragraph.blockIndex))];
  const flaggedExcerpts = [...new Set([...observations.flatMap((row) => row.flaggedExcerpts), ...highlightedExcerpts])].slice(0, 40);

  return {
    version: "candidate-linked-detector-feedback-v2",
    verified_candidate_link: true,
    candidate_id: candidateId,
    observation_count: observations.length,
    mean_ai_score: meanAiScore === null ? null : Number(meanAiScore.toFixed(1)),
    ai_or_paraphrase_votes: aiVotes,
    high_machine_pattern_signal: highSignal,
    global_candidate_failure: highSignal && targetParagraphIndices.length === 0,
    target_paragraph_indices: targetParagraphIndices,
    flagged_excerpts: flaggedExcerpts,
    highlighted_passage_count: observations.reduce((sum, row) => sum + (row.highlightedPassages?.length || 0), 0),
    mapped_highlight_count: excerptMappings.length,
    excerpt_mappings: excerptMappings,
    observations,
  };
}

export function detectorFeedbackPromptBlock(profile) {
  if (!profile?.verified_candidate_link) return "";
  const evidence = profile.observations.map((row) => {
    const score = Number.isFinite(row.aiScore) ? `, AI ${row.aiScore}%` : "";
    return `- ${row.detector}${row.version ? ` ${row.version}` : ""}: ${row.classification}${score}`;
  });
  return [
    "",
    "--- CANDIDATE-LINKED EXTERNAL TEST EVIDENCE ---",
    `The exact prior candidate (${profile.candidate_id}) received ${profile.observation_count} external observation(s). This evidence belongs to that candidate, not generically to the manuscript.`,
    ...evidence,
    profile.target_paragraph_indices.length ? `Prior-candidate paragraph targets: ${profile.target_paragraph_indices.join(", ")}.` : "The observation applies to the completed prior candidate rather than isolated sentences.",
    `Colour/passage mapping: ${profile.mapped_highlight_count || 0} passage target(s) mapped to the tested candidate${profile.highlighted_passage_count ? ` from ${profile.highlighted_passage_count} extracted coloured passage(s)` : ""}.`,
    ...(profile.flagged_excerpts.length ? ["Detector-highlight excerpts:", ...profile.flagged_excerpts.map((text) => `- ${text}`)] : []),
    "Treat this as failed-output evidence: do not return the same sentence alignment, paragraph openings, editorial pivots, evidence choreography or compressed synthesis with cosmetic synonym changes.",
    "OPENING CHECK: in Deep feedback-guided reconstruction, the first two substantive prose paragraphs must receive explicit scrutiny. If they remain near-verbatim or preserve the same opening-sentence sequence, rebuild their information packaging from the protected propositions. Do not alter formal headings, research questions or fixed institutional formulae merely to create distance.",
    "Use the internal diagnosis and intervention plan to reconstruct the affected reasoning architecture. Preserve every proposition, citation, number, qualification, scope condition and research-design fact. Do not insert errors, filler, invented claims or arbitrary quirks.",
    "The objective is a materially different, defensible scholarly rendering of the supplied reasoning. No external score is guaranteed, and the score is not a licence to weaken semantic fidelity.",
  ].join("\n");
}
