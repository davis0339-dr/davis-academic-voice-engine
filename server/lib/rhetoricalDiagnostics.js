import { wordCount } from "./sentences.js";

const GAP_LABEL_RE = /^(conceptually|theoretically|methodologically|empirically|contextually)\b/i;

export function findRhetoricalScaffolding(sentences) {
  const issues = [];

  const gapLabelled = sentences
    .map((sentence, sentenceIndex) => ({ sentence, sentenceIndex, match: sentence.trim().match(GAP_LABEL_RE) }))
    .filter((row) => row.match);

  if (gapLabelled.length >= 3) {
    issues.push({
      sentenceIndex: gapLabelled[0].sentenceIndex,
      issue: "gap_label_scaffolding",
      detail: `${gapLabelled.length} sentences are organised through explicit Conceptually/Theoretically/Methodologically/Empirically/Contextually labels. Preserve the distinct gaps, but reconstruct them as a connected argument rather than a labelled checklist.`,
      labels: gapLabelled.map((row) => row.match[1].toLowerCase()),
    });
  }

  let runStart = null;
  let run = [];
  const flushRun = () => {
    if (run.length >= 2) {
      issues.push({
        sentenceIndex: runStart,
        issue: "choppy_sentence_run",
        detail: `${run.length} consecutive sentences contain six words or fewer. Short sentences are not inherently problematic, but consecutive micro-sentences inside sustained academic exposition can create artificial rhythm rather than argument-led variation.`,
        wordCounts: run.map((row) => row.wordCount),
      });
    }
    runStart = null;
    run = [];
  };

  sentences.forEach((sentence, sentenceIndex) => {
    const wc = wordCount(sentence);
    if (wc > 0 && wc <= 6) {
      if (runStart === null) runStart = sentenceIndex;
      run.push({ sentenceIndex, wordCount: wc });
    } else {
      flushRun();
    }
  });
  flushRun();

  return issues;
}
