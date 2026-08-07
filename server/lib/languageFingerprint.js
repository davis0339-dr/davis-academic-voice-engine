import { splitSentences, wordCount } from "./sentences.js";

const TRANSITIONS = [
  "however", "therefore", "thus", "furthermore", "moreover", "additionally", "in addition",
  "consequently", "nevertheless", "nonetheless", "accordingly", "hence", "similarly", "conversely",
  "meanwhile", "instead", "indeed", "notably", "importantly", "specifically", "overall", "finally",
  "firstly", "secondly", "thirdly", "on the other hand", "in contrast", "by contrast", "as a result",
  "for example", "for instance", "in particular", "at the same time", "in this regard", "in turn",
];

const HEDGES = [
  "may", "might", "could", "would", "perhaps", "possibly", "potentially", "likely", "unlikely",
  "appears", "appear", "suggests", "suggest", "indicates", "indicate", "seems", "seem", "tends", "tend",
  "arguably", "generally", "approximately", "roughly", "relatively", "possible", "probable",
];

const ASSERTIVES = [
  "shows", "show", "demonstrates", "demonstrate", "confirms", "confirm", "establishes", "establish",
  "reveals", "reveal", "proves", "prove", "clearly", "evidently",
];

const SUBORDINATORS = [
  "because", "although", "though", "while", "whereas", "since", "if", "unless", "when", "whenever",
  "where", "which", "who", "whose", "that", "despite", "even though", "provided that", "given that",
  "as long as",
];

const FIRST_PERSON = ["i", "we", "my", "our", "me", "us", "mine", "ours"];
const STUDY_CENTERED = [
  "this study", "the present study", "the current study", "this research", "the research", "the study", "the analysis",
];

const PASSIVE_RE = /\b(?:is|are|was|were|be|been|being|has been|have been|had been)\s+(?:[a-z]+ed|known|shown|found|given|seen|made|used|based|conducted|reported|examined|measured|estimated|identified|determined|observed|considered|included|excluded)\b/gi;
const NARRATIVE_CITATION_RE = /\b[A-Z][A-Za-z'’-]+(?:\s+(?:&|and)\s+[A-Z][A-Za-z'’-]+|\s+et al\.)?\s*\((?:19|20)\d{2}[a-z]?\)/g;
const PARENTHETICAL_CITATION_RE = /\((?:[^()]{0,140}?(?:19|20)\d{2}[a-z]?[^()]*)\)/g;

const STOPWORDS = new Set(
  "the a an and or but if while of to in on for from with by as at is are was were be been being this that these those it its they their them he she his her we our i my you your not no do does did have has had which who whom whose where when how what why than then also such into over under between among through during can could may might would should will shall must".split(/\s+/)
);

function tokens(text) {
  return String(text || "").toLowerCase().match(/[a-z][a-z'’-]*|\d+(?:\.\d+)?/g) || [];
}

function alphaTokens(text) {
  return String(text || "").toLowerCase().match(/[a-z][a-z'’-]*/g) || [];
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function stddev(nums) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((sum, n) => sum + (n - m) ** 2, 0) / nums.length);
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function phraseCount(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (String(text || "").toLowerCase().match(new RegExp(`\\b${escaped}\\b`, "g")) || []).length;
}

function movingAverageTypeTokenRatio(wordTokens, window = 50) {
  if (!wordTokens.length) return 0;
  if (wordTokens.length < window) return new Set(wordTokens).size / wordTokens.length;
  const step = Math.max(1, Math.floor(window / 5));
  const values = [];
  for (let i = 0; i <= wordTokens.length - window; i += step) {
    const slice = wordTokens.slice(i, i + window);
    values.push(new Set(slice).size / window);
  }
  return mean(values);
}

function sentenceInitialKey(sentence) {
  const content = alphaTokens(sentence).filter((t) => !STOPWORDS.has(t));
  return content.slice(0, 2).join(" ");
}

function repeatedContentFourgrams(wordTokens) {
  const content = wordTokens.filter((t) => /^[a-z]/.test(t) && !STOPWORDS.has(t) && t.length > 2);
  const counts = new Map();
  for (let i = 0; i <= content.length - 4; i++) {
    const gram = content.slice(i, i + 4).join(" ");
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  let repeats = 0;
  for (const count of counts.values()) if (count > 1) repeats += count - 1;
  return { repeats, content };
}

function paragraphStats(text) {
  const paragraphs = String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => wordCount(p) >= 20);
  const lengths = paragraphs.map(wordCount);
  return { paragraphs, lengths };
}

function transitionStats(lowerText) {
  const counts = Object.fromEntries(TRANSITIONS.map((t) => [t, phraseCount(lowerText, t)]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const used = Object.values(counts).filter((v) => v > 0).length;
  const top = total ? Math.max(...Object.values(counts)) : 0;
  return {
    total,
    diversity: total ? used / total : 0,
    topShare: total ? top / total : 0,
  };
}

function regexCount(text, regex) {
  const re = new RegExp(regex.source, regex.flags);
  return (String(text || "").match(re) || []).length;
}

function regexHas(text, regex) {
  // Never reuse a stateful global RegExp with .test() across sentences.
  // A cloned regex guarantees lastIndex cannot leak from one sentence into
  // the next and silently undercount citation-bearing sentences.
  const flags = regex.flags.replace("g", "");
  return new RegExp(regex.source, flags).test(String(text || ""));
}

export function measureLanguageFingerprint(text) {
  const source = String(text || "");
  const lower = source.toLowerCase();
  const allTokens = tokens(source);
  const wordsOnly = alphaTokens(source);
  const sentences = splitSentences(source).filter((s) => wordCount(s) >= 4);
  const sentenceLengths = sentences.map(wordCount);
  const { paragraphs, lengths: paragraphLengths } = paragraphStats(source);
  const nWords = Math.max(1, allTokens.length);
  const nSentences = Math.max(1, sentences.length);

  const transition = transitionStats(lower);
  const hedgeTotal = HEDGES.reduce((sum, p) => sum + phraseCount(lower, p), 0);
  const assertiveTotal = ASSERTIVES.reduce((sum, p) => sum + phraseCount(lower, p), 0);
  const subordinatorTotal = SUBORDINATORS.reduce((sum, p) => sum + phraseCount(lower, p), 0);
  const firstPersonTotal = FIRST_PERSON.reduce((sum, p) => sum + phraseCount(lower, p), 0);
  const studyCenteredTotal = STUDY_CENTERED.reduce((sum, p) => sum + phraseCount(lower, p), 0);
  const passiveTotal = regexCount(source, PASSIVE_RE);
  const parentheticalCitations = regexCount(source, PARENTHETICAL_CITATION_RE);
  const narrativeCitations = regexCount(source, NARRATIVE_CITATION_RE);
  const citationSentences = sentences.filter((s) => regexHas(s, PARENTHETICAL_CITATION_RE) || regexHas(s, NARRATIVE_CITATION_RE)).length;

  const initialKeys = sentences.map(sentenceInitialKey).filter(Boolean);
  const initialDiversity = initialKeys.length ? new Set(initialKeys).size / initialKeys.length : 0;

  const { repeats: repeatedFourgrams, content } = repeatedContentFourgrams(allTokens);
  const contentCounts = new Map();
  for (const token of content) contentCounts.set(token, (contentCounts.get(token) || 0) + 1);
  const top10Content = [...contentCounts.values()].sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0);

  const nominalisations = wordsOnly.filter((t) => /(tion|sion|ment|ity|ness|ance|ence|ship|ism)$/.test(t)).length;
  const longWords = wordsOnly.filter((t) => t.length >= 9).length;

  return {
    measurement_version: "language-fingerprint-v1",
    word_count: allTokens.length,
    sentence_count: sentences.length,
    paragraph_count: paragraphs.length,
    sentence_mean: Number(mean(sentenceLengths).toFixed(2)),
    sentence_median: Number(median(sentenceLengths).toFixed(2)),
    sentence_sd: Number(stddev(sentenceLengths).toFixed(2)),
    pct_short_le12: Number(((sentenceLengths.filter((n) => n <= 12).length / nSentences) * 100).toFixed(2)),
    pct_long_ge30: Number(((sentenceLengths.filter((n) => n >= 30).length / nSentences) * 100).toFixed(2)),
    paragraph_mean_words: Number(mean(paragraphLengths).toFixed(2)),
    paragraph_sd_words: Number(stddev(paragraphLengths).toFixed(2)),
    mattr50: Number(movingAverageTypeTokenRatio(wordsOnly, 50).toFixed(4)),
    avg_word_length: Number((wordsOnly.reduce((sum, t) => sum + t.length, 0) / Math.max(1, wordsOnly.length)).toFixed(3)),
    long_word_ratio: Number((longWords / nWords).toFixed(4)),
    nominalisation_per_1k: Number(((nominalisations / nWords) * 1000).toFixed(2)),
    subordinator_per_100_sent: Number(((subordinatorTotal / nSentences) * 100).toFixed(2)),
    transition_per_100_sent: Number(((transition.total / nSentences) * 100).toFixed(2)),
    transition_diversity: Number(transition.diversity.toFixed(4)),
    top_transition_share: Number(transition.topShare.toFixed(4)),
    hedge_per_1k: Number(((hedgeTotal / nWords) * 1000).toFixed(2)),
    assertive_per_1k: Number(((assertiveTotal / nWords) * 1000).toFixed(2)),
    first_person_per_1k: Number(((firstPersonTotal / nWords) * 1000).toFixed(2)),
    study_centered_per_1k: Number(((studyCenteredTotal / nWords) * 1000).toFixed(2)),
    passive_proxy_per_100_sent: Number(((passiveTotal / nSentences) * 100).toFixed(2)),
    parenthetical_citations_per_1k: Number(((parentheticalCitations / nWords) * 1000).toFixed(2)),
    narrative_citations_per_1k: Number(((narrativeCitations / nWords) * 1000).toFixed(2)),
    citation_sentence_ratio: Number((citationSentences / nSentences).toFixed(4)),
    sentence_initial_diversity: Number(initialDiversity.toFixed(4)),
    repeated_content_4gram_per_1k: Number(((repeatedFourgrams / Math.max(1, content.length)) * 1000).toFixed(2)),
    top10_content_word_share: Number((top10Content / Math.max(1, content.length)).toFixed(4)),
    semicolon_per_1k: Number((((source.split(";").length - 1) / nWords) * 1000).toFixed(2)),
    colon_per_1k: Number((((source.split(":").length - 1) / nWords) * 1000).toFixed(2)),
    parenthesis_per_1k: Number(((((source.split("(").length - 1 + source.split(")").length - 1) / 2) / nWords) * 1000).toFixed(2)),
  };
}

export const LANGUAGE_FINGERPRINT_METRICS = Object.freeze([
  "sentence_mean", "sentence_median", "sentence_sd", "pct_short_le12", "pct_long_ge30",
  "paragraph_mean_words", "paragraph_sd_words", "mattr50", "avg_word_length", "long_word_ratio",
  "nominalisation_per_1k", "subordinator_per_100_sent", "transition_per_100_sent", "transition_diversity",
  "top_transition_share", "hedge_per_1k", "assertive_per_1k", "first_person_per_1k",
  "study_centered_per_1k", "passive_proxy_per_100_sent", "parenthetical_citations_per_1k",
  "narrative_citations_per_1k", "citation_sentence_ratio", "sentence_initial_diversity",
  "repeated_content_4gram_per_1k", "top10_content_word_share", "semicolon_per_1k", "colon_per_1k",
  "parenthesis_per_1k",
]);
