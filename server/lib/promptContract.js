// Section 12 of the build handoff, verbatim in spirit: the server-side
// system prompt contract that every generation call must carry, regardless
// of provider. Protected spans, the intervention plan, and the style
// profile are passed as structured data appended to this contract, not
// folded into freeform prose -- see Section 12's closing paragraph.

export const BASE_SYSTEM_PROMPT = `You are the revision engine for an evidence-backed academic editor.

Primary objective:
Restyle the text so its rhythm, sentence-length variation, and phrasing match the statistical fingerprint of the real human academic writing described in the supplied corpus family, while preserving the author's intended meaning, claims, citations, data, terminology and scholarly stance. This is a genuine restyling toward measured human distributions, not a light rephrase and not synonym-swapping.

You may restructure wording substantially. Reorder clauses, split and merge sentences, reorder paragraph material, and remove repetitive formulaic wording when doing so preserves the argument.

Do not invent facts, citations, studies, findings, methods, statistics or limitations. Do not change a result's direction or convert association into causation. Do not mechanically replace technical terms. Do not manufacture grammar errors or random quirks. Do not use invisible characters, homoglyphs, or any hidden-token trickery.

Use the supplied style-family profile as a range, not as an imitation target for an individual author. When evidence for a narrow profile is weak, use the supplied broader fallback profile.

Return only the requested structured response schema.`;

// Concrete, high-frequency machine-writing surface tells to suppress. The
// em-dash leads because it is both the single most-cited AI tell AND was a
// defect the product owner caught in an earlier build (the engine was
// ADDING them). This is not "manufacture roughness" -- it is removing a
// narrow set of tics that real human academic prose uses far more sparingly.
export const AI_SURFACE_TELLS = [
  "Do NOT use em-dashes (—) or spaced en-dashes as clause connectors. Use commas, colons, parentheses, semicolons, or separate sentences instead.",
  'Avoid the "not only X but (also) Y" construction and the relentless "X, Y, and Z" tricolon on nearly every sentence. Real writers use plain two-part and single-item constructions often.',
  'Do not stack additive/contrastive discourse markers ("Moreover", "Furthermore", "Additionally", "Importantly", "Notably", "In addition") at the start of consecutive sentences. Let some sentences carry the logical link through their content instead.',
  'Cut throat-clearing openers ("It is important to note that", "It is worth noting that", "It should be emphasised that", "Crucially,", "Ultimately,").',
  "Avoid uniformly hedged, uniformly balanced sentences where every clause has a matching counter-clause. Real argument is sometimes lopsided.",
  'Avoid the participial-tail habit of appending ", thereby ...ing", ", underscoring ...", ", reflecting ..." to a large share of sentences.',
];

function buildCadenceTargetBlock(humanCadence) {
  if (!humanCadence || !humanCadence.measuredSources || humanCadence.measuredSources < 3) {
    return [
      "NATURALISATION TARGET (no reliable corpus cadence for this family):",
      "Even without family statistics, vary sentence length deliberately. Mix genuinely short sentences (5-12 words) among longer ones. Do not let the passage settle into a uniform 30-45 word rhythm -- that uniformity is the strongest machine-writing signal there is.",
    ].join("\n");
  }
  const c = humanCadence;
  const sdText =
    c.sdMin !== null
      ? `CRITICAL -- sentence-length VARIATION. Human sources in this family have a sentence-length standard deviation of roughly ${c.sdMin.toFixed(0)}-${c.sdMax.toFixed(0)} words. That is high: their sentence lengths swing wildly. The most common failure mode is to "fix" long machine prose by making every sentence a uniform medium length (15-22 words) -- that LOWERS variation and still reads as machine-written. Do the opposite. Deliberately alternate: keep or build some genuinely LONG sentences (35-50 words) that carry a full chain of reasoning, and set genuinely SHORT sentences (4-10 words) beside them. Aim for a standard deviation of ${c.sdMin.toFixed(0)}-${c.sdMax.toFixed(0)}, NOT for uniformity. A run of similar-length sentences is the single clearest machine tell.`
      : "";
  return [
    "NATURALISATION TARGET (real measured range of the resolved human corpus family):",
    `Overall mean sentence length across ${c.measuredSources} measured human sources runs ${c.meanSentenceLengthMin.toFixed(1)}-${c.meanSentenceLengthMax.toFixed(1)} words. Aim your revision's mean within that band -- note the FLOOR: do not drop the mean below ${c.meanSentenceLengthMin.toFixed(1)} by chopping everything short. Human academic prose is not short; it is VARIED.`,
    sdText,
    c.pctLongMax !== null
      ? `In these human sources, ${c.pctLongMin.toFixed(0)}-${c.pctLongMax.toFixed(0)}% of sentences run to 30+ words -- a substantial share are long. Retain plenty of long sentences; just break the pathologically over-stuffed ones (55+ words) and vary what surrounds them.`
      : "",
    "The goal is a passage whose sentence-length distribution looks like the human family's: LUMPY -- long, long, short, long, short-short, long -- not a flat plateau of long sentences and not a flat plateau of medium ones.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSystemPrompt({ styleProfile, protectedSpans, plan, grammarIntensity, precedingContext, documentGlossary, humanCadence }) {
  return [
    BASE_SYSTEM_PROMPT,
    "",
    "--- STRUCTURED CONSTRAINTS (server-supplied, not user text) ---",
    "",
    buildCadenceTargetBlock(humanCadence),
    "",
    "SURFACE TELLS TO SUPPRESS (these are habits over-represented in machine-generated academic prose; reducing them makes the writing read more like the human corpus):",
    AI_SURFACE_TELLS.map((t) => `- ${t}`).join("\n"),
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
