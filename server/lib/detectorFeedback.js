import { candidateById, candidateIdentityFor } from "./candidateHistory.js";

const AI_LABELS = new Set(["ai", "ai_generated", "ai_paraphrased", "likely_ai"]);

function boundedScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function splitSentences(text) {
  return String(text || "").match(/[^.!?]+(?:[.!?]+|$)/g)?.map((row) => row.trim()).filter(Boolean) || [];
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
    notes: row.notes ? String(row.notes).slice(0, 1000) : null,
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
  const targetParagraphIndices = [...new Set(paragraphs
    .filter((paragraph) => flaggedIndices.some((index) => index >= paragraph.firstSentence && index <= paragraph.lastSentence))
    .map((paragraph) => paragraph.blockIndex))];
  const flaggedExcerpts = [...new Set(observations.flatMap((row) => row.flaggedExcerpts))].slice(0, 20);

  return {
    version: "candidate-linked-detector-feedback-v1",
    verified_candidate_link: true,
    candidate_id: candidateId,
    observation_count: observations.length,
    mean_ai_score: meanAiScore === null ? null : Number(meanAiScore.toFixed(1)),
    ai_or_paraphrase_votes: aiVotes,
    high_machine_pattern_signal: highSignal,
    global_candidate_failure: highSignal && targetParagraphIndices.length === 0 && flaggedExcerpts.length === 0,
    target_paragraph_indices: targetParagraphIndices,
    flagged_excerpts: flaggedExcerpts,
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
    ...(profile.flagged_excerpts.length ? ["Detector-highlight excerpts:", ...profile.flagged_excerpts.map((text) => `- ${text}`)] : []),
    "Treat this as failed-output evidence: do not return the same sentence alignment, paragraph openings, editorial pivots, evidence choreography or compressed synthesis with cosmetic synonym changes.",
    "Use the internal diagnosis and intervention plan to reconstruct the affected reasoning architecture. Preserve every proposition, citation, number, qualification, scope condition and research-design fact. Do not insert errors, filler, invented claims or arbitrary quirks.",
    "The objective is a materially different, defensible scholarly rendering of the supplied reasoning. No external score is guaranteed, and the score is not a licence to weaken semantic fidelity.",
  ].join("\n");
}
