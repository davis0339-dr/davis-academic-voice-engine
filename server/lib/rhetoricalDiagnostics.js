import { wordCount } from "./sentences.js";

const GAP_LABEL_RE = /^(conceptually|theoretically|methodologically|empirically|contextually)\b/i;
const PERFORMANCE_PROXY_RE = /^(?:in\s+)?(revenue\s+growth|market[-\s]share|audit\s+quality|operational\s+efficiency)\b/i;
const DEMONSTRATIVE_SUBJECT_RE = /^(this|these|that|those)\s+[a-z][a-z'’-]*/i;

function rollingClusters(rows, windowSize, minimum) {
  if (rows.length < minimum) return [];
  const clusters = [];
  for (let i = 0; i < rows.length; i++) {
    const start = rows[i].sentenceIndex;
    const cluster = rows.filter((row) => row.sentenceIndex >= start && row.sentenceIndex < start + windowSize);
    if (cluster.length >= minimum) clusters.push(cluster);
  }
  return clusters;
}

export function findRhetoricalScaffolding(sentences) {
  const issues = [];

  const gapLabelled = sentences
    .map((sentence, sentenceIndex) => ({ sentence, sentenceIndex, match: sentence.trim().match(GAP_LABEL_RE) }))
    .filter((row) => row.match);

  if (gapLabelled.length >= 3) {
    issues.push({
      sentenceIndex: gapLabelled[0].sentenceIndex,
      sentenceIndices: gapLabelled.map((row) => row.sentenceIndex),
      issue: "gap_label_scaffolding",
      detail: `${gapLabelled.length} sentences are organised through explicit Conceptually/Theoretically/Methodologically/Empirically/Contextually labels. Preserve the distinct gaps, but reconstruct them as a connected argument rather than a labelled checklist.`,
      labels: gapLabelled.map((row) => row.match[1].toLowerCase()),
    });
  }

  const proxyLabelled = sentences
    .map((sentence, sentenceIndex) => ({ sentence, sentenceIndex, match: sentence.trim().match(PERFORMANCE_PROXY_RE) }))
    .filter((row) => row.match);
  const proxyClusters = rollingClusters(proxyLabelled, 6, 3);
  if (proxyClusters.length) {
    const cluster = proxyClusters[0];
    const distinct = [...new Set(cluster.map((row) => row.match[1].toLowerCase().replace(/-/g, " ")))];
    if (distinct.length >= 3) {
      issues.push({
        sentenceIndex: cluster[0].sentenceIndex,
        sentenceIndices: cluster.map((row) => row.sentenceIndex),
        issue: "proxy_label_scaffolding",
        detail: `${distinct.length} performance dimensions are introduced through consecutive category-led sentence openings (${distinct.join(", ")}). Preserve the four performance problems, but let evidence and consequence connect them rather than presenting the paragraph as a disguised checklist.`,
        labels: distinct,
      });
    }
  }

  const demonstrativeRows = sentences
    .map((sentence, sentenceIndex) => ({ sentence, sentenceIndex, match: sentence.trim().match(DEMONSTRATIVE_SUBJECT_RE) }))
    .filter((row) => row.match);
  const demonstrativeClusters = rollingClusters(demonstrativeRows, 12, 3);
  if (demonstrativeClusters.length) {
    const cluster = demonstrativeClusters[0];
    issues.push({
      sentenceIndex: cluster[0].sentenceIndex,
      sentenceIndices: cluster.map((row) => row.sentenceIndex),
      issue: "demonstrative_bridge_overuse",
      detail: `${cluster.length} sentences within a short span begin with demonstrative bridge subjects such as “This …” or “These …”. These links are individually legitimate, but repeated use can make cohesion feel mechanically signposted. Retain genuine referential links while varying how evidence, interpretation and consequence are connected.`,
    });
  }

  let runStart = null;
  let run = [];
  const flushRun = () => {
    if (run.length >= 2) {
      issues.push({
        sentenceIndex: runStart,
        sentenceIndices: run.map((row) => row.sentenceIndex),
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
