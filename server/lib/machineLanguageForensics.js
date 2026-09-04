// Modern academic machine-language forensics.
//
// This module does NOT infer authorship. It measures observable lexical-rhetorical
// tendencies that became common in polished LLM academic prose and are often missed
// by older generic-phrase blacklists: repeated editorial pivots, abstract noun-led
// signposting, binary qualification frames, compressed synthesis sentences and
// over-managed paragraph entry/closure language.
//
// No single phrase is treated as a defect. Risk is density- and recurrence-based.

import { splitSentences, wordCount } from "./sentences.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function ratio(count, total) {
  return total ? count / total : 0;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

const EDITORIAL_PIVOT_RE = /\b(?:does not|do not|did not|cannot|should not|need not|is not|are not)\b[^.!?]{0,150}\b(?:but|however|rather|instead|yet|nor)\b/i;
const BINARY_FRAME_RE = /\b(?:not simply|not merely|not necessarily|not only|more than|rather than|less about|more about|does not imply|does not establish|should not be (?:read|interpreted|treated)|cannot be (?:read|interpreted|treated|separated)|no fixed meaning)\b/i;
const SYNTHESIS_FRAME_RE = /^(?:taken together|overall|these (?:findings|results|studies|patterns)|this (?:evidence|pattern|finding|result|distinction|qualification)|the (?:evidence|findings|difficulty|issue|problem|question|implication|unresolved issue|remaining empirical question|more instructive result|practical question)|what remains|from (?:a|the) [^,]{1,45} standpoint)\b/i;
const ABSTRACT_EDITORIAL_OPEN_RE = /^(?:conditionality|complexity|variation|assessment|informational asymmetry|evidence|concerns?|difficulty|issue|relationship|pattern|context|setting|period|combination|distinction|implications?|qualification|leadership structure|board composition|temporal variation|creditor assessment|manufacturing)\b[^.!?]{0,95}\b(?:adds?|becomes?|complicates?|offers?|provides?|warrants?|remains?|carries?|matters?|requires?|presents?|makes?|enters?|extends?)\b/i;
const DISCOURSE_MANAGEMENT_RE = /\b(?:the (?:issue|difficulty|problem|question) is not|the (?:issue|difficulty|problem|question) becomes|the more instructive|the unresolved issue|the remaining empirical question|becomes more evident|adds further complexity|complicates the (?:decision|picture|analysis)|offers a useful setting|provides an appropriate frame|points? to (?:two|three|several)|a similar caution is required|even so|in other words)\b/i;
const ELEGANT_QUALIFIER_RE = /\b(?:even so|nevertheless|nonetheless|however|yet|although|while|whereas|despite|conditionality|contingent|depends? partly on|depends? on whether)\b/i;
const ABSTRACT_SUFFIX_RE = /(?:tion|sion|ity|ment|ance|ence|ship|ness|ism|isation|ization)s?$/i;

function words(text) {
  return String(text || "").toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) || [];
}

function abstractNounDensity(sentence) {
  const tokens = words(sentence).filter((token) => token.length >= 6);
  if (!tokens.length) return 0;
  return tokens.filter((token) => ABSTRACT_SUFFIX_RE.test(token)).length / tokens.length;
}

function sentenceSignals(sentence) {
  const text = String(sentence || "").trim();
  const wc = wordCount(text);
  const abstractDensity = abstractNounDensity(text);
  const categories = [];
  if (EDITORIAL_PIVOT_RE.test(text)) categories.push("editorial_pivot");
  if (BINARY_FRAME_RE.test(text)) categories.push("binary_qualification_frame");
  if (SYNTHESIS_FRAME_RE.test(text)) categories.push("synthesis_frame");
  if (ABSTRACT_EDITORIAL_OPEN_RE.test(text)) categories.push("abstract_editorial_opening");
  if (DISCOURSE_MANAGEMENT_RE.test(text)) categories.push("discourse_management");
  if (wc >= 14 && abstractDensity >= 0.28) categories.push("nominalisation_pressure");
  if (wc >= 12 && ELEGANT_QUALIFIER_RE.test(text) && categories.length) categories.push("polished_qualification_density");
  return {
    categories: unique(categories),
    abstractDensity,
  };
}

function paragraphRows(text) {
  const paragraphs = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((value) => value.trim())
    .filter((value) => wordCount(value) >= 18);

  const allSentences = splitSentences(text);
  let cursor = 0;
  return paragraphs.map((paragraph, paragraphIndex) => {
    const localSentences = splitSentences(paragraph);
    const sentenceIndices = [];
    for (const local of localSentences) {
      let found = allSentences.indexOf(local, cursor);
      if (found < 0) found = allSentences.indexOf(local);
      if (found >= 0) {
        sentenceIndices.push(found);
        cursor = Math.max(cursor, found + 1);
      }
    }
    const sentenceRows = sentenceIndices.map((sentenceIndex) => {
      const sentence = allSentences[sentenceIndex];
      return { sentenceIndex, sentence, ...sentenceSignals(sentence) };
    });
    const hitRows = sentenceRows.filter((row) => row.categories.length);
    const weightedHits = hitRows.reduce((sum, row) => sum + Math.min(2.2, 0.75 + row.categories.length * 0.35), 0);
    const localRisk = clamp01(weightedHits / Math.max(2.4, sentenceRows.length * 1.55));
    return {
      paragraphIndex,
      sentenceIndices,
      sentenceRows,
      hitSentenceIndices: hitRows.map((row) => row.sentenceIndex),
      hitRatio: Number(ratio(hitRows.length, sentenceRows.length).toFixed(3)),
      localRisk: Number(localRisk.toFixed(3)),
    };
  });
}

export function analyseMachineLanguageForensics(text) {
  const source = String(text || "");
  const sentences = splitSentences(source).filter((sentence) => wordCount(sentence) >= 4);
  if (sentences.length < 6) {
    return {
      version: "machine-language-forensics-v1",
      available: false,
      score: 0,
      label: "insufficient_text",
      metrics: {},
      signals: [],
      target_sentence_indices: [],
      target_paragraph_indices: [],
      note: "Too few sentences for density-based machine-language assessment.",
    };
  }

  const rows = sentences.map((sentence, sentenceIndex) => ({ sentenceIndex, sentence, ...sentenceSignals(sentence) }));
  const hitRows = rows.filter((row) => row.categories.length);
  const categoryCount = (name) => rows.filter((row) => row.categories.includes(name)).length;
  const hitRatio = ratio(hitRows.length, rows.length);
  const pivotRatio = ratio(categoryCount("editorial_pivot"), rows.length);
  const binaryRatio = ratio(categoryCount("binary_qualification_frame"), rows.length);
  const synthesisRatio = ratio(categoryCount("synthesis_frame"), rows.length);
  const abstractOpeningRatio = ratio(categoryCount("abstract_editorial_opening"), rows.length);
  const managementRatio = ratio(categoryCount("discourse_management"), rows.length);
  const nominalisationRatio = ratio(categoryCount("nominalisation_pressure"), rows.length);
  const multiSignalRatio = ratio(rows.filter((row) => row.categories.length >= 2).length, rows.length);

  const components = {
    hit_density: clamp01((hitRatio - 0.08) / 0.40),
    editorial_pivots: clamp01((pivotRatio - 0.03) / 0.22),
    binary_qualification: clamp01((binaryRatio - 0.04) / 0.24),
    synthesis_frames: clamp01((synthesisRatio - 0.04) / 0.22),
    abstract_editorial_openings: clamp01((abstractOpeningRatio - 0.03) / 0.20),
    discourse_management: clamp01((managementRatio - 0.03) / 0.20),
    nominalisation_pressure: clamp01((nominalisationRatio - 0.10) / 0.35),
    multi_signal_sentences: clamp01((multiSignalRatio - 0.03) / 0.18),
  };

  const score = clamp01(
    components.hit_density * 0.24 +
    components.editorial_pivots * 0.14 +
    components.binary_qualification * 0.13 +
    components.synthesis_frames * 0.13 +
    components.abstract_editorial_openings * 0.12 +
    components.discourse_management * 0.12 +
    components.nominalisation_pressure * 0.06 +
    components.multi_signal_sentences * 0.06
  );

  const signals = [];
  if (hitRatio >= 0.22) {
    signals.push({
      issue: "machine_language_density",
      severity: hitRatio >= 0.38 ? "high" : "medium",
      interpretation: `${Math.round(hitRatio * 100)}% of substantive sentences contain one or more polished machine-favoured academic framing patterns. The concern is recurrence across the passage, not any individual phrase.`,
      action: "Rebuild selected sentences around the substantive proposition. Replace repetitive discourse-management wording, abstract signposting and polished binary pivots with developed explanation, qualification or transition where those functions matter. Delete only a proposition-and-function duplicate; directness must not become compression.",
    });
  }
  if (pivotRatio + binaryRatio >= 0.18) {
    signals.push({
      issue: "editorial_pivot_saturation",
      severity: pivotRatio + binaryRatio >= 0.30 ? "high" : "medium",
      interpretation: "Negative-to-positive pivots and binary qualification frames recur too frequently, giving the argument a highly curated 'not X, but Y' rhythm.",
      action: "Keep genuine qualifications, but express some distinctions directly through evidence, conditions or causal explanation instead of repeatedly staging them as polished rhetorical reversals.",
    });
  }
  if (synthesisRatio + managementRatio + abstractOpeningRatio >= 0.20) {
    signals.push({
      issue: "editorial_discourse_management_density",
      severity: synthesisRatio + managementRatio + abstractOpeningRatio >= 0.34 ? "high" : "medium",
      interpretation: "A large share of sentences manage the reader's interpretation through abstract synthesis, issue-framing or paragraph-announcement language rather than advancing the substantive proposition directly.",
      action: "Reconstruct repeated discourse-management wording without deleting its intellectual job. Preserve or redevelop framing, conditionality, significance, interpretation and transitions where they organise the argument; absorb a sentence only when both its proposition and rhetorical function are genuinely duplicated.",
    });
  }
  if (nominalisationRatio >= 0.28) {
    signals.push({
      issue: "nominalisation_pressure",
      severity: nominalisationRatio >= 0.42 ? "high" : "medium",
      interpretation: "Abstract noun density is elevated across many sentences. Academic terminology is legitimate, but repeated noun-heavy packaging can make prose unnecessarily compressed and impersonal.",
      action: "Where meaning permits, restore direct actors and verbs. Do not simplify technical terms or alter construct names merely to reduce noun density.",
    });
  }

  const paragraphs = paragraphRows(source);
  const targetParagraphIndices = paragraphs
    .filter((row) => row.localRisk >= 0.34 || row.hitRatio >= 0.40)
    .sort((a, b) => b.localRisk - a.localRisk)
    .slice(0, 8)
    .map((row) => row.paragraphIndex);
  const targetSentenceIndices = hitRows
    .sort((a, b) => b.categories.length - a.categories.length || b.abstractDensity - a.abstractDensity)
    .slice(0, 18)
    .map((row) => row.sentenceIndex);

  return {
    version: "machine-language-forensics-v1",
    available: true,
    score: Number(score.toFixed(3)),
    label: score >= 0.62 ? "high" : score >= 0.38 ? "moderate" : "low",
    metrics: {
      sentence_count: rows.length,
      hit_sentence_count: hitRows.length,
      hit_sentence_ratio: Number(hitRatio.toFixed(3)),
      editorial_pivot_ratio: Number(pivotRatio.toFixed(3)),
      binary_qualification_ratio: Number(binaryRatio.toFixed(3)),
      synthesis_frame_ratio: Number(synthesisRatio.toFixed(3)),
      abstract_editorial_opening_ratio: Number(abstractOpeningRatio.toFixed(3)),
      discourse_management_ratio: Number(managementRatio.toFixed(3)),
      nominalisation_pressure_ratio: Number(nominalisationRatio.toFixed(3)),
      multi_signal_sentence_ratio: Number(multiSignalRatio.toFixed(3)),
    },
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Number(value.toFixed(3))])),
    signals,
    target_sentence_indices: unique(targetSentenceIndices),
    target_paragraph_indices: unique(targetParagraphIndices),
    rows: rows.map((row) => ({
      sentence_index: row.sentenceIndex,
      categories: row.categories,
      abstract_noun_density: Number(row.abstractDensity.toFixed(3)),
    })),
    paragraph_rows: paragraphs.map((row) => ({
      paragraph_index: row.paragraphIndex,
      hit_ratio: row.hitRatio,
      local_risk: row.localRisk,
      hit_sentence_indices: row.hitSentenceIndices,
    })),
    note: "This is a lexical-rhetorical style diagnostic, not an AI-authorship classifier. Single constructions are not penalised; recurrence and density drive the score.",
  };
}
