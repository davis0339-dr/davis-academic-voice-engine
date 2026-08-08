// Literature-grounded feature map for the Detector Research Lab.
//
// This registry does not claim that any one commercial detector uses every listed
// feature. It records feature families, contextual moderators and classifier
// architectures documented in the research literature so experiments can be
// designed around evidence rather than folklore or one vendor score.

export const DETECTOR_EVIDENCE_VERSION = "2026-08-08.v1";

export const DETECTOR_RESEARCH_SOURCES = Object.freeze([
  {
    key: "ma_2026_nature",
    citation: "Ma et al. (2026), Nature Communications 17:456",
    title: "Linguistic features of AI mis/disinformation and the detection limits of LLMs",
    doi: "10.1038/s41467-025-67145-1",
    contribution: [
      "psycholinguistic distribution differences",
      "syntactic dependency-distance distributions",
      "POS bigram patterns",
      "quality-dependent AI-versus-human regularity",
      "human post-editing and AI rewriting can reduce linguistic separation",
    ],
  },
  {
    key: "hadra_2026_ijei",
    citation: "Hadra et al. (2026), International Journal for Educational Integrity 22:4",
    title: "Evaluating the accuracy and reliability of AI content detectors in academic contexts",
    doi: "10.1007/s40979-026-00213-1",
    contribution: [
      "commercial detector reliability and false-positive risk",
      "genre, text-length and authorship-context sensitivity",
      "scientific lexical density, technical terminology and formulaic structure as potential confounds",
      "hybrid human-AI writing as a difficult classification condition",
      "longitudinal model/version drift as an evaluation requirement",
    ],
  },
  {
    key: "ibrahim_2026_lta",
    citation: "Ibrahim (2026), Language Testing in Asia 16:21",
    title: "Using AI to control AI-assisted plagiarism in L2 writing: a critical review of the literature",
    doi: "10.1186/s40468-026-00433-9",
    contribution: [
      "watermarking, training-based, statistical and retrieval-based classifier families",
      "feature-based and hybrid classification architectures",
      "domain, text-length and generator-model effects",
      "overfitting and generalizability limitations",
      "paraphrasing and humanization robustness limits",
      "need for transparent statistical evidence alongside classifier outputs",
    ],
  },
]);

export const DETECTOR_FEATURE_FAMILIES = Object.freeze([
  {
    id: "lexical_distribution",
    label: "Lexical distribution and predictability",
    evidence: ["hadra_2026_ijei", "ibrahim_2026_lta"],
    measures_now: ["lexical_type_token_ratio", "technical_token_density_per_100_words"],
    planned: ["reference-language-model token-rank histogram", "log-probability distribution", "n-gram continuation divergence"],
    caution: "Low or high lexical diversity is not an authorship verdict; domain and proficiency can create the same signal.",
  },
  {
    id: "sentence_rhythm",
    label: "Sentence-length and rhythmic distribution",
    evidence: ["hadra_2026_ijei", "ma_2026_nature"],
    measures_now: ["mean_sentence_words", "sentence_length_sd", "sentence_length_cv", "sentence_length_lag1_correlation", "short_sentence_share", "long_sentence_share"],
    planned: ["distributional distance against matched human corpus"],
    caution: "Text length and genre materially influence classification performance.",
  },
  {
    id: "syntactic_structure",
    label: "Syntactic structure and dependency locality",
    evidence: ["ma_2026_nature", "ibrahim_2026_lta"],
    measures_now: ["clause_marker_density_per_100_words", "repeated_sentence_opening_share", "passive_proxy_density_per_100_words"],
    planned: ["true dependency-distance distribution", "dependency-relation histogram", "POS unigram/bigram distribution"],
    caution: "Current JavaScript heuristics are proxies; dependency-distance and POS metrics require a real NLP parser and must not be fabricated from punctuation alone.",
  },
  {
    id: "discourse_cohesion",
    label: "Discourse organisation and cohesion",
    evidence: ["hadra_2026_ijei", "ibrahim_2026_lta"],
    measures_now: ["transition_density_per_100_words", "paragraph_length_cv", "repeated_sentence_opening_share"],
    planned: ["entity-grid coherence", "semantic transition distance", "paragraph-function sequence diversity"],
    caution: "Formulaic academic conventions can resemble model regularity even in fully human scientific writing.",
  },
  {
    id: "psycholinguistic",
    label: "Psycholinguistic and pragmatic distributions",
    evidence: ["ma_2026_nature"],
    measures_now: ["hedge_density_per_100_words", "first_person_density_per_100_words", "abstract_noun_density_per_100_words"],
    planned: ["LIWC-compatible category distributions", "affective-process distribution", "cognitive-process distribution", "personal-concern distribution"],
    caution: "The Nature study's LIWC analysis was language- and dataset-specific; categories should be recalibrated for English academic prose rather than copied mechanically.",
  },
  {
    id: "punctuation_segmentation",
    label: "Punctuation and segmentation behaviour",
    evidence: ["ma_2026_nature", "hadra_2026_ijei"],
    measures_now: ["punctuation"],
    planned: ["POS-punctuation bigram distribution", "sentence-boundary surprisal"],
    caution: "Punctuation is useful as one component of a multivariate profile, never as a one-token detector rule.",
  },
  {
    id: "position",
    label: "Document-position and opening-register effects",
    evidence: ["hadra_2026_ijei"],
    measures_now: ["opening_two_paragraphs", "first_quarter", "middle_half", "final_quarter", "sentence highlight density by opening versus remainder"],
    planned: ["cross-document positional mixed-effects analysis"],
    caution: "Opening-position weighting is a research hypothesis in this product, not a published universal detector mechanism.",
  },
  {
    id: "context_moderators",
    label: "Contextual moderators",
    evidence: ["hadra_2026_ijei", "ibrahim_2026_lta"],
    measures_now: ["detector version", "document length", "manual genre/section metadata", "cross-detector disagreement"],
    planned: ["generator-model label", "author language background where voluntarily supplied", "discipline-specific calibration", "detector-version longitudinal drift"],
    caution: "Detector performance should be stratified by genre, length, model/version and writing context before any generalization is made.",
  },
]);

export const DETECTOR_CLASSIFIER_FAMILIES = Object.freeze([
  {
    id: "watermarking",
    description: "Detects generation-time statistical signatures where the generating system deliberately embeds them.",
    evidence: ["ibrahim_2026_lta"],
  },
  {
    id: "training_based",
    description: "Classifiers trained or fine-tuned on labelled human and machine text; may learn linguistic/stylometric or latent representation differences.",
    evidence: ["ibrahim_2026_lta"],
  },
  {
    id: "statistical",
    description: "Uses token probability, likelihood, perturbation or continuation statistics such as GLTR-, DetectGPT- or DNA-GPT-like approaches.",
    evidence: ["ibrahim_2026_lta"],
  },
  {
    id: "retrieval_semantic",
    description: "Compares semantic representations with known or generated model outputs; can retain signal after some lexical/syntactic rewriting but has access and transferability limits.",
    evidence: ["ibrahim_2026_lta"],
  },
  {
    id: "hybrid_ensemble",
    description: "Combines complementary classifier families or feature layers instead of treating one binary classifier as sufficient evidence.",
    evidence: ["ibrahim_2026_lta", "hadra_2026_ijei"],
  },
]);

export function detectorEvidenceSummary() {
  return {
    version: DETECTOR_EVIDENCE_VERSION,
    sources: DETECTOR_RESEARCH_SOURCES,
    feature_families: DETECTOR_FEATURE_FAMILIES,
    classifier_families: DETECTOR_CLASSIFIER_FAMILIES,
  };
}
