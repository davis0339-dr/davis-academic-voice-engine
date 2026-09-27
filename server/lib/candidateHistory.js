import { createHash } from "node:crypto";

const histories = new Map();
const MAX_KEYS = 50;
const MAX_CANDIDATES_PER_KEY = 3;

function normalise(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hash(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function paragraphOpenings(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => normalise(paragraph).split(/\s+/).slice(0, 10).join(" "))
    .filter(Boolean)
    .slice(0, 14);
}

function keyFor({ sourceText, rewriteIntensity, naturalisation, lengthPreference }) {
  return hash(JSON.stringify({
    source: normalise(sourceText),
    intensity: String(rewriteIntensity || "auto"),
    naturalisation: String(naturalisation || "faithful"),
    length: String(lengthPreference || "auto"),
  }));
}

export function candidateHistoryFor(options = {}) {
  const key = keyFor(options);
  return {
    key,
    source_hash: hash(normalise(options.sourceText)),
    candidates: (histories.get(key) || []).map((candidate) => ({ ...candidate })),
  };
}

export function isHistoricalDuplicate(candidateText, history = {}) {
  const candidateHash = hash(normalise(candidateText));
  return (history.candidates || []).some((candidate) => candidate.normalised_hash === candidateHash);
}

export function rememberCandidate(candidateText, history = {}) {
  const text = String(candidateText || "").trim();
  if (!text || !history.key) return null;
  const record = {
    candidate_id: candidateIdentityFor(text, history),
    normalised_hash: hash(normalise(text)),
    paragraph_openings: paragraphOpenings(text),
    candidate_text: text,
    source_hash: history.source_hash || null,
  };
  const previous = histories.get(history.key) || [];
  const next = [record, ...previous.filter((candidate) => candidate.normalised_hash !== record.normalised_hash)]
    .slice(0, MAX_CANDIDATES_PER_KEY);
  histories.set(history.key, next);
  while (histories.size > MAX_KEYS) histories.delete(histories.keys().next().value);
  return record;
}

export function candidateIdentityFor(candidateText, history = {}) {
  const text = String(candidateText || "").trim();
  if (!text || !history.key) return null;
  return hash(`${history.key}:${hash(normalise(text))}`).slice(0, 24);
}

export function candidateById(history = {}, candidateId = "") {
  if (!candidateId) return null;
  const candidate = (history.candidates || []).find((row) => row.candidate_id === candidateId)
    || [...histories.values()].flat().find((row) => row.candidate_id === candidateId && row.source_hash === history.source_hash);
  return candidate ? { ...candidate } : null;
}

export function candidateHistoryPromptBlock(history = {}) {
  const candidates = history.candidates || [];
  if (!candidates.length) return "";
  const openings = [...new Set(candidates.flatMap((candidate) => candidate.paragraph_openings || []))].slice(0, 24);
  return [
    "",
    "--- PRIOR CANDIDATE NON-REPETITION EVIDENCE ---",
    "Earlier candidates for this exact source and mode were not cleared. Do not reproduce their paragraph-opening sequence or return the same polished local optimum with minor synonym changes.",
    "Reconstruct diagnosed units from propositions, relationships and evidence. A different wording of the same paragraph choreography is still repetition.",
    "Previously observed paragraph openings (diagnostic evidence only):",
    ...openings.map((opening) => `- ${opening}`),
  ].join("\n");
}

export function clearCandidateHistoryForTests() {
  histories.clear();
}
