// Recurrent machine-associated academic-writing tendencies observed during
// product benchmarking and revision work. These are NOT authorship markers.
// A human writer can use any of these constructions, and a generated passage
// can avoid them. The catalog exists only to help the editor diagnose repeated
// rhetorical habits and compare them with measured human academic-language
// families.

export const AI_TREND_CATALOG_VERSION = "ai-trend-catalog-v1";

export const AI_TREND_CATALOG = Object.freeze([
  {
    id: "over_signposted_progression",
    label: "Over-signposted progression",
    description: "A high share of sentence relationships is announced by explicit transitions or demonstrative bridge subjects rather than carried by the developing argument.",
    repair: "Retain necessary logical links, but allow technical-term continuity, evidence sequence, clause structure and reference to carry some of the progression.",
  },
  {
    id: "mechanically_even_cadence",
    label: "Mechanically even cadence",
    description: "Sentence lengths and structures vary much less than in the measured human academic family.",
    repair: "Let sentence length follow analytical function rather than a visible rhythm pattern; keep concise propositions concise and retain longer qualified reasoning where it belongs together.",
  },
  {
    id: "repeated_clause_architecture",
    label: "Repeated clause architecture",
    description: "Multiword content frames or sentence openings recur with unusually little structural change.",
    repair: "Repackage the proposition by changing grammatical focus, clause order or sentence boundaries without changing the claim, evidence or technical terminology.",
  },
  {
    id: "generic_evidence_bridge",
    label: "Generic evidence-to-interpretation bridge",
    description: "Evidence is repeatedly followed by stock moves such as 'These findings suggest...' regardless of the actual relation between evidence and argument.",
    repair: "Express the real relation: comparison, qualification, mechanism, implication, contradiction, contextual narrowing or synthesis, but only where the source supports it.",
  },
  {
    id: "serial_evidence_catalogue",
    label: "Serial evidence catalogue",
    description: "Several evidence/citation sentences are stacked without interpretive or comparative development.",
    repair: "Where warranted by the source, synthesise studies around the proposition they jointly support or distinguish them according to meaningful disagreement or context.",
  },
  {
    id: "repeated_paragraph_recipe",
    label: "Repeated paragraph recipe",
    description: "Multiple paragraphs reproduce the same rhetorical move sequence even when their substantive functions differ.",
    repair: "Preserve each paragraph's purpose and let its development follow that purpose rather than a single reusable template.",
  },
  {
    id: "formulaic_metadiscourse",
    label: "Formulaic metadiscourse",
    description: "Throat-clearing phrases announce importance or interpretation without adding analytical substance.",
    repair: "Remove the announcement and state the substantive claim directly unless the metadiscourse genuinely contributes meaning.",
  },
  {
    id: "participial_tail_repetition",
    label: "Repeated participial tail",
    description: "Complete clauses are repeatedly followed by '-ing' interpretive tails such as 'underscoring', 'highlighting' or 'reflecting'.",
    repair: "Keep the relation when it is meaningful, but vary its grammatical realization or integrate it into the main clause rather than repeating one tail construction.",
  },
  {
    id: "over_concentrated_transition_vocabulary",
    label: "Over-concentrated transition vocabulary",
    description: "A small set of explicit transition words carries a disproportionate share of cohesion.",
    repair: "Reduce repeated connective-led openings and allow paragraph logic and lexical continuity to do more of the work.",
  },
]);

export function trendById(id) {
  return AI_TREND_CATALOG.find((trend) => trend.id === id) || null;
}
