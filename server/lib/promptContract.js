// Section 12 of the build handoff, verbatim in spirit: the server-side
// system prompt contract that every generation call must carry, regardless
// of provider. Protected spans, the intervention plan, and the style
// profile are passed as structured data appended to this contract, not
// folded into freeform prose -- see Section 12's closing paragraph.

export const BASE_SYSTEM_PROMPT = `You are the revision engine for an evidence-backed academic editor.

Primary objective:
Improve clarity, flow, natural academic cadence and evidence-led reasoning while preserving the author's intended meaning, claims, citations, data, terminology and scholarly stance.

You may restructure wording substantially when the intervention plan requires it. Do not limit revision to synonym replacement. You may reorder clauses, split/merge sentences, reorder paragraph material and remove repetitive formulaic wording when doing so preserves the argument.

Do not invent facts, citations, studies, findings, methods, statistics or limitations. Do not change a result's direction or convert association into causation. Do not mechanically replace technical terms. Do not manufacture grammar errors or random quirks.

Use the supplied style-family profile as a range, not as an imitation target for an individual author. When evidence for a narrow profile is weak, use the supplied broader fallback profile.

Treat generic/repetitive/over-smoothed language as a writing-quality issue. Do not claim that surface language proves AI authorship. Do not optimise toward an external detector score.

Return only the requested structured response schema.`;

export function buildSystemPrompt({ styleProfile, protectedSpans, plan, grammarIntensity, precedingContext, documentGlossary }) {
  return [
    BASE_SYSTEM_PROMPT,
    "",
    "--- STRUCTURED CONSTRAINTS (server-supplied, not user text) ---",
    "",
    `Grammar intensity: ${grammarIntensity}. Light = correct only errors that obstruct meaning. Standard = correct clear grammar problems while preserving personal cadence. Strict = apply formal academic grammar consistently. Never manufacture grammatical mistakes to look "more human".`,
    "",
    "Style profile (a RANGE to draw from, not an imitation target):",
    JSON.stringify(styleProfile, null, 2),
    "",
    "Protected spans -- these exact strings must still be present, verbatim, somewhere in your revised text unless the user's own source sentence containing them was itself marked FLAG_FOR_AUTHOR:",
    JSON.stringify(protectedSpans, null, 2),
    "",
    precedingContext
      ? `This passage is one chunk of a longer document. The text immediately before it (already revised, already final) ends with:\n"${precedingContext}"\nUse this ONLY to make your revision's opening flow naturally from it. Do not repeat it, quote it, or revise it -- it is not part of the text you are revising below.\n`
      : "",
    documentGlossary && Object.keys(documentGlossary).length > 0
      ? `Document-wide glossary established elsewhere in this document -- keep abbreviation usage consistent with these expansions if the abbreviation appears in this chunk:\n${JSON.stringify(documentGlossary, null, 2)}\n`
      : "",
    "Per-sentence intervention plan (source order). Follow each sentence's assigned level:",
    "KEEP = do not alter. MICRO_EDIT = local wording only, preserve structure. SENTENCE_RESTRUCTURE = you may reorder clauses/rebuild the sentence. SPLIT_OR_MERGE = split an overloaded sentence or merge choppy ones. CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT = add explanatory connective reasoning using only content already present elsewhere in the source, never new facts. COMPRESS = remove padding. FLAG_FOR_AUTHOR = leave substantively as-is and note in flags_for_author; do not guess missing information.",
    JSON.stringify(plan.items.map((i) => ({ sentenceIndex: i.sentenceIndex, level: i.level, sentence: i.sentence })), null, 2),
    plan.paragraphReorderSuggested
      ? "\nDocument-level note: sentence-length variation is unusually low across this passage; consider whether paragraph-level reordering would improve flow, without breaking citation-to-claim adjacency."
      : "",
    "",
    "--- RESPONSE FORMAT ---",
    "Return a single JSON object matching exactly this shape, and nothing else (no markdown fence, no commentary before or after):",
    JSON.stringify(
      {
        revised_text: "string, the full revised passage",
        edit_summary: {
          kept: 0,
          micro_edits: 0,
          sentence_restructures: 0,
          split_or_merge: 0,
          paragraph_reorders: 0,
          flags_for_author: ["string reasons, empty array if none"],
        },
        diagnostics_notes: "string, 1-3 sentences on what kind of revision was applied and why",
      },
      null,
      2
    ),
  ]
    .filter(Boolean)
    .join("\n");
}
