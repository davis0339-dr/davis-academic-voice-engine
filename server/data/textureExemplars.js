// Few-shot texture exemplars for the naturalisation pass.
//
// Origin: paragraphs excerpted from the product owner's own supplied
// human-written sample (tests/fixtures/detector-benchmark/human-sample-01-
// corporate-governance.txt), which an external detector (GPTZero) rated
// 100% human with high confidence on 2026-08-07. They are included here to
// show the model the TEXTURE of real human academic prose -- its plainer
// vocabulary, uneven information density, natural redundancy, and slightly
// looser rhythm -- because instructing the model to "write plainer" in the
// abstract proved weak, while showing an example is far stronger.
//
// These are the owner's own material, used as a style reference, not
// redistributed content. The prompt that consumes them (promptContract.js)
// forbids the model from borrowing their WORDS, TOPIC, CLAIMS, or CITATIONS
// -- only the texture is to be matched. The pipeline additionally guards
// against content bleed by running the preservation audit, which flags any
// citation appearing in the output that was not in the user's own source.
//
// To swap in a different exemplar set (e.g. the user's own past writing),
// replace the strings below. Keep them short (2-3 paragraphs); more is not
// better and raises the risk of content bleed.

export const TEXTURE_EXEMPLARS = [
  "The emerging markets, in general, and the transitional emerging markets, in particular, are to examine the most convenient and adaptable path of development. The conventional modes of corporate governance structures and mechanisms, as merely mechanisms of corporate finance, may not be viable to emerging markets as long as their institutional infrastructure is not well adaptable to accept this mode of governance. This necessitates extending the scope of the current practices of corporate governance to explore additional viable alternatives that can be adaptable to the unique institutional infrastructure of the emerging and the transitional markets. These alternatives are to be examined in the developed countries first before recommending any of them as a viable one to the case of emerging markets.",
];

export function texturePromptBlock() {
  if (!TEXTURE_EXEMPLARS.length) return "";
  return [
    "TEXTURE EXEMPLAR (real human academic writing -- MATCH ITS TEXTURE, NOT ITS CONTENT):",
    "The passage below was written by a human academic and reads as unmistakably human. Study HOW it is written, not what it says. Notice: plain everyday vocabulary sitting beside the technical terms; some sentences that simply restate or circle back rather than adding new content; uneven information density (not every sentence is packed); a slightly loose, unhurried rhythm; no ornate connectives, no perfectly balanced tricolons, no em-dashes.",
    "Reproduce THAT texture in your revision of the user's text. Do NOT borrow this exemplar's words, topic, claims, or citations -- it is about corporate governance in emerging markets and your task text may be about something entirely different. Copying any of its content is a failure. Match only the plainness, the density, and the rhythm.",
    "--- exemplar begins ---",
    ...TEXTURE_EXEMPLARS,
    "--- exemplar ends ---",
  ].join("\n");
}
