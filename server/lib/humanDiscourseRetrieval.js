import {
  HUMAN_DISCOURSE_GLOBAL_RULES,
  HUMAN_DISCOURSE_MOVES,
  HUMAN_DISCOURSE_PROFILES,
  HUMAN_DISCOURSE_PROFILES_VERSION,
} from "../data/humanDiscourseProfiles.js";

const HEADING_JOBS = [
  [/\b(?:introduction)\b/i, "introduction"],
  [/\b(?:background)\b/i, "background"],
  [/\b(?:problem statement|statement of the problem)\b/i, "problem"],
  [/\b(?:research gap|gap in the literature)\b/i, "gap"],
  [/\b(?:literature|empirical review)\b/i, "literature"],
  [/\b(?:theoretical|conceptual framework|theory)\b/i, "theory"],
  [/\b(?:methodology|methods?|research design)\b/i, "methodology"],
  [/\b(?:results?|findings?)\b/i, "results"],
  [/\b(?:discussion)\b/i, "discussion"],
  [/\b(?:limitations?)\b/i, "limitations"],
  [/\b(?:conclusion|recommendations?|implications?)\b/i, "conclusion"],
];

const TEXT_JOBS = [
  [/\b(?:is defined as|refers to|means that|definition of|concept of)\b/i, "definition"],
  [/\b(?:research gap|few studies|limited evidence|remains unclear|has not been examined|lack of evidence)\b/i, "gap"],
  [/\b(?:sample|data source|instrument|questionnaire|estimator|model specification|measured using|method(?:ology)?)\b/i, "methodology"],
  [/\b(?:coefficient|statistically significant|result(?:s)? (?:show|indicate|suggest)|finding(?:s)?|hypoth(?:esis|eses))\b/i, "results"],
  [/\b(?:one possible explanation|may be due|could reflect|consistent with|inconsistent with|contrary to|interpretation)\b/i, "discussion"],
  [/\b(?:limitation|future research|further studies)\b/i, "limitations"],
  [/\b(?:recommend|implication|in conclusion|the study concludes)\b/i, "conclusion"],
  [/\b(?:previous studies|prior research|literature|\bet al\.)\b/i, "literature"],
  [/\b(?:purpose of this study|this study examines|research question)\b/i, "introduction"],
];

const ACTION_HINTS = {
  BUILD_GAP: ["gap", "literature", "problem"],
  CONTEXTUALISE_SETTING: ["introduction", "background", "problem"],
  TEMPORALISE_EVIDENCE: ["background", "discussion", "results"],
  DISTINGUISH_MEASURES: ["definition", "theory", "methodology", "results"],
  QUALIFY_EVIDENCE: ["results", "discussion", "limitations", "conclusion"],
  EXPLAIN_MECHANISM: ["definition", "theory", "methodology", "discussion", "results"],
  DEVELOP_EVIDENCE: ["literature", "gap", "results", "discussion", "conclusion"],
};

function headingJob(text) {
  for (const [pattern, job] of HEADING_JOBS) if (pattern.test(String(text || ""))) return job;
  return null;
}

export function inferRhetoricalJob(text, sectionJob = null) {
  for (const [pattern, job] of TEXT_JOBS) if (pattern.test(String(text || ""))) return job;
  return sectionJob || "exposition";
}

function scoreMove(move, job, actions) {
  let score = move.jobs.includes(job) ? 8 : move.jobs.includes("exposition") ? 1 : 0;
  for (const action of actions || []) {
    if (move.actions.includes(action)) score += 3;
    if ((ACTION_HINTS[action] || []).includes(job)) score += 1;
  }
  return score;
}

function compactMove(move) {
  return {
    id: move.id,
    profileId: move.profileId,
    evidencePages: move.evidencePages,
    instruction: move.instruction,
    caution: move.caution,
  };
}

export function selectHumanDiscourseGuidance(diagnostics, paragraphPlan, { maxMovesPerParagraph = 1 } = {}) {
  const blocks = diagnostics?.text_structure?.blocks || [];
  const planByBlock = new Map((paragraphPlan || []).map((row) => [row.blockIndex, row]));
  let sectionJob = null;
  const assignments = [];
  const selectedIds = new Set();
  const profileUsage = new Map(HUMAN_DISCOURSE_PROFILES.map((profile) => [profile.id, 0]));

  for (const block of blocks) {
    if (block.type === "heading") {
      sectionJob = headingJob(block.text) || sectionJob;
      continue;
    }
    if (!["paragraph", "list_item"].includes(block.type)) continue;
    const plan = planByBlock.get(block.blockIndex);
    const job = inferRhetoricalJob(block.text, sectionJob);
    const actions = plan?.actions || [];
    const ranked = HUMAN_DISCOURSE_MOVES
      .map((move) => ({ move, score: scoreMove(move, job, actions) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || (profileUsage.get(a.move.profileId) || 0) - (profileUsage.get(b.move.profileId) || 0) || a.move.id.localeCompare(b.move.id));

    const chosen = [];
    const usedProfiles = new Set();
    for (const row of ranked) {
      if (chosen.length >= maxMovesPerParagraph) break;
      if (usedProfiles.has(row.move.profileId) && ranked.some((candidate) =>
        candidate.score > 0 && !usedProfiles.has(candidate.move.profileId) && !chosen.includes(candidate.move)
      )) continue;
      chosen.push(row.move);
      usedProfiles.add(row.move.profileId);
      profileUsage.set(row.move.profileId, (profileUsage.get(row.move.profileId) || 0) + 1);
      selectedIds.add(row.move.id);
    }

    assignments.push({
      blockIndex: block.blockIndex,
      paragraphOrdinal: block.paragraphOrdinal,
      rhetoricalJob: job,
      moveIds: chosen.map((move) => move.id),
    });
  }

  return {
    version: HUMAN_DISCOURSE_PROFILES_VERSION,
    profileIds: HUMAN_DISCOURSE_PROFILES.map((profile) => profile.id),
    profiles: HUMAN_DISCOURSE_PROFILES.map(({ id, author, sourceFile, strongestContribution, longitudinalArchitecture, preserve, adapt, avoid, caveat }) => ({
      id,
      author,
      sourceFile,
      strongestContribution,
      longitudinalArchitecture,
      preserve: [...(preserve || [])],
      adapt: [...(adapt || [])],
      avoid: [...(avoid || [])],
      caveat: caveat || null,
    })),
    globalRules: [...HUMAN_DISCOURSE_GLOBAL_RULES],
    selectedMoves: HUMAN_DISCOURSE_MOVES.filter((move) => selectedIds.has(move.id)).map(compactMove),
    paragraphAssignments: assignments,
    note: "The engine retrieves thesis-derived reasoning operations by rhetorical job and carries each thesis's longitudinal argument architecture and Preserve/Adapt/Avoid boundaries. It must not imitate author-specific wording, errors or surface habits.",
  };
}
