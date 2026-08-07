const SECTION_PATTERNS = [
  ["statement_of_problem", /\b(statement\s+of\s+(?:the\s+)?problem|problem\s+statement)\b/i],
  ["background", /\b(background\s+to\s+(?:the\s+)?study|background\s+of\s+(?:the\s+)?study|study\s+background)\b/i],
  ["literature_review", /\b(literature\s+review|review\s+of\s+literature|empirical\s+review|conceptual\s+review)\b/i],
  ["theory", /\b(theoretical\s+review|theoretical\s+framework|theory|theories)\b/i],
  ["methodology", /\b(methodology|research\s+method|methods|research\s+design|methodological)\b/i],
  ["results", /\b(results?|findings?|data\s+analysis|analysis\s+of\s+data)\b/i],
  ["discussion", /\b(discussion|discussion\s+of\s+findings|interpretation\s+of\s+findings)\b/i],
  ["limitations", /\b(limitations?|study\s+limitations?|limitations?\s+of\s+(?:the\s+)?study)\b/i],
  ["conclusion", /\b(conclusion|conclusions|summary\s+and\s+conclusion|concluding)\b/i],
  ["abstract", /\babstract\b/i],
  ["introduction", /\bintroduction\b/i],
  ["preface_reflexive", /\b(preface|reflexive|reflection|researcher\s+position)\b/i],
];

const SECTION_GUIDES = Object.freeze({
  background: {
    purpose: "Establish the phenomenon and variables through a broad-to-narrow evidential progression, moving from wider context toward the study setting and conceptual focus.",
    preserve: ["historical/evolutionary sequence where it carries the argument", "statistics and contextual evidence", "variable definitions and broad-to-narrow logic"],
    avoid: ["turning every paragraph into the same global-regional-national template", "empty funnel transitions", "repeating the study objective before the background has established the problem context"],
  },
  statement_of_problem: {
    purpose: "Move from the evidenced performance/problem condition to its consequence, unresolved explanation, literature gap and the specific study response.",
    preserve: ["problem evidence and severity", "the distinction among conceptual, theoretical, methodological, empirical or contextual gaps when genuinely supported", "the final link to the study purpose"],
    avoid: ["merely restating the background", "generic gap labels without explaining what is missing", "presenting the independent variables as problems when they are proposed explanatory or intervention mechanisms"],
  },
  literature_review: {
    purpose: "Synthesize concepts and empirical evidence through comparison, qualification and relationships among studies rather than serial article summaries.",
    preserve: ["technical terminology", "citation-to-claim relationships", "agreement, disagreement and boundary conditions"],
    avoid: ["one-study-one-sentence catalogues", "mechanical citation stacking", "gratuitous synonym substitution of constructs"],
  },
  theory: {
    purpose: "Explain theoretical propositions, assumptions, mechanisms, criticisms and relevance to the study's relationships.",
    preserve: ["propositions and causal logic", "named constructs", "criticisms and boundary conditions"],
    avoid: ["definition-only theory summaries", "claiming the theory predicts relationships it does not actually explain"],
  },
  methodology: {
    purpose: "Describe and justify design decisions with procedural precision, making the link between research questions, data, measures and analysis explicit.",
    preserve: ["procedural sequence", "sample/data definitions", "measurement and model specifications"],
    avoid: ["ornamental sophistication", "inventing rationales or robustness checks not present in the source"],
  },
  results: {
    purpose: "Report empirical results accurately and distinguish observed values from interpretation.",
    preserve: ["all numerical values", "sign/direction and statistical meaning", "table/model references"],
    avoid: ["causal overstatement", "adding explanations not supported by the results", "changing technical interpretation for stylistic variety"],
  },
  discussion: {
    purpose: "Interpret findings against theory, prior evidence, context, hypotheses and plausible boundary conditions, allowing author reasoning between citations.",
    preserve: ["result-to-literature relationships", "specific contextual explanations", "legitimate researcher judgement"],
    avoid: ["restating results without interpretation", "generic hedging", "forcing every finding into agreement with prior literature"],
  },
  limitations: {
    purpose: "State concrete design, data, measurement or inference constraints and explain what each limits.",
    preserve: ["specific limitation source", "its consequence for interpretation or generalisation"],
    avoid: ["generic stock limitations", "inventing weaknesses merely to make the section sound academic"],
  },
  conclusion: {
    purpose: "Synthesize the study's contribution and implications without introducing new evidence or repeating the entire document.",
    preserve: ["main contribution", "scope of claims", "evidence-backed implications"],
    avoid: ["new facts or citations unless already present", "mechanical restatement of every prior paragraph"],
  },
  abstract: {
    purpose: "Compress purpose, method, principal findings and contribution while retaining factual precision.",
    preserve: ["sample/method essentials", "principal result directions", "study contribution"],
    avoid: ["background expansion", "new claims absent from the main study"],
  },
  introduction: {
    purpose: "Orient the reader to the phenomenon, significance, research focus and document trajectory without exhausting the later background or literature review.",
    preserve: ["problem significance", "study focus", "key contextual anchors"],
    avoid: ["overloading with every later detail", "formulaic roadmap language when unnecessary"],
  },
  preface_reflexive: {
    purpose: "Allow proportionate researcher presence and contextual reflection while preserving professional academic clarity.",
    preserve: ["authentic first-person ownership", "documented professional or research context"],
    avoid: ["normalising personal material into impersonal prose solely for formality"],
  },
});

export function inferSectionFromHeading(heading) {
  const text = String(heading || "").replace(/^\s*\d+(?:\.\d+)*\s*/, "").trim();
  if (!text) return null;
  for (const [section, pattern] of SECTION_PATTERNS) {
    if (pattern.test(text)) return section;
  }
  return null;
}

export function sectionLanguageGuide(section) {
  if (!section) return null;
  const guide = SECTION_GUIDES[section];
  if (!guide) return null;
  return {
    section,
    evidence_basis: "corpus-qualitative-v0.9",
    ...guide,
    instruction: "Use section purpose as a rhetorical constraint, not a paragraph template. Preserve the author's actual evidence and reasoning; do not manufacture section conventions that the source cannot support.",
  };
}
