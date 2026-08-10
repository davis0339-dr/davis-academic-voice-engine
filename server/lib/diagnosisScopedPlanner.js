// Diagnosis-aware wrapper around intent-discourse-v4.
// Diagnosis chooses WHAT kind of intervention a passage needs. The researcher-selected
// intensity determines HOW DEEP the engine may go. Naturalisation changes HOW an
// authorised intervention is expressed; it must not manufacture structural need.

import { buildInterventionPlan as buildV4Plan } from "./planner.js";

const FORMAL_KEEP_CODES = new Set(["KEEP_QUOTE", "KEEP_TECHNICAL"]);
const MODERATE_FORENSIC_LEVELS = new Set(["KEEP", "MICRO_EDIT"]);
const DEEP_FORENSIC_LEVELS = new Set(["KEEP", "MICRO_EDIT", "SENTENCE_RESTRUCTURE"]);

function summarise(items = []) {
  return items.reduce((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, {});
}

function forensicExecutionScope(plan, diagnostics, { requestedIntensity, requestedNaturalisation }) {
  const forensic = diagnostics?.discourse_regularity_forensics;
  const aggressiveExpression = ["aggressive", "authorial"].includes(requestedNaturalisation);
  const available = Boolean(forensic?.available && Array.isArray(forensic?.priority_sentence_indices));

  if (!aggressiveExpression || !available || requestedIntensity === "minor" || requestedIntensity === "auto") {
    return plan;
  }

  const sourceIndices = forensic.priority_sentence_indices.filter((index) => Number.isInteger(index));
  if (!sourceIndices.length) {
    plan.forensicExecution = {
      available: true,
      regularity_score: forensic.score,
      regularity_label: forensic.label,
      targeted_sentence_count: 0,
      mode: "diagnostic_only",
      reason: "No sentence received a priority forensic index; no expressive intervention was manufactured from mode selection alone.",
    };
    return plan;
  }

  // Keep the selection bounded. The forensic engine identifies likely leverage
  // points (openings, evidence-entry points, closures and repeated signposts), not
  // a quota to rewrite the entire narrative.
  const ratioCap = requestedIntensity === "deep" ? 0.65 : 0.45;
  const maxTargets = Math.max(1, Math.floor((plan.items?.length || 1) * ratioCap));
  const targetIndices = new Set(sourceIndices.slice(0, maxTargets));
  let changed = 0;

  plan.items = (plan.items || []).map((item) => {
    if (!targetIndices.has(item.sentenceIndex)) return item;
    if (FORMAL_KEEP_CODES.has(item.decisionCode)) return item;

    if (requestedIntensity === "moderate" && MODERATE_FORENSIC_LEVELS.has(item.level)) {
      changed += 1;
      return {
        ...item,
        level: "SENTENCE_RESTRUCTURE",
        decisionCode: "FORENSIC_SENTENCE_FLOW_RESTRUCTURE",
        reasons: [
          ...(item.reasons || []),
          "Cross-sentence/cross-paragraph regularity forensics selected this sentence as a leverage point in repeated rhetorical choreography. Moderate + Aggressive permits sentence/flow reconstruction here, but does not authorise wholesale paragraph resequencing.",
          "Change information packaging rather than merely substituting synonyms. Preserve the proposition, evidence attachment, citation, qualification and technical meaning.",
        ],
      };
    }

    if (requestedIntensity === "deep" && DEEP_FORENSIC_LEVELS.has(item.level)) {
      changed += 1;
      return {
        ...item,
        level: "DISCOURSE_REPACKAGE",
        decisionCode: "FORENSIC_DISCOURSE_SCOPE",
        reasons: [
          ...(item.reasons || []),
          "Cross-paragraph regularity forensics selected this unit as part of repeated rhetorical choreography. Deep + Aggressive/Authorial permits proposition-led repackaging at this diagnosed leverage point.",
          "CAN_CHANGE is not SHOULD_CHANGE: preserve the unit if its existing expression is genuinely author-specific and no local reconstruction is needed after the paragraph-level operation.",
        ],
      };
    }

    return item;
  });

  plan.summary = summarise(plan.items);
  plan.forensicExecution = {
    available: true,
    version: forensic.version,
    regularity_score: forensic.score,
    regularity_label: forensic.label,
    rhetorical_asymmetry_score: forensic.rhetorical_asymmetry_score,
    source_priority_sentence_count: sourceIndices.length,
    target_cap: maxTargets,
    targeted_sentence_count: changed,
    targeted_sentence_indices: [...targetIndices],
    formal_artifacts_excluded: forensic.formal_artifact_block_count || 0,
    mode: requestedIntensity === "deep" ? "targeted_discourse_repackage" : "targeted_sentence_flow_restructure",
    principle: "Diagnosis determines SHOULD_CHANGE; intensity determines CAN_CHANGE; naturalisation determines HOW the authorised change is expressed.",
  };

  return plan;
}

function deepAuthorialProtocol() {
  return [
    "DEEP AUTHORIAL V4 EXECUTION PROTOCOL: this is not a sentence-by-sentence paraphrase pass. Before drafting each authorised substantive paragraph, recover its protected proposition/evidence ledger: claim(s), evidence/citation attachment, qualification/condition, measurement distinction, mechanism, setting/time context, and rhetorical purpose. Reconstruct from that ledger rather than walking through source sentence shells in order.",
    "PRESERVE RESEARCH, NOT AUTOMATICALLY SURFACE PACKAGING: factual meaning, citations, statistics, variables, hypotheses, methods, chronology, study stage, technical terminology and epistemic strength are immutable. Sentence boundaries, grammatical subjects, clause order, local information packaging and paragraph development are available for reconstruction only where diagnosis supports intervention.",
    "NUMERIC RELATIONSHIPS ARE ATOMIC: copy protected years, year ranges, sample-size ranges, percentages, monetary values and statistical notation without changing their relationship. In particular, a range such as 2015-2024 or 10-15 must never become two comma-separated values such as 2015, 2024 or 10, 15. Preserve the exact source range string when possible.",
    "DO NOT USE SYNONYM DISTANCE AS THE METHOD: replacing rely with depend, important with salient, proposes with advances, or similar lexical recoding is not Deep Authorial execution when the original sentence architecture and paragraph choreography remain recognisable. Prefer ordinary precise academic wording; structural redevelopment must come from reasoning and information organisation.",
    "BREAK SOURCE SENTENCE ALIGNMENT WHERE WARRANTED: one source sentence may supply material to two revised sentences; two or three source sentences may become one analytical unit; a citation-bearing evidential sentence may remain concise while its interpretation moves to a neighbouring sentence. Do not preserve a one-source-sentence -> one-revised-sentence mapping merely as a habit.",
    "VARY RHETORICAL TRAJECTORY BY FUNCTION, NOT RANDOMNESS: descriptive/context paragraphs may accumulate facts before interpretation; literature paragraphs may juxtapose studies and delay synthesis; conditional findings may foreground the condition; gap paragraphs may accumulate unresolved tensions before narrowing the gap; purpose/method paragraphs should state specifications directly. Do not force every paragraph through topic sentence -> evidence -> interpretation -> polished implication.",
    "ALLOW UNEVEN EMPHASIS: not every paragraph needs a closing synthesis sentence, not every evidence cluster needs an immediate takeaway, and not every sentence must be a self-contained mini-abstract. Some paragraphs may end on evidence, a limitation, a condition, a measurement distinction or an unresolved tension that the next paragraph carries forward.",
    "SUPPRESS EDITORIAL CHOREOGRAPHY: avoid repeated constructions such as 'The salient question...', 'This study/prospectus advances...', 'Prior evidence therefore...', 'In other words...', 'Taken together...', or equivalent tidy summary frames when they are not required by the actual argument. No phrase is banned absolutely; repeated editorial preference across paragraphs is the defect.",
    "SECTION REGISTER MATTERS: problem statements, purpose statements, research questions, hypotheses, operational definitions and methods should remain direct and institutionally recognisable. Do not naturalise formal artefacts by rhetorical embellishment. Literature/background prose can carry more varied discourse movement because its job is argumentative rather than formularised.",
    "DEEP DOES NOT MEAN LEXICALLY GRANDER: do not inflate nominalisations, stack abstract nouns, or make every sentence denser. A stronger reconstruction may use simpler verbs, shorter evidential statements, delayed interpretation, or a longer qualified sentence where the reasoning actually requires it.",
    "CAN CHANGE IS NOT SHOULD CHANGE: Deep/Authorial supplies broad permission, not a quota. A technically clean sentence or paragraph may still be kept when its authorial texture is genuine and no discourse-regularity or argumentative diagnosis warrants intervention.",
    "FINAL SELF-CHECK BEFORE RETURNING: for paragraphs actually authorised for reconstruction, ask whether the candidate is essentially the same paragraph sequence with cleaner synonyms and recast clauses. If yes, the authorised Deep Authorial operation is under-executed. Rebuild that authorised material from the proposition/evidence ledger while retaining all protected research content.",
    "EXTERNAL CLASSIFIERS ARE DIAGNOSTIC ONLY: do not target a detector score, insert errors, conceal machine provenance, or use tricks. The objective is defensible, heterogeneous, author-like academic discourse produced by better reasoning architecture and fidelity, not score gaming.",
  ];
}

export function buildDiagnosisScopedPlan(diagnostics, options = {}) {
  const requestedNaturalisation = String(options.naturalisation || "faithful").toLowerCase();
  const requestedLength = String(options.lengthPreference || "auto").toLowerCase();
  const requestedIntensity = String(options.rewriteIntensity || "auto").toLowerCase();
  const authorialAuthority = requestedIntensity === "deep" && ["aggressive", "authorial"].includes(requestedNaturalisation);

  // The base planner must diagnose scope independently of naturalisation style.
  // Passing an aggressive flag into the legacy v4 intent inference could silently
  // manufacture DISCOURSE_RECONSTRUCTION even when the document diagnosis did not
  // support it. Therefore scope diagnosis is always run in faithful mode (or off).
  // Requested aggressive/authorial treatment is restored afterwards as execution
  // authority within the user's explicit intensity ceiling.
  const diagnosticIntensity = requestedIntensity;
  const plannerNaturalisation = requestedNaturalisation === "off" ? "off" : "faithful";

  let plan = buildV4Plan(diagnostics, {
    ...options,
    rewriteIntensity: diagnosticIntensity,
    naturalisation: plannerNaturalisation,
    // Expansion is evidence/argument driven. It is never a quota to lengthen text.
    lengthPreference: requestedLength === "concise" ? "concise" : requestedLength === "expand" ? "expand" : "maintain",
  });

  plan = forensicExecutionScope(plan, diagnostics, {
    requestedIntensity,
    requestedNaturalisation,
  });

  plan.intensity = requestedIntensity;
  plan.diagnosticIntensity = diagnosticIntensity;
  plan.naturalisation = requestedNaturalisation;
  plan.diagnosticNaturalisation = plannerNaturalisation;
  plan.lengthPreference = requestedLength;
  plan.authorialAuthorityActive = authorialAuthority;
  plan.scopePolicyVersion = "diagnosis-guided-authority-v5";
  plan.authorialProtocolVersion = authorialAuthority ? "proposition-led-authorial-reconstruction-v6" : null;
  plan.scopePrinciples = [
    "Diagnosis selects the rhetorical/argument operation; the researcher-selected intensity supplies the intervention ceiling.",
    "Naturalisation changes how authorised work is expressed; it does not manufacture paragraph/discourse authority.",
    "Cross-paragraph regularity forensics examines recurring rhetorical sequencing, evidence placement, tidy closures, paragraph signatures, signposting and rhetorical asymmetry in narrative prose; formal academic artefacts are excluded from that score.",
    "Minor remains local and restrained; Moderate permits sentence/flow restructuring and selective diagnosed development; Deep permits diagnosed structural redevelopment.",
    "Moderate + Aggressive may substantially restructure the diagnosed sentence/flow leverage points identified by discourse forensics, while still blocking silent paragraph resequencing or wholesale discourse reconstruction.",
    "Deep + Aggressive/Authorial authorises paragraph-level reconstruction where paragraph/discourse diagnosis or machine-pattern regularity supports it, even if individual sentences are grammatically clean.",
    "CAN_CHANGE and SHOULD_CHANGE are separate decisions. Deep authority never creates a requirement to rewrite every clean unit.",
    "A Deep/Authorial request must not be silently collapsed into local synonym polishing where genuine reconstruction has been diagnosed.",
    "Expand develops diagnosed reasoning, evidence, qualification, context, measurement or gap work; it is not a word-growth quota.",
    "Keep decisions remain legitimate in every mode for headings, quotations, equations, technical labels, evidence, formal research artefacts, and genuinely author-specific passages that do not warrant intervention.",
    ...(authorialAuthority ? deepAuthorialProtocol() : []),
  ];
  plan.documentGuidance = [
    ...(plan.documentGuidance || []),
    ...plan.scopePrinciples,
  ];
  plan.intent = {
    ...plan.intent,
    rationale: [
      ...(plan.intent?.rationale || []),
      diagnostics?.discourse_regularity_forensics?.available
        ? `Cross-paragraph discourse regularity: ${diagnostics.discourse_regularity_forensics.label} (${diagnostics.discourse_regularity_forensics.score}). Formal academic artefacts excluded: ${diagnostics.discourse_regularity_forensics.formal_artifact_block_count || 0}.`
        : null,
      authorialAuthority
        ? "Deep Authorial authority is active for diagnosed material: reconstruct from protected propositions, evidence relationships and rhetorical purpose rather than performing sentence-aligned paraphrase. Preserve the research; source sentence architecture is not automatically the fidelity target."
        : requestedIntensity === "deep"
          ? "Deep structural authority is available where diagnosis supports it; permission does not itself create a need to reconstruct clean material."
          : null,
      ["aggressive", "authorial"].includes(requestedNaturalisation) && requestedIntensity === "moderate"
        ? "Aggressive/Authorial expression is permitted at the sentence/flow level. Cross-paragraph forensic leverage points may receive substantive sentence restructuring, but the Moderate ceiling blocks silent paragraph resequencing or wholesale discourse reconstruction."
        : null,
      requestedLength === "expand"
        ? "Expand is permission to develop diagnosed intellectual work from available content/evidence; no global word-growth quota is created."
        : null,
    ].filter(Boolean),
  };
  return plan;
}
