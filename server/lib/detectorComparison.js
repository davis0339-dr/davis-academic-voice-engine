import { linguisticProfile } from "./detectorResearch.js";
import { parseTextStructure } from "./textStructure.js";

const METRICS = Object.freeze([
  ["mean_sentence_words", "Mean sentence words", "number"],
  ["sentence_length_sd", "Sentence-length SD", "number"],
  ["sentence_length_cv", "Sentence-length CV", "number"],
  ["sentence_length_lag1_correlation", "Lag-1 sentence-length correlation", "number"],
  ["short_sentence_share", "Short-sentence share", "ratio"],
  ["long_sentence_share", "Long-sentence share", "ratio"],
  ["repeated_sentence_opening_share", "Repeated sentence-opening share", "ratio"],
  ["transition_density_per_100_words", "Transition density /100 words", "number"],
  ["abstract_noun_density_per_100_words", "Abstract-noun density /100 words", "number"],
  ["clause_marker_density_per_100_words", "Clause-marker density /100 words", "number"],
  ["citation_density_per_100_words", "Citation density /100 words", "number"],
  ["lexical_type_token_ratio", "Lexical type-token ratio", "number"],
]);

function round(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function proseParagraphs(text) {
  const structure = parseTextStructure(String(text || ""));
  return (structure.blocks || [])
    .filter((block) => block.type === "paragraph")
    .map((block) => String(block.text || "").trim())
    .filter(Boolean);
}

function openingTwoParagraphs(text) {
  return proseParagraphs(text).slice(0, 2).join("\n\n");
}

function metricRows(source, revised) {
  return METRICS.map(([key, label, kind]) => {
    const before = Number(source?.[key]);
    const after = Number(revised?.[key]);
    return {
      key,
      label,
      kind,
      source: Number.isFinite(before) ? before : null,
      revised: Number.isFinite(after) ? after : null,
      delta: Number.isFinite(before) && Number.isFinite(after) ? round(after - before, 4) : null,
      direction: Number.isFinite(before) && Number.isFinite(after)
        ? (after > before ? "up" : after < before ? "down" : "same")
        : "unknown",
    };
  });
}

function interpret(rows) {
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  const notes = [];
  const cv = byKey.sentence_length_cv;
  if (cv?.direction === "up") notes.push("Sentence-length dispersion increased in the revision; this indicates more variation in sentence length, not proof of authorship.");
  if (cv?.direction === "down") notes.push("Sentence-length dispersion narrowed in the revision; inspect whether the rewrite became rhythmically more uniform.");
  const repeated = byKey.repeated_sentence_opening_share;
  if (repeated?.direction === "down") notes.push("Repeated sentence openings decreased after revision.");
  if (repeated?.direction === "up") notes.push("Repeated sentence openings increased after revision and may warrant local inspection.");
  const abstract = byKey.abstract_noun_density_per_100_words;
  if (abstract?.delta !== null && abstract.delta > 0.5) notes.push("Abstract-noun density rose materially; check whether the revision became more nominalised or conceptually compressed than the source.");
  const transitions = byKey.transition_density_per_100_words;
  if (transitions?.delta !== null && transitions.delta > 0.35) notes.push("Explicit transition density increased; review whether cohesion is being carried too visibly by discourse markers.");
  const longShare = byKey.long_sentence_share;
  if (longShare?.direction === "down" && byKey.short_sentence_share?.direction === "up") notes.push("The revision shifted some load from long sentences toward shorter units.");
  return notes;
}

export function buildSourceRevisionComparison(sourceText, candidateText) {
  const source = linguisticProfile(sourceText || "");
  const revised = linguisticProfile(candidateText || "");
  const openingText = openingTwoParagraphs(candidateText || "");
  const revisedOpening = linguisticProfile(openingText);
  const rows = metricRows(source, revised);
  return {
    version: "source-revision-comparison-v1",
    labels: {
      source: "Original source (before)",
      revised: "Revised candidate (after)",
      opening: "Revised opening two prose paragraphs",
    },
    source,
    revised,
    revised_opening_two_paragraphs: revisedOpening,
    revised_opening_text_available: Boolean(openingText),
    metrics: rows,
    interpretations: interpret(rows),
    note: "This is a before/after writing-pattern comparison. It is not an AI-authorship score and it does not claim that any single metric is human or machine-specific.",
  };
}
