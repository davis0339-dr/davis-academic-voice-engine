// Pass C (intervention planner): assigns one label per sentence from the
// fixed vocabulary in Section 11 of the build handoff. This is the piece
// that actually implements "Auto/Smart" (Section 3.1) -- it is what stops
// the pipeline from being "one prompt, uniformly rewrite everything."
//
// The plan is deterministic and rule-based so it is inspectable and unit
// testable; Pass D (the LLM call) receives it as structured instruction
// rather than being asked to infer intervention level itself.

const PLACEHOLDER_MARKERS = /\[(citation needed|TBD|TODO|XXX)\]/i;

const LEVELS = Object.freeze({
  KEEP: "KEEP",
  MICRO_EDIT: "MICRO_EDIT",
  SENTENCE_RESTRUCTURE: "SENTENCE_RESTRUCTURE",
  SPLIT_OR_MERGE: "SPLIT_OR_MERGE",
  PARAGRAPH_REORDER: "PARAGRAPH_REORDER",
  CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT: "CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT",
  COMPRESS: "COMPRESS",
  FLAG_FOR_AUTHOR: "FLAG_FOR_AUTHOR",
});

function sentenceSignals(sentence, index, diagnostics) {
  const hasGenericPhrase = diagnostics.generic_phrasing.some((h) => h.sentenceIndex === index);
  const isOverloaded = diagnostics.monotony.overloaded.some((o) => o.sentenceIndex === index);
  const isChoppy = diagnostics.monotony.choppy.some((c) => c.sentenceIndex === index);
  const hasRepeatedOpening = diagnostics.structural_monotony.some(
    (m) => m.sentenceIndex === index && m.issue === "repeated_opening"
  );
  const isPlaceholder = PLACEHOLDER_MARKERS.test(sentence);
  return { hasGenericPhrase, isOverloaded, isChoppy, hasRepeatedOpening, isPlaceholder };
}

function planSentence(sentence, index, diagnostics, intensity, lengthPreference) {
  const s = sentenceSignals(sentence, index, diagnostics);
  const reasons = [];

  if (s.isPlaceholder) {
    reasons.push("Sentence contains an unresolved placeholder marker.");
    return { level: LEVELS.FLAG_FOR_AUTHOR, reasons };
  }

  if (s.isOverloaded) {
    reasons.push("Sentence exceeds 40 words -- candidate for split.");
    return { level: LEVELS.SPLIT_OR_MERGE, reasons };
  }

  if (lengthPreference === "concise" && s.hasGenericPhrase) {
    reasons.push("Contains formulaic filler and length preference is Concise.");
    return { level: LEVELS.COMPRESS, reasons };
  }

  const flagged = s.hasGenericPhrase || s.hasRepeatedOpening || s.isChoppy;

  switch (intensity) {
    case "minor":
      if (flagged) {
        reasons.push("Flagged wording, Minor intensity permits local repair only.");
        return { level: LEVELS.MICRO_EDIT, reasons };
      }
      return { level: LEVELS.KEEP, reasons: ["No flagged issues."] };

    case "moderate":
      if (flagged) {
        reasons.push("Flagged wording/structure under Moderate intensity.");
        return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons };
      }
      return { level: LEVELS.MICRO_EDIT, reasons: ["Unflagged; light pass only."] };

    case "deep":
      if (flagged) {
        reasons.push("Flagged wording/structure under Deep intensity.");
        return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons };
      }
      if (lengthPreference === "expand") {
        reasons.push("Deep intensity + Expand preference on an otherwise clean sentence.");
        return { level: LEVELS.CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT, reasons };
      }
      return { level: LEVELS.MICRO_EDIT, reasons: ["Unflagged; still eligible for cadence variation."] };

    case "auto":
    default:
      if (flagged) {
        reasons.push("Flagged wording/structure; Auto mode escalates only where diagnostics found an issue.");
        return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons };
      }
      return { level: LEVELS.KEEP, reasons: ["No flagged issues; Auto mode leaves it stable."] };
  }
}

export function buildInterventionPlan(diagnostics, { rewriteIntensity, lengthPreference }) {
  const intensity = (rewriteIntensity || "auto").toLowerCase();
  const length = (lengthPreference || "auto").toLowerCase();

  const items = diagnostics.sentences.map((sentence, index) => {
    const { level, reasons } = planSentence(sentence, index, diagnostics, intensity, length);
    return { sentenceIndex: index, sentence, level, reasons };
  });

  const paragraphReorderSuggested = diagnostics.structural_monotony.some(
    (m) => m.issue === "low_sentence_length_variation"
  );

  const summary = items.reduce((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, {});

  return {
    intensity,
    lengthPreference: length,
    items,
    paragraphReorderSuggested,
    summary,
  };
}

export { LEVELS };
