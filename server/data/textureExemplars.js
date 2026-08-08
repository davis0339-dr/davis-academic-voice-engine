// Legacy texture-exemplar hook.
//
// Early builds used one owner-supplied paragraph that an external detector had
// rated as human. That remains intentionally excluded from production. A single
// detector-selected passage is not a defensible model of human academic writing
// and would encourage overfitting to one classifier or one writer's rhythm.
//
// Aggressive generation now uses this hook for GENERAL authorial-reconstruction
// guidance only. The guidance is based on academic discourse quality and
// preservation principles; it does not contain detector thresholds, proprietary
// classifier assumptions, or a target detector score.

export const TEXTURE_EXEMPLARS = [];

export function texturePromptBlock() {
  return [
    "AUTHORIAL RECONSTRUCTION GUIDANCE:",
    "- Give special scrutiny to the first two prose paragraphs of the supplied section. They establish the reader's first sense of register, reasoning and authorial control. Do not alter headings merely for variation, but do not leave the opening as a sequence of uniformly polished abstract-style declarations if the paragraph plan authorises reconstruction.",
    "- In those opening paragraphs, vary information packaging through reasoning rather than gimmicks: some sentences may establish the issue, some may carry evidence, some may qualify a claim, and some may depend naturally on the sentence before them. Avoid making every sentence a complete mini-summary.",
    "- Prefer ordinary, precise academic diction where it is sufficient. Do not inflate vocabulary merely to sound scholarly, and do not deliberately simplify into awkward or ungrammatical prose.",
    "- Preserve useful repetition of core technical terms. Human academic prose often repeats the construct under discussion rather than replacing it with a parade of approximate synonyms.",
    "- Preserve asymmetry. If one part of the argument genuinely needs more explanation than another, allow it more space. Do not force every paragraph into the same topic-sentence, evidence, qualification, polished-closure shape.",
    "- Use author-led evidence naturally where appropriate (for example, Author (year) found/reported/linked...) instead of converting every citation into an impersonal omniscient synthesis. Do not fabricate reporting verbs or change the study finding.",
    "- When splitting or redistributing a sentence that contains a citation, preserve CITATION SCOPE, not merely citation presence. Every factual proposition that depended on that citation in the source must remain unmistakably anchored after the split. Repeat or reposition the citation when necessary rather than leaving one of the resulting claims apparently unsupported.",
    "- Treat methodological labels and relationship conditions as semantic locks. Do not replace one research design with another, change explanatory to descriptive, change a conditional subgroup (for example, absence of CEO duality) into a different executive-role condition, reverse a shareholder/creditor trade-off, or turn an association into an effect.",
    "- Treat index composition, sample-frame descriptions, institutional definitions, percentages and weighting statements as factual locks. Never infer or invent an index weighting scheme, population property or sampling fact merely because it sounds plausible.",
    "- Structural freshness must come from clause order, grammatical subject, evidence placement, paragraph development, sentence dependency and selective split/merge decisions. It must NOT come from factual drift, grammatical damage, random errors, filler, fake roughness or detector-specific tricks.",
    "- Do not optimise for any third-party authorship classifier. A candidate that changes detector output by corrupting the research design, evidence, citation meaning or scholarly readability is a failed candidate.",
  ].join("\n");
}
